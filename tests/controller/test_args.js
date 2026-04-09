const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const seedrandom = require("seedrandom");

const {
  buildPeerNames,
  buildCameraNames,
  parsePeerEndpoints,
  decidePrimaryBot,
} = require("../../controller/config/player-utils");

// parseArgs requires process.argv — test by setting env vars and requiring
// a fresh module instance via a helper
function parseArgsWith(env) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  // Clear module cache so env changes take effect
  delete require.cache[require.resolve("../../controller/config/args")];
  delete require.cache[require.resolve("../../controller/config/player-utils")];
  // Temporarily override argv
  const savedArgv = process.argv;
  process.argv = ["node", "main.js"];
  try {
    const { parseArgs } = require("../../controller/config/args");
    return parseArgs();
  } finally {
    process.argv = savedArgv;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

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

describe("parseArgs validation", () => {
  it("throws if bot_name is not in player_names", () => {
    assert.throws(
      () =>
        parseArgsWith({
          BOT_NAME: "Delta",
          PLAYER_NAMES: "Alpha,Bravo,Charlie",
          PEER_ENDPOINTS: "",
        }),
      /bot_name "Delta" is not listed in player_names/,
    );
  });

  it("throws if PEER_ENDPOINTS is set but missing a peer", () => {
    assert.throws(
      () =>
        parseArgsWith({
          BOT_NAME: "Alpha",
          PLAYER_NAMES: "Alpha,Bravo,Charlie",
          PEER_ENDPOINTS: "Bravo:host1:8100", // Charlie missing
        }),
      /PEER_ENDPOINTS is missing entries for: Charlie/,
    );
  });

  it("does not throw when PEER_ENDPOINTS is empty (defaults allowed)", () => {
    assert.doesNotThrow(() =>
      parseArgsWith({
        BOT_NAME: "Alpha",
        PLAYER_NAMES: "Alpha,Bravo",
        PEER_ENDPOINTS: "",
      }),
    );
  });

  it("synthesizes peer_endpoints from legacy OTHER_COORD_* env", () => {
    const args = parseArgsWith({
      BOT_NAME: "Alpha",
      PLAYER_NAMES: "Alpha,Bravo",
      PEER_ENDPOINTS: "",
      OTHER_COORD_HOST: "controller_bravo_instance_0",
      OTHER_COORD_PORT: "8100",
    });
    assert.deepEqual(args.peer_endpoints, {
      Bravo: { host: "controller_bravo_instance_0", port: 8100 },
    });
  });

  it("throws when legacy OTHER_COORD_* env is incomplete", () => {
    assert.throws(
      () =>
        parseArgsWith({
          BOT_NAME: "Alpha",
          PLAYER_NAMES: "Alpha,Bravo",
          PEER_ENDPOINTS: "",
          OTHER_COORD_HOST: "controller_bravo_instance_0",
        }),
      /OTHER_COORD_HOST and OTHER_COORD_PORT must both be set/,
    );
  });

  it("derives player_names, peer_names, other_bot_name correctly", () => {
    const args = parseArgsWith({
      BOT_NAME: "Bravo",
      PLAYER_NAMES: "Alpha,Bravo,Charlie",
      PEER_ENDPOINTS:
        "Alpha:controller_alpha_instance_0:8100,Charlie:controller_charlie_instance_0:8100",
    });
    assert.deepEqual(args.player_names, ["Alpha", "Bravo", "Charlie"]);
    assert.deepEqual(args.peer_names, ["Alpha", "Charlie"]);
    assert.equal(args.other_bot_name, "Alpha");
  });
});

describe("decidePrimaryBot (coordination.js runtime path)", () => {
  it("uses player_names from args when available", () => {
    const { decidePrimaryBot: runtimeDecide } = require("../../controller/utils/coordination");
    const allNames = ["Alpha", "Bravo", "Charlie"];
    const fakeBot = { username: "Alpha" };
    const fakeArgs = { player_names: allNames };
    // All three bots with same rng seed — exactly one should be primary
    const results = allNames.map((name) => {
      const rng = seedrandom("test-seed");
      return runtimeDecide({ username: name }, rng, fakeArgs);
    });
    assert.equal(results.filter(Boolean).length, 1);
  });

  it("falls back to other_bot_name when player_names is absent", () => {
    const { decidePrimaryBot: runtimeDecide } = require("../../controller/utils/coordination");
    // In the legacy 2-player setup, each bot has its own args with other_bot_name
    // pointing to the other bot — simulate that per-bot args correctly
    const botPairs = [
      { username: "Alpha", args: { other_bot_name: "Bravo" } },
      { username: "Bravo", args: { other_bot_name: "Alpha" } },
    ];
    const results = botPairs.map(({ username, args }) => {
      const rng = seedrandom("legacy-seed");
      return runtimeDecide({ username }, rng, args);
    });
    assert.equal(results.filter(Boolean).length, 1);
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
