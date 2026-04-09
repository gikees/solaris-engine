const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const seedrandom = require("seedrandom");

const {
  buildPeerNames,
  buildCameraNames,
  parsePeerEndpoints,
  decidePrimaryBot,
} = require("../../controller/config/player-utils");

describe("buildPeerNames", () => {
  it("returns all player names except own", () => {
    const peers = buildPeerNames(["Alpha", "Bravo", "Charlie"], "Bravo");
    assert.deepEqual(peers, ["Alpha", "Charlie"]);
  });

  it("works with 2 players", () => {
    const peers = buildPeerNames(["Alpha", "Bravo"], "Alpha");
    assert.deepEqual(peers, ["Bravo"]);
  });

  it("preserves sorted order in output", () => {
    const peers = buildPeerNames(["Alpha", "Bravo", "Charlie"], "Alpha");
    assert.deepEqual(peers, ["Bravo", "Charlie"]);
  });
});

describe("buildCameraNames", () => {
  it("returns Camera-prefixed names for all players", () => {
    const cameras = buildCameraNames(["Alpha", "Bravo", "Charlie"]);
    assert.deepEqual(cameras, ["CameraAlpha", "CameraBravo", "CameraCharlie"]);
  });

  it("works with 2 players", () => {
    const cameras = buildCameraNames(["Alpha", "Bravo"]);
    assert.deepEqual(cameras, ["CameraAlpha", "CameraBravo"]);
  });
});

describe("parsePeerEndpoints", () => {
  it("parses PEER_ENDPOINTS env var format into a map", () => {
    const endpoints = parsePeerEndpoints(
      "Bravo:controller_bravo_instance_0:8100,Charlie:controller_charlie_instance_0:8100",
    );
    assert.deepEqual(endpoints, {
      Bravo: { host: "controller_bravo_instance_0", port: 8100 },
      Charlie: { host: "controller_charlie_instance_0", port: 8100 },
    });
  });

  it("returns empty object for empty string", () => {
    assert.deepEqual(parsePeerEndpoints(""), {});
  });

  it("handles single peer", () => {
    const endpoints = parsePeerEndpoints("Bravo:host1:9000");
    assert.deepEqual(endpoints, { Bravo: { host: "host1", port: 9000 } });
  });
});

describe("decidePrimaryBot", () => {
  // Each bot independently seeds RNG with the same value (shared seed),
  // so all bots are in the same RNG state when they call decidePrimaryBot.
  // Exactly one should return true.
  it("exactly one of N bots is primary for any rng seed", () => {
    const allNames = ["Alpha", "Bravo", "Charlie"];
    for (const seed of ["1", "42", "999", "12345"]) {
      const results = allNames.map((name) =>
        decidePrimaryBot(allNames, name, seedrandom(seed)),
      );
      assert.equal(
        results.filter(Boolean).length,
        1,
        `Seed ${seed}: expected exactly 1 primary, got ${results}`,
      );
    }
  });

  it("works for 2 players", () => {
    const allNames = ["Alpha", "Bravo"];
    for (const seed of ["1", "42"]) {
      const results = allNames.map((name) =>
        decidePrimaryBot(allNames, name, seedrandom(seed)),
      );
      assert.equal(results.filter(Boolean).length, 1);
    }
  });

  it("is deterministic: same seed always picks same primary", () => {
    const allNames = ["Alpha", "Bravo", "Charlie"];
    const seed = "777";
    const first = allNames.map((name) =>
      decidePrimaryBot(allNames, name, seedrandom(seed)),
    );
    const second = allNames.map((name) =>
      decidePrimaryBot(allNames, name, seedrandom(seed)),
    );
    assert.deepEqual(first, second);
  });
});
