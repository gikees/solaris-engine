const { describe, it, mock } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

// rcon-client is only available inside Docker, so stub it before loading camera-ready
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "rcon-client") {
    return { Rcon: { connect: async () => ({}) } };
  }
  return originalLoad.call(this, request, ...rest);
};

const { extractPlayers, waitForCameras } = require("../../controller/utils/camera-ready");

// Restore after loading
Module._load = originalLoad;

// ---------------------------------------------------------------------------
// extractPlayers
// ---------------------------------------------------------------------------
describe("extractPlayers", () => {
  it("parses comma-separated names after the colon", () => {
    const players = extractPlayers(
      "There are 3 players online: Alpha, CameraAlpha, Bravo",
    );
    assert.ok(players.has("Alpha"));
    assert.ok(players.has("CameraAlpha"));
    assert.ok(players.has("Bravo"));
    assert.equal(players.size, 3);
  });

  it("returns empty set for empty name list", () => {
    assert.equal(extractPlayers("There are 0 players online:").size, 0);
  });

  it("returns empty set when no colon found", () => {
    assert.equal(extractPlayers("").size, 0);
  });
});

// ---------------------------------------------------------------------------
// waitForCameras — dynamic camera names via injected query function
// ---------------------------------------------------------------------------
describe("waitForCameras - dynamic camera names", () => {
  it("resolves true when all cameras in custom list are present", async () => {
    const result = await waitForCameras(
      "localhost",
      25575,
      "research",
      3,
      1,
      ["CameraAlpha", "CameraBravo", "CameraCharlie"],
      async () => "players: CameraAlpha, CameraBravo, CameraCharlie",
    );
    assert.equal(result, true);
  });

  it("returns false when not all cameras join within retries", async () => {
    const result = await waitForCameras(
      "localhost",
      25575,
      "research",
      2,
      1,
      ["CameraAlpha", "CameraBravo", "CameraCharlie"],
      async () => "players: CameraAlpha, CameraBravo", // Charlie never joins
    );
    assert.equal(result, false);
  });

  it("defaults to CameraAlpha,CameraBravo when no cameraNames passed", async () => {
    const result = await waitForCameras(
      "localhost",
      25575,
      "research",
      2,
      1,
      undefined,
      async () => "players: CameraAlpha, CameraBravo",
    );
    assert.equal(result, true);
  });

  it("returns false when default cameras never join", async () => {
    const result = await waitForCameras(
      "localhost",
      25575,
      "research",
      2,
      1,
      undefined,
      async () => "players: CameraAlpha", // Bravo never joins
    );
    assert.equal(result, false);
  });
});
