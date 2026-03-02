const { Vec3 } = require("vec3");
const {
  lookAtSmooth,
  sneak,
  stopAll,
  horizontalDistanceTo,
} = require("../../primitives/movement");
const { BaseEpisode } = require("../base-episode");

const CAMERA_SPEED_DEGREES_PER_SEC = 30;
const EPISODE_MIN_TICKS = 300;
const WALL_WIDTH = 8;
const WALL_HEIGHT = 3;
const WALK_TICK_INTERVAL = 2;

function getOnWallWalkPhaseFn(
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
      "wallWalkPhase",
      bot.entity.position.clone(),
      episodeNum,
      "wallWalkPhase beginning",
    );

    const me = bot.entity.position;

    // Pick which end of wall to walk toward
    const goLeft = sharedBotRng() < 0.5;

    // Retrieve wall info stored during setupEpisode
    const wallAxis = episodeInstance._wallAxis;
    const wallCenter = episodeInstance._wallCenter;

    // Determine walk-to target: one end of the wall + a bit past it
    let wallEndTarget;
    const pastWallOffset = 3; // walk a few blocks past the wall end
    if (wallAxis === "x") {
      const endX = goLeft
        ? wallCenter.x - WALL_WIDTH / 2 - pastWallOffset
        : wallCenter.x + WALL_WIDTH / 2 + pastWallOffset;
      wallEndTarget = new Vec3(endX, me.y, me.z);
    } else {
      const endZ = goLeft
        ? wallCenter.z - WALL_WIDTH / 2 - pastWallOffset
        : wallCenter.z + WALL_WIDTH / 2 + pastWallOffset;
      wallEndTarget = new Vec3(me.x, me.y, endZ);
    }

    // Record detour direction in metadata
    episodeInstance._evalMetadata.detour_end = goLeft ? "left" : "right";

    console.log(
      `[${bot.username}] Wall walk: walking ${goLeft ? "left" : "right"} to ${wallEndTarget.x.toFixed(1)}, ${wallEndTarget.z.toFixed(1)}`,
    );

    // Sneak to signal evaluation start
    await sneak(bot);
    const startTick = bot.time.age;

    // Phase 1: Turn to face parallel to wall (toward chosen end)
    await lookAtSmooth(bot, wallEndTarget, CAMERA_SPEED_DEGREES_PER_SEC, {
      randomized: false,
      useEasing: false,
    });

    // Phase 2: Walk parallel to wall until past the wall end
    const maxWalkTicks = 200;
    let walkTicks = 0;
    bot.setControlState("forward", true);
    while (
      horizontalDistanceTo(bot.entity.position, wallEndTarget) > 1.5 &&
      walkTicks < maxWalkTicks
    ) {
      // Keep looking at the walk target
      await lookAtSmooth(bot, wallEndTarget, 90, {
        randomized: false,
        useEasing: false,
      });
      await bot.waitForTicks(WALK_TICK_INTERVAL);
      walkTicks += WALK_TICK_INTERVAL;
    }
    stopAll(bot);

    // Phase 3: Turn 90° toward other bot
    const otherEntity = bot.players[args.other_bot_name]?.entity;
    const currentOtherPos = otherEntity
      ? otherEntity.position
      : otherBotPosition;

    await lookAtSmooth(
      bot,
      currentOtherPos,
      CAMERA_SPEED_DEGREES_PER_SEC,
      { randomized: false, useEasing: false },
    );

    // Phase 4: Walk toward the other bot briefly
    const meetTarget = bot.entity.position.clone().add(
      new Vec3(
        (currentOtherPos.x - bot.entity.position.x) * 0.4,
        0,
        (currentOtherPos.z - bot.entity.position.z) * 0.4,
      ),
    );

    bot.setControlState("forward", true);
    const walkTowardTicks = 60; // walk for about 3 seconds
    for (let i = 0; i < walkTowardTicks; i += WALK_TICK_INTERVAL) {
      const otherNow = bot.players[args.other_bot_name]?.entity;
      const lookTarget = otherNow ? otherNow.position : currentOtherPos;
      await lookAtSmooth(bot, lookTarget, 90, {
        randomized: false,
        useEasing: false,
      });
      await bot.waitForTicks(WALK_TICK_INTERVAL);
    }
    stopAll(bot);

    // Phase 5: Look at each other and wait
    const otherFinal = bot.players[args.other_bot_name]?.entity;
    const finalLookTarget = otherFinal
      ? otherFinal.position
      : currentOtherPos;
    await lookAtSmooth(bot, finalLookTarget, CAMERA_SPEED_DEGREES_PER_SEC, {
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
      "wallWalkPhase end",
    );
  };
}

