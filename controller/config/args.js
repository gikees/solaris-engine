const minimist = require("minimist");
const { buildPeerNames, parsePeerEndpoints } = require("./player-utils");

/**
 * Parse command line arguments with default values
 * @returns {Object} Parsed arguments object
 */
function parseArgs() {
  const raw = minimist(process.argv.slice(2), {
    default: {
      host: "127.0.0.1",
      port: 25565,
      rcon_host: "127.0.0.1",
      rcon_port: 25575,
      act_recorder_host: "127.0.0.1",
      act_recorder_port: 8091,
      bot_name: "Alpha",
      // N-player: comma-separated list of all players (sorted alphabetically)
      player_names: process.env.PLAYER_NAMES || "Alpha,Bravo",
      coord_port: 8093,
      // N-player: replaces other_coord_host/other_coord_port
      peer_endpoints: process.env.PEER_ENDPOINTS || "",
      bot_rng_seed: "12345",
      episodes_num: 1,
      start_episode_id: 0,
      run_id: 1,
      instance_id: 0,
      output_dir: process.env.OUTPUT_DIR || "/output",
      bootstrap_wait_time: 0,
      enable_camera_wait: 1,
      teleport_center_x: 0,
      teleport_center_z: 0,
      teleport_radius: 5,
      walk_timeout: 5, // walk timeout in seconds
      mc_version: process.env.MC_VERSION || "1.21",
      camera_ready_retries: 30,
      camera_ready_check_interval: 2000, // milliseconds
      rcon_password: "research",
      teleport: 1,
      viewer_rendering_disabled: 0,
      viewer_recording_interval: 50,
      smoke_test: 0,
      world_type: "flat",
      eval_time_set_day: 0,
    },
  });

  // Derive structured fields from raw string args
  const player_names = raw.player_names
    .split(",")
    .map((s) => s.trim())
    .sort();
  const peer_names = buildPeerNames(player_names, raw.bot_name);
  const peer_endpoints = parsePeerEndpoints(raw.peer_endpoints);

  // other_bot_name kept for backwards compatibility during migration
  const other_bot_name = peer_names[0] ?? null;

  return {
    ...raw,
    player_names,
    peer_names,
    peer_endpoints,
    other_bot_name,
  };
}

module.exports = {
  parseArgs,
};
