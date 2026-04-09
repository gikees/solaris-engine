/**
 * Utilities for N-player setup: naming, peer discovery, and primary-bot selection.
 */

/**
 * Returns all player names except the calling bot's own name.
 * Input list need not be sorted; output preserves sorted order.
 * @param {string[]} playerNames - Full sorted player list
 * @param {string} myName - This bot's name
 * @returns {string[]}
 */
function buildPeerNames(playerNames, myName) {
  return [...playerNames].sort().filter((name) => name !== myName);
}

/**
 * Returns camera bot names for all players (prefix "Camera").
 * @param {string[]} playerNames - Full player list
 * @returns {string[]}
 */
function buildCameraNames(playerNames) {
  return [...playerNames].sort().map((name) => `Camera${name}`);
}

/**
 * Parses the PEER_ENDPOINTS env var into a map of { name -> { host, port } }.
 *
 * Format: "Bravo:controller_bravo_instance_0:8100,Charlie:controller_charlie_instance_0:8100"
 *
 * @param {string} raw - Value of PEER_ENDPOINTS env var
 * @returns {Object.<string, {host: string, port: number}>}
 */
function parsePeerEndpoints(raw) {
  if (!raw) return {};
  return Object.fromEntries(
    raw.split(",").map((entry) => {
      const [name, host, port] = entry.split(":");
      return [name, { host, port: parseInt(port, 10) }];
    }),
  );
}

/**
 * Determines whether this bot is the primary bot for the current episode.
 *
 * All bots call this with the same sorted player list and an independently
 * seeded RNG initialised from the same shared seed — so they all pick the
 * same name, and exactly one returns true.
 *
 * @param {string[]} allNames - Full sorted player list
 * @param {string} myName - This bot's name
 * @param {function(): number} sharedBotRng - Seeded RNG (same seed across all bots)
 * @returns {boolean}
 */
function decidePrimaryBot(allNames, myName, sharedBotRng) {
  const sorted = [...allNames].sort();
  const primaryName = sorted[Math.floor(sharedBotRng() * sorted.length)];
  return myName === primaryName;
}

module.exports = {
  buildPeerNames,
  buildCameraNames,
  parsePeerEndpoints,
  decidePrimaryBot,
};
