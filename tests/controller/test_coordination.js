const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");

const {
  getPeerDialList,
  BotCoordinator,
} = require("../../controller/utils/coordination");

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// getPeerDialList
// Returns peers with a lower sorted index — those that this bot dials.
// Higher-index peers dial into this bot's server instead.
// ---------------------------------------------------------------------------
describe("getPeerDialList", () => {
  it("alpha (index 0) dials nobody", () => {
    assert.deepEqual(
      getPeerDialList(["Alpha", "Bravo", "Charlie"], "Alpha"),
      [],
    );
  });

  it("bravo (index 1) dials alpha only", () => {
    assert.deepEqual(
      getPeerDialList(["Alpha", "Bravo", "Charlie"], "Bravo"),
      ["Alpha"],
    );
  });

  it("charlie (index 2) dials alpha and bravo", () => {
    assert.deepEqual(
      getPeerDialList(["Alpha", "Bravo", "Charlie"], "Charlie"),
      ["Alpha", "Bravo"],
    );
  });

  it("2-player: bravo dials alpha", () => {
    assert.deepEqual(getPeerDialList(["Alpha", "Bravo"], "Bravo"), ["Alpha"]);
  });

  it("2-player: alpha dials nobody", () => {
    assert.deepEqual(getPeerDialList(["Alpha", "Bravo"], "Alpha"), []);
  });
});

// ---------------------------------------------------------------------------
// N-party syncBots barrier
//
// We test barrier logic via the EventEmitter interface without real TCP:
// override broadcastToPeers to be a no-op, then manually emit peer ack events.
// ---------------------------------------------------------------------------
describe("syncBots N-party barrier", () => {
  function makeCoordinator(myName, allNames) {
    const coord = new BotCoordinator(myName, allNames, 0, {});
    coord.broadcastToPeers = () => {}; // skip TCP in unit tests
    return coord;
  }

  it("resolves after receiving acks from all N-1 peers (3-player)", async () => {
    const coord = makeCoordinator("Alpha", ["Alpha", "Bravo", "Charlie"]);
    const ep = 1;

    const barrier = coord.syncBots(ep);

    // Simulate acks from both peers
    coord.emit(`episode_${ep}_syncBots`, { from: "Bravo" });
    coord.emit(`episode_${ep}_syncBots`, { from: "Charlie" });

    await barrier;
  });

  it("does not resolve until all peers have acked", async () => {
    const coord = makeCoordinator("Alpha", ["Alpha", "Bravo", "Charlie"]);
    const ep = 2;

    let resolved = false;
    const barrier = coord.syncBots(ep).then(() => {
      resolved = true;
    });

    // Only one ack — must not resolve yet
    coord.emit(`episode_${ep}_syncBots`, { from: "Bravo" });
    await new Promise((r) => setImmediate(r));
    assert.equal(resolved, false, "should not resolve with only 1 of 2 acks");

    // Second ack arrives — should resolve now
    coord.emit(`episode_${ep}_syncBots`, { from: "Charlie" });
    await barrier;
    assert.equal(resolved, true);
  });

  it("ignores duplicate acks from the same peer", async () => {
    const coord = makeCoordinator("Alpha", ["Alpha", "Bravo", "Charlie"]);
    const ep = 3;

    let resolved = false;
    const barrier = coord.syncBots(ep).then(() => {
      resolved = true;
    });

    // Two acks from the same peer — should not satisfy 2-peer barrier
    coord.emit(`episode_${ep}_syncBots`, { from: "Bravo" });
    coord.emit(`episode_${ep}_syncBots`, { from: "Bravo" });
    await new Promise((r) => setImmediate(r));
    assert.equal(resolved, false, "duplicate acks should not satisfy barrier");

    // The missing peer acks
    coord.emit(`episode_${ep}_syncBots`, { from: "Charlie" });
    await barrier;
    assert.equal(resolved, true);
  });

  it("2-player: resolves after 1 ack", async () => {
    const coord = makeCoordinator("Alpha", ["Alpha", "Bravo"]);
    const ep = 4;

    const barrier = coord.syncBots(ep);
    coord.emit(`episode_${ep}_syncBots`, { from: "Bravo" });
    await barrier;
  });

  it("single-player (no peers): resolves immediately", async () => {
    const coord = makeCoordinator("Alpha", ["Alpha"]);
    // Should not hang
    await coord.syncBots(1);
  });

  it("resolves when peer acks arrive before syncBots is called (race condition)", async () => {
    // Simulates the real-world case: peer finishes and broadcasts syncBots
    // before this bot has called syncBots() and registered its listener.
    const coord = makeCoordinator("Alpha", ["Alpha", "Bravo", "Charlie"]);
    const ep = 5;

    // Peer messages arrive via _handleMessage BEFORE syncBots() is called.
    coord._handleMessage({ eventName: `episode_${ep}_syncBots`, eventParams: {}, from: "Bravo" });
    coord._handleMessage({ eventName: `episode_${ep}_syncBots`, eventParams: {}, from: "Charlie" });

    // syncBots() should drain the buffer and resolve immediately.
    await coord.syncBots(ep);
  });
});

