const EventEmitter = require("events");
const net = require("net");
const {
  decidePrimaryBot: _decidePrimaryBotNew,
} = require("../config/player-utils");

function pickRandom(array, sharedBotRng) {
  const sortedArray = array.slice().sort();
  return sortedArray[Math.floor(sharedBotRng() * sortedArray.length)];
}

/**
 * Determines whether this bot is the primary bot for the current episode.
 * Uses args.player_names when available (N-player), falls back to the legacy
 * 2-player pair for callers that haven't migrated yet.
 */
function decidePrimaryBot(bot, sharedBotRng, args) {
  const allNames = args.player_names ?? [bot.username, args.other_bot_name];
  return _decidePrimaryBotNew(allNames, bot.username, sharedBotRng);
}

/**
 * Returns the peers that this bot should dial (those with a lower sorted index).
 * Peers with a higher sorted index will dial into this bot's server instead.
 *
 * @param {string[]} playerNames - Full sorted player list
 * @param {string} myName - This bot's name
 * @returns {string[]}
 */
function getPeerDialList(playerNames, myName) {
  const sorted = [...playerNames].sort();
  const myIndex = sorted.indexOf(myName);
  return sorted.slice(0, myIndex);
}

/**
 * RCON teleportation function
 */
async function rconTp(rcon, name, x, y, z) {
  return rcon.send(`tp ${name} ${x} ${y} ${z}`);
}

function getEventName(eventName, episodeNum) {
  return `episode_${episodeNum}_${eventName}`;
}

/**
 * Bot coordination class — full-mesh TCP for N players.
 *
 * Connection topology:
 *   - Each bot listens on coordPort for incoming connections.
 *   - Each bot dials all peers with a lower sorted index (getPeerDialList).
 *   - Higher-index peers dial in and identify themselves with a "hello" handshake.
 *   - All peer sockets (dialed and accepted) are stored in this.peerSockets.
 *
 * Backwards compatibility:
 *   - sendToOtherBot() now broadcasts to all peers (existing callers unchanged).
 *   - 2-player setup still works: Alpha accepts 1 connection, Bravo dials 1.
 */
class BotCoordinator extends EventEmitter {
  /**
   * @param {string} botName
   * @param {string[]} playerNames - Full sorted player list
   * @param {number} coordPort - Port this bot listens on
   * @param {Object.<string, {host: string, port: number}>} peerEndpoints - Peers to dial
   */
  constructor(botName, playerNames, coordPort, peerEndpoints) {
    super();
    this.botName = botName;
    this.playerNames = [...playerNames].sort();
    this.peerNames = this.playerNames.filter((n) => n !== botName);
    this.coordPort = coordPort;
    this.peerEndpoints = peerEndpoints ?? {};
    this.peerSockets = new Map(); // peerName -> socket
    this.server = null;
    this.executingEvents = new Map();
    this.eventCounter = 0;
    this.messageBuffer = new Map(); // eventName -> [{eventParams, from}]
  }

  _takeBufferedMessages(eventName) {
    const buffered = this.messageBuffer.get(eventName) ?? [];
    this.messageBuffer.delete(eventName);
    return buffered;
  }

  _extractSender(eventParams, fromArg) {
    return fromArg ?? eventParams?.from ?? eventParams?._from ?? null;
  }

  _getLegacyPrimaryPeerName() {
    return this.peerNames[0] ?? null;
  }

  // ---------------------------------------------------------------------------
  // Connection setup
  // ---------------------------------------------------------------------------

  async setupConnections() {
    console.log(`[${this.botName}] Setting up full-mesh connections...`);
    const dialList = getPeerDialList(this.playerNames, this.botName);
    const acceptCount = this.peerNames.length - dialList.length;

    await Promise.all([
      this._setupServer(acceptCount),
      ...dialList.map((name) => this._dialPeer(name)),
    ]);

    console.log(
      `[${this.botName}] All ${this.peerNames.length} peer connections established`,
    );
  }

