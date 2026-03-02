const {
  lookAtSmooth,
  sneak,
} = require("../../primitives/movement");
const { BaseEpisode } = require("../base-episode");

const EPISODE_MIN_TICKS = 300;
const MIN_TURN_SPEED = 20;
const MAX_TURN_SPEED = 40;

function getOnBackToBackTurnPhaseFn(
  bot,
  rcon,
  sharedBotRng,
  coordinator,
  episodeNum,
  episodeInstance,
  args,
) {
  return async (otherBotPosition) => {
    coordinator.sendToOtherBot(
      "backToBackTurnPhase",
      bot.entity.position.clone(),
      episodeNum,
      "backToBackTurnPhase beginning",
    );

    // Generate per-bot turn speeds from shared RNG (deterministic order)
    const speedAlpha =
      MIN_TURN_SPEED + sharedBotRng() * (MAX_TURN_SPEED - MIN_TURN_SPEED);
    const speedBravo =
      MIN_TURN_SPEED + sharedBotRng() * (MAX_TURN_SPEED - MIN_TURN_SPEED);

    const isAlpha = bot.username < args.other_bot_name;
    const mySpeed = isAlpha ? speedAlpha : speedBravo;

    episodeInstance._evalMetadata = {
      camera_speed_alpha: speedAlpha,
      camera_speed_bravo: speedBravo,
      turn_degrees: 180,
    };

    console.log(
      `[${bot.username}] Back-to-back turn: turning 180° at ${mySpeed.toFixed(1)}°/sec`,
    );

    // Sneak to signal evaluation start
    await sneak(bot);
    const startTick = bot.time.age;

    // Turn 180° to face the other bot.
    // Since bots face exactly opposite, lookAtSmooth could pick either rotation direction.
    // Add a small yaw epsilon to force a consistent direction.
    const epsilonDir = sharedBotRng() < 0.5 ? 1 : -1;
    const epsilon = epsilonDir * 0.01; // tiny yaw offset in radians

    // Offset the target slightly sideways to break the 180° ambiguity
    const dx = otherBotPosition.x - bot.entity.position.x;
    const dz = otherBotPosition.z - bot.entity.position.z;
    const mag = Math.sqrt(dx * dx + dz * dz) || 1;
    const nx = dx / mag;
    const nz = dz / mag;
    // Perpendicular vector
    const perpX = -nz;
    const perpZ = nx;
    const nudgedTarget = otherBotPosition.offset(
      perpX * epsilon,
      0,
      perpZ * epsilon,
    );

    await lookAtSmooth(bot, nudgedTarget, mySpeed, {
      randomized: false,
      useEasing: false,
    });

    // Wait for minimum ticks
    const endTick = bot.time.age;
    const remaining = EPISODE_MIN_TICKS - (endTick - startTick);
    if (remaining > 0) {
      console.log(
        `[${bot.username}] Waiting ${remaining} more ticks to reach ${EPISODE_MIN_TICKS}`,
      );
      await bot.waitForTicks(remaining);
    }

    // Setup stop phase
    coordinator.onceEvent(
      "stopPhase",
      episodeNum,
      episodeInstance.getOnStopPhaseFn(
        bot,
        rcon,
        sharedBotRng,
        coordinator,
        args.other_bot_name,
        episodeNum,
        args,
      ),
    );

    coordinator.sendToOtherBot(
      "stopPhase",
      bot.entity.position.clone(),
      episodeNum,
      "backToBackTurnPhase end",
    );
  };
}

/**
 * Eval episode where bots start back-to-back (facing away) and slowly turn 180° to face each other
 * at different speeds; used to evaluate turning prediction with asymmetric rotation.
 * @extends BaseEpisode
 */
class BackToBackTurnEvalEpisode extends BaseEpisode {
  static WORKS_IN_NON_FLAT_WORLD = false;
  static INIT_MIN_BOTS_DISTANCE = 10;
  static INIT_MAX_BOTS_DISTANCE = 12;

  async setupEpisode(
    bot,
    rcon,
    sharedBotRng,
    coordinator,
    episodeNum,
    args,
    botPosition,
    otherBotPosition,
  ) {
    // Return a point BEHIND the bot (opposite direction from other bot).
    // The framework will auto-orient the bot to face away from the other bot.
    const dx = otherBotPosition.x - botPosition.x;
    const dz = otherBotPosition.z - botPosition.z;
    const mag = Math.sqrt(dx * dx + dz * dz) || 1;
    const nx = dx / mag;
    const nz = dz / mag;

    // Point behind: opposite direction
    const behindTarget = botPosition.offset(-nx * 10, 0, -nz * 10);

    return {
      botPositionNew: botPosition,
      otherBotPositionNew: behindTarget,
    };
  }

  async entryPoint(
    bot,
    rcon,
    sharedBotRng,
    coordinator,
    iterationID,
    episodeNum,
    args,
  ) {
    coordinator.onceEvent(
      "backToBackTurnPhase",
      episodeNum,
      getOnBackToBackTurnPhaseFn(
        bot,
        rcon,
        sharedBotRng,
        coordinator,
        episodeNum,
        this,
        args,
      ),
    );
    coordinator.sendToOtherBot(
      "backToBackTurnPhase",
      bot.entity.position.clone(),
      episodeNum,
      "teleportPhase end",
    );
  }
}

module.exports = { BackToBackTurnEvalEpisode };