describe("collectPeerPhaseData / onceEvent aggregation", () => {
  function makeCoordinator(myName, allNames) {
    return new BotCoordinator(myName, allNames, 0, {});
  }

  it("onceEvent resolves on the first sender only", async () => {
    const coord = makeCoordinator("Alpha", ["Alpha", "Bravo", "Charlie"]);
    const ep = 7;

    const seen = new Promise((resolve) => {
      coord.onceEvent("peerErrorPhase", ep, (eventParams, from) => {
        resolve({ eventParams, from });
      });
    });

    coord.emit(`episode_${ep}_peerErrorPhase`, { reason: "boom" }, "Charlie");
    const { eventParams, from } = await seen;
    assert.deepEqual(eventParams, { reason: "boom" });
    assert.equal(from, "Charlie");
  });

  it("onceEvent consumes an early buffered message", async () => {
    const coord = makeCoordinator("Alpha", ["Alpha", "Bravo", "Charlie"]);
    const ep = 7;

    coord._handleMessage({
      eventName: `episode_${ep}_stoppedPhase`,
      eventParams: { position: { x: 1 } },
      from: "Bravo",
    });

    const seen = new Promise((resolve) => {
      coord.onceEvent("stoppedPhase", ep, (eventParams, from) => {
        resolve({ eventParams, from });
      });
    });

    const { eventParams, from } = await seen;
    assert.deepEqual(eventParams, { position: { x: 1 } });
    assert.equal(from, "Bravo");
  });

  it("onceEvent preserves first-sender semantics for buffered messages", async () => {
    const coord = makeCoordinator("Alpha", ["Alpha", "Bravo", "Charlie"]);
    const ep = 7;

    coord._handleMessage({
      eventName: `episode_${ep}_peerErrorPhase`,
      eventParams: { reason: "first" },
      from: "Charlie",
    });
    coord._handleMessage({
      eventName: `episode_${ep}_peerErrorPhase`,
      eventParams: { reason: "second" },
      from: "Bravo",
    });

    const seen = new Promise((resolve) => {
      coord.onceEvent("peerErrorPhase", ep, (eventParams, from) => {
        resolve({ eventParams, from });
      });
    });

    const { eventParams, from } = await seen;
    assert.deepEqual(eventParams, { reason: "first" });
    assert.equal(from, "Charlie");
    assert.equal(
      coord.messageBuffer.has(`episode_${ep}_peerErrorPhase`),
      false,
      "stale buffered messages should be cleared after onceEvent consumes one",
    );
  });

  it("collectPeerPhaseData resolves with a sender-keyed map", async () => {
    const coord = makeCoordinator("Alpha", ["Alpha", "Bravo", "Charlie"]);
    const ep = 8;

    const collected = coord.collectPeerPhaseData("teleportPhase", ep);
    coord.emit(`episode_${ep}_teleportPhase`, { position: { x: 1 }, from: "Charlie" });
    coord.emit(`episode_${ep}_teleportPhase`, { position: { x: 2 }, from: "Bravo" });

    const peerPhaseDataByName = await collected;
    assert.deepEqual(Object.keys(peerPhaseDataByName).sort(), [
      "Bravo",
      "Charlie",
    ]);
    assert.deepEqual(peerPhaseDataByName.Bravo, {
      position: { x: 2 },
      from: "Bravo",
    });
    assert.deepEqual(peerPhaseDataByName.Charlie, {
      position: { x: 1 },
      from: "Charlie",
    });
  });

  it("onceEventFromAllPeers waits for all peers and passes legacy-primary payload plus full map", async () => {
    const coord = makeCoordinator("Alpha", ["Alpha", "Bravo", "Charlie"]);
    const ep = 9;

    const seen = new Promise((resolve) => {
      coord.onceEventFromAllPeers(
        "teleportPhase",
        ep,
        (legacyPrimaryPayload, peerPhaseDataByName) => {
          resolve({ legacyPrimaryPayload, peerPhaseDataByName });
        },
      );
    });

    coord.emit(`episode_${ep}_teleportPhase`, { position: { x: 3 }, from: "Charlie" });
    coord.emit(`episode_${ep}_teleportPhase`, { position: { x: 4 }, from: "Bravo" });

    const { legacyPrimaryPayload, peerPhaseDataByName } = await seen;
    assert.deepEqual(legacyPrimaryPayload, {
      position: { x: 4 },
      from: "Bravo",
    });
    assert.deepEqual(Object.keys(peerPhaseDataByName).sort(), [
      "Bravo",
      "Charlie",
    ]);
  });
});