/**
 * Eval episode where a wall is placed between bots and they walk around it to find each other;
 * used to evaluate occlusion and navigation prediction.
 * @extends BaseEpisode
 */
class WallWalkEvalEpisode extends BaseEpisode {
  static WORKS_IN_NON_FLAT_WORLD = false;
  static INIT_MIN_BOTS_DISTANCE = 16;
  static INIT_MAX_BOTS_DISTANCE = 20;

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
    // Only the lead bot (alphabetically first) places the wall
    const isLeadBot = bot.username < args.other_bot_name;

    // Calculate midpoint between bots
    const midX = (botPosition.x + otherBotPosition.x) / 2;
    const midY = botPosition.y;
    const midZ = (botPosition.z + otherBotPosition.z) / 2;

    // Determine wall orientation: perpendicular to the connecting line,
    // axis-aligned to nearest cardinal direction
    const dx = otherBotPosition.x - botPosition.x;
    const dz = otherBotPosition.z - botPosition.z;

    // If |dx| > |dz|, bots are primarily separated along X,
    // so wall should be along Z axis (perpendicular to X).
    // Otherwise wall should be along X axis.
    const wallAxis = Math.abs(dx) > Math.abs(dz) ? "z" : "x";

    const wallCenterX = Math.floor(midX);
    const wallCenterY = Math.floor(midY);
    const wallCenterZ = Math.floor(midZ);

    // Store wall info for phase handler and teardown
    this._wallCenter = new Vec3(wallCenterX, wallCenterY, wallCenterZ);
    this._wallAxis = wallAxis;
    this._isLeadBot = isLeadBot;

    // Calculate fill coordinates
    const halfWidth = Math.floor(WALL_WIDTH / 2);
    let x1, y1, z1, x2, y2, z2;

    if (wallAxis === "x") {
      // Wall extends along X axis
      x1 = wallCenterX - halfWidth;
      z1 = wallCenterZ;
      x2 = wallCenterX + halfWidth;
      z2 = wallCenterZ;
    } else {
      // Wall extends along Z axis
      x1 = wallCenterX;
      z1 = wallCenterZ - halfWidth;
      x2 = wallCenterX;
      z2 = wallCenterZ + halfWidth;
    }

    y1 = wallCenterY;
    y2 = wallCenterY + WALL_HEIGHT - 1;

    // Store fill coordinates for teardown
    this._fillCoords = { x1, y1, z1, x2, y2, z2 };

    if (isLeadBot) {
      console.log(
        `[${bot.username}] Placing ${WALL_WIDTH}x${WALL_HEIGHT} wall at (${x1},${y1},${z1}) to (${x2},${y2},${z2})`,
      );
      const fillCmd = `fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} stone`;
      const fillRes = await rcon.send(fillCmd);
      console.log(`[${bot.username}] Wall fill result: ${fillRes}`);
    }

    this._evalMetadata = {
      wall_width: WALL_WIDTH,
      wall_height: WALL_HEIGHT,
      wall_center: { x: wallCenterX, y: wallCenterY, z: wallCenterZ },
      wall_axis: wallAxis,
    };

    // Both bots face the wall center so the wall is visible at episode start
    const wallCenterPos = new Vec3(
      wallCenterX + 0.5,
      wallCenterY + 1,
      wallCenterZ + 0.5,
    );

    return {
      botPositionNew: botPosition,
      otherBotPositionNew: wallCenterPos,
    };
  }

  async tearDownEpisode(bot, rcon, sharedBotRng, coordinator, episodeNum, args) {
    // Only the lead bot removes the wall
    if (this._isLeadBot && this._fillCoords) {
      const { x1, y1, z1, x2, y2, z2 } = this._fillCoords;
      console.log(
        `[${bot.username}] Removing wall at (${x1},${y1},${z1}) to (${x2},${y2},${z2})`,
      );
      const clearCmd = `fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} air`;
      try {
        const clearRes = await rcon.send(clearCmd);
        console.log(`[${bot.username}] Wall clear result: ${clearRes}`);
      } catch (err) {
        console.error(`[${bot.username}] Failed to clear wall:`, err);
      }
    }
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
      "wallWalkPhase",
      episodeNum,
      getOnWallWalkPhaseFn(
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
      "wallWalkPhase",
      bot.entity.position.clone(),
      episodeNum,
      "teleportPhase end",
    );
  }
}

module.exports = { WallWalkEvalEpisode };
