/**
 * Modularized Minecraft Bot Coordination System
 *
 * This is the new modular version of controller.js with improved code organization.
 * All utility functions have been extracted into separate modules for better maintainability.
 */

const { parseArgs } = require("./config/args");
const { getOnSpawnFn } = require("./episodes-loop");
const { makeBot } = require("./utils/bot-factory");
const { BotCoordinator } = require("./utils/coordination");
const { sleep } = require("./utils/helpers");

/**
 * Main function to initialize and run the bot
 */
async function main() {
  // Parse command line arguments
  const args = parseArgs();

  console.log(`Starting bot: ${args.bot_name}`);
  console.log(
    `Players: [${args.player_names.join(", ")}], COORD_PORT: ${args.coord_port}`,
  );
  console.log(
    `[${args.bot_name}] Waiting ${args.bootstrap_wait_time} seconds before creating bot...`,
  );

  // Wait for bootstrap time
  await sleep(args.bootstrap_wait_time * 1000);

  // Create bot instance
  const bot = makeBot({
    username: args.bot_name,
    host: args.host,
    port: args.port,
    version: args.mc_version,
  });

  if (args.peer_names.length > 1) {
    throw new Error(
      `Legacy BotCoordinator supports only one peer during Step 1; ${args.bot_name} was configured with peers [${args.peer_names.join(", ")}]. Complete Step 2 before running >2-player controller configs.`,
    );
  }

  // Derive first-peer host/port from peer_endpoints for the current 2-party
  // BotCoordinator shape. Step 2 will replace this with full-mesh coordination.
  const firstPeerName = args.peer_names[0];
  const firstPeer = firstPeerName ? args.peer_endpoints[firstPeerName] : null;
  const otherCoordHost = firstPeer?.host || args.other_coord_host || "127.0.0.1";
  const otherCoordPort =
    firstPeer?.port || Number(args.other_coord_port || 8094);

  const coordinator = new BotCoordinator(
    args.bot_name,
    args.coord_port,
    otherCoordHost,
    otherCoordPort,
  );

  // Set up spawn event handler
  bot.once(
    "spawn",
    getOnSpawnFn(
      bot,
      args.act_recorder_host,
      args.act_recorder_port,
      coordinator,
      args,
    ),
  );

  // Handle system chat packets
  bot._client.on("packet", (data, meta) => {
    if (meta.name === "system_chat" && data && data.content) {
      console.log("SYSTEM:", JSON.stringify(data.content));
    }
  });
}

// Run the main function
main().catch(console.error);