// ---------------------------------------------------------------------------
// broadcastToPeers: sends to all tracked peer sockets
// ---------------------------------------------------------------------------
describe("broadcastToPeers", () => {
  it("sends to all registered peer sockets", () => {
    const coord = new BotCoordinator("Alpha", ["Alpha", "Bravo", "Charlie"], 0, {});
    const writes = [];

    // Inject fake sockets
    coord.peerSockets.set("Bravo", { write: (msg) => writes.push({ to: "Bravo", msg }), destroyed: false });
    coord.peerSockets.set("Charlie", { write: (msg) => writes.push({ to: "Charlie", msg }), destroyed: false });

    coord.broadcastToPeers("testEvent", { x: 1 }, 5, "test");

    assert.equal(writes.length, 2);
    assert.ok(writes.some((w) => w.to === "Bravo"));
    assert.ok(writes.some((w) => w.to === "Charlie"));

    const parsed = JSON.parse(writes[0].msg.trim());
    assert.equal(parsed.eventName, "episode_5_testEvent");
    assert.deepEqual(parsed.eventParams, { x: 1 });
  });

  it("skips destroyed sockets", () => {
    const coord = new BotCoordinator("Alpha", ["Alpha", "Bravo"], 0, {});
    const writes = [];

    coord.peerSockets.set("Bravo", { write: (msg) => writes.push(msg), destroyed: true });

    coord.broadcastToPeers("testEvent", {}, 1, "test");
    assert.equal(writes.length, 0);
  });
});

describe("full-mesh TCP integration", () => {
  it("establishes the 3-player mesh and routes sender-aware phase data", async (t) => {
    const allNames = ["Alpha", "Bravo", "Charlie"];
    let alpha;
    let bravo;
    let charlie;

    try {
      const [alphaPort, bravoPort, charliePort] = await Promise.all([
        getFreePort(),
        getFreePort(),
        getFreePort(),
      ]);

      alpha = new BotCoordinator("Alpha", allNames, alphaPort, {
        Bravo: { host: "127.0.0.1", port: bravoPort },
        Charlie: { host: "127.0.0.1", port: charliePort },
      });
      bravo = new BotCoordinator("Bravo", allNames, bravoPort, {
        Alpha: { host: "127.0.0.1", port: alphaPort },
        Charlie: { host: "127.0.0.1", port: charliePort },
      });
      charlie = new BotCoordinator("Charlie", allNames, charliePort, {
        Alpha: { host: "127.0.0.1", port: alphaPort },
        Bravo: { host: "127.0.0.1", port: bravoPort },
      });

      const alphaSetup = alpha.setupConnections();
      await sleep(25);
      const bravoSetup = bravo.setupConnections();
      await sleep(25);
      const charlieSetup = charlie.setupConnections();
      await Promise.all([alphaSetup, bravoSetup, charlieSetup]);

      assert.equal(alpha.peerSockets.size, 2);
      assert.equal(bravo.peerSockets.size, 2);
      assert.equal(charlie.peerSockets.size, 2);

      const received = new Promise((resolve) => {
        alpha.onceEventFromAllPeers(
          "meshPhase",
          9,
          (legacyPrimaryPayload, peerPhaseDataByName) => {
            resolve({ legacyPrimaryPayload, peerPhaseDataByName });
          },
        );
      });

      bravo.broadcastToPeers("meshPhase", { value: "fromBravo" }, 9, "mesh test");
      charlie.broadcastToPeers(
        "meshPhase",
        { value: "fromCharlie" },
        9,
        "mesh test",
      );

      const { legacyPrimaryPayload, peerPhaseDataByName } = await received;
      assert.deepEqual(legacyPrimaryPayload, { value: "fromBravo" });
      assert.deepEqual(peerPhaseDataByName, {
        Bravo: { value: "fromBravo" },
        Charlie: { value: "fromCharlie" },
      });
    } catch (err) {
      if (err?.code === "EPERM") {
        t.skip("sandbox forbids listening sockets");
        return;
      }
      throw err;
    } finally {
      const coordinators = [alpha, bravo, charlie].filter(Boolean);
      await Promise.all(coordinators.map((coord) => coord.close()));
    }
  });
});