  _setupServer(acceptCount) {
    return new Promise((resolve) => {
      let handshakeCount = 0;

      this.server = net.createServer((socket) => {
        let buffer = "";
        let peerName = null;

        socket.on("data", (data) => {
          buffer += data.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop();

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.type === "hello" && !peerName) {
                peerName = msg.from;
                this.peerSockets.set(peerName, socket);
                handshakeCount++;
                console.log(
                  `[${this.botName}] Peer ${peerName} connected (${handshakeCount}/${acceptCount})`,
                );
                if (handshakeCount >= acceptCount) resolve();
              } else {
                this._handleMessage(msg);
              }
            } catch (err) {
              console.error(`[${this.botName}] Parse error:`, err.message);
            }
          }
        });

        socket.on("close", () => {
          if (peerName) {
            console.log(`[${this.botName}] Peer ${peerName} disconnected`);
            this.peerSockets.delete(peerName);
          }
        });
      });

      this.server.listen(this.coordPort, () => {
        console.log(`[${this.botName}] Listening on port ${this.coordPort}`);
        if (acceptCount === 0) resolve();
      });
    });
  }

  _dialPeer(peerName) {
    return new Promise((resolve) => {
      const endpoint = this.peerEndpoints[peerName];
      if (!endpoint) {
        throw new Error(
          `[${this.botName}] Missing peer endpoint configuration for ${peerName}`,
        );
      }
      const { host, port } = endpoint;

      const attempt = () => {
        const socket = net.createConnection({ host, port }, () => {
          // Send hello handshake so the server can identify us
          socket.write(
            JSON.stringify({ type: "hello", from: this.botName }) + "\n",
          );
          this.peerSockets.set(peerName, socket);
          console.log(
            `[${this.botName}] Connected to peer ${peerName} at ${host}:${port}`,
          );
          resolve();

          let buffer = "";
          socket.on("data", (data) => {
            buffer += data.toString();
            const lines = buffer.split("\n");
            buffer = lines.pop();
            for (const line of lines) {
              if (line.trim()) {
                try {
                  this._handleMessage(JSON.parse(line));
                } catch (err) {
                  console.error(`[${this.botName}] Parse error:`, err.message);
                }
              }
            }
          });
        });

        socket.on("error", (err) => {
          console.log(
            `[${this.botName}] Failed to connect to ${peerName}, retrying in 2s:`,
            err.message,
          );
          setTimeout(attempt, 2000);
        });

        socket.on("close", () => {
          this.peerSockets.delete(peerName);
        });
      };

      attempt();
    });
  }

  _handleMessage(msg) {
    if (!msg.eventName) return;
    if (this.listenerCount(msg.eventName) > 0) {
      this.emit(msg.eventName, msg.eventParams, msg.from ?? null);
    } else {
      // Buffer the message so it can be replayed when a listener registers.
      if (!this.messageBuffer.has(msg.eventName)) {
        this.messageBuffer.set(msg.eventName, []);
      }
      this.messageBuffer.get(msg.eventName).push({
        eventParams: msg.eventParams,
        from: msg.from ?? null,
      });
      console.log(
        `[${this.botName}] Buffered: ${msg.eventName} (no listeners yet)`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Messaging
  // ---------------------------------------------------------------------------

  /**
   * Broadcast an event to all connected peers.
   */
  broadcastToPeers(eventName, eventParams, episodeNum, location) {
    const fullEventName = getEventName(eventName, episodeNum);
    const message =
      JSON.stringify({
        eventName: fullEventName,
        eventParams,
        from: this.botName,
      }) + "\n";
    for (const [peerName, socket] of this.peerSockets) {
      if (socket && !socket.destroyed) {
        socket.write(message);
        if (location) {
          console.log(
            `[${this.botName}] ${location}: Sent ${fullEventName} to ${peerName}`,
          );
        }
      }
    }
  }

  /**
   * Backwards-compatible alias — now broadcasts to all peers.
   */
  sendToOtherBot(eventName, eventParams, episodeNum, location) {
    this.broadcastToPeers(eventName, eventParams, episodeNum, location);
  }

  // ---------------------------------------------------------------------------
  // Event handling
  // ---------------------------------------------------------------------------

  collectPeerPhaseData(eventName, episodeNum) {
    const fullEventName = getEventName(eventName, episodeNum);
    const needed = this.peerNames.length;

    if (needed === 0) {
      return Promise.resolve({});
    }

    return new Promise((resolve) => {
      const peerPhaseDataByName = {};
      const receivedFrom = new Set();

      const listener = (eventParams, fromArg) => {
        const from = this._extractSender(eventParams, fromArg);
        if (!from || !this.peerNames.includes(from)) {
          return;
        }

        if (!receivedFrom.has(from)) {
          peerPhaseDataByName[from] = eventParams;
          receivedFrom.add(from);
        }

        if (receivedFrom.size >= needed) {
          this.removeListener(fullEventName, listener);
          resolve(peerPhaseDataByName);
        }
      };

      this.on(fullEventName, listener);

      // Drain any messages that arrived before this listener was registered.
      const buffered = this._takeBufferedMessages(fullEventName);
      if (buffered.length > 0) {
        for (const { eventParams, from } of buffered) {
          listener(eventParams, from);
        }
      }
    });
  }

  onceEvent(eventName, episodeNum, handler) {
    const fullEventName = getEventName(eventName, episodeNum);
    const eventId = this.eventCounter++;
    const uniqueKey = `${fullEventName}_${eventId}`;

    const wrappedHandler = async (eventParams, fromArg) => {
      this.executingEvents.set(uniqueKey, true);
      try {
        await handler(eventParams, fromArg);
      } finally {
        this.executingEvents.delete(uniqueKey);
      }
    };

    this.once(fullEventName, wrappedHandler);

    // Deliver the earliest buffered message if this event already arrived
    // before listener registration; onceEvent keeps first-sender semantics.
    const buffered = this._takeBufferedMessages(fullEventName);
    if (buffered.length > 0) {
      const [{ eventParams, from }] = buffered;
      this.emit(fullEventName, eventParams, from);
    }
  }

  onceEventFromAllPeers(eventName, episodeNum, handler) {
    const fullEventName = getEventName(eventName, episodeNum);
    const eventId = this.eventCounter++;
    const uniqueKey = `${fullEventName}_${eventId}`;

    const wrappedHandler = async () => {
      this.executingEvents.set(uniqueKey, true);
      try {
        const peerPhaseDataByName = await this.collectPeerPhaseData(
          eventName,
          episodeNum,
        );
        const legacyPrimaryPeerName = this._getLegacyPrimaryPeerName();
        const legacyPrimaryPayload = legacyPrimaryPeerName
          ? peerPhaseDataByName[legacyPrimaryPeerName]
          : undefined;
        await handler(legacyPrimaryPayload, peerPhaseDataByName);
      } finally {
        this.executingEvents.delete(uniqueKey);
      }
    };

    void wrappedHandler();
  }

  async waitForAllPhasesToFinish() {
    let lastLogTime = 0;
    const logIntervalMs = 2000;

    while (this.executingEvents.size > 0) {
      const now = Date.now();
      if (now - lastLogTime >= logIntervalMs) {
        console.log(
          `[${this.botName}] Waiting for ${this.executingEvents.size} event(s): ${[...this.executingEvents.keys()].join(", ")}`,
        );
        lastLogTime = now;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    console.log(`[${this.botName}] All event handlers finished`);
  }

  // ---------------------------------------------------------------------------
  // N-party sync barrier
  //
  // Each bot broadcasts "syncBots" and waits for an ack from every peer.
  // Acks are counted by sender name to ignore duplicates.
  // ---------------------------------------------------------------------------
  async syncBots(episodeNum) {
    const needed = this.peerNames.length;
    if (needed === 0) return;

    const waitForPeers = this.collectPeerPhaseData("syncBots", episodeNum);
    this.broadcastToPeers("syncBots", {}, episodeNum, "syncBots");
    const peerPhaseDataByName = await waitForPeers;

    for (const from of Object.keys(peerPhaseDataByName)) {
      console.log(
        `[${this.botName}] syncBots ack from ${from} (${Object.keys(peerPhaseDataByName).length}/${needed})`,
      );
    }
  }

  async close() {
    for (const socket of this.peerSockets.values()) {
      try {
        socket.destroy();
      } catch (err) {
        // Ignore cleanup errors in shutdown path.
      }
    }
    this.peerSockets.clear();

    if (this.server) {
      await new Promise((resolve) => {
        this.server.close(() => resolve());
      });
      this.server = null;
    }
  }
}

module.exports = {
  rconTp,
  BotCoordinator,
  decidePrimaryBot,
  getPeerDialList,
  pickRandom,
};
