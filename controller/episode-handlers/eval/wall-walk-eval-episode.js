const { Vec3 } = require("vec3");
const {
  lookAtSmooth,
  sneak,
  stopAll,
} = require("../../primitives/movement");
const { BaseEpisode } = require("../base-episode");

const CAMERA_SPEED_DEGREES_PER_SEC = 30;
const EPISODE_MIN_TICKS = 300;
const WALL_WIDTH = 9;
const WALL_HEIGHT = 3;
const WALK_TICKS = 40;
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

    // Pick walk direction along wall (same for both bots via sharedBotRng)
    const goLeft = sharedBotRng() < 0.5;

    // Retrieve wall info stored during setupEpisode
    const wallAxis = episodeInstance._wallAxis;

    // Compute walk direction vector along the wall axis
    let walkDirX, walkDirZ;
    if (wallAxis === "x") {
      walkDirX = goLeft ? -1 : 1;
      walkDirZ = 0;
    } else {
      walkDirX = 0;
      walkDirZ = goLeft ? -1 : 1;
    }

    // Record direction in metadata
    episodeInstance._evalMetadata.walk_direction = goLeft ? "left" : "right";
    episodeInstance._evalMetadata.walk_ticks = WALK_TICKS;

    console.log(
      `[${bot.username}] Wall walk: walking ${goLeft ? "left" : "right"} along ${wallAxis} axis for ${WALK_TICKS} ticks`,
    );

    // Sneak to signal evaluation start
    await sneak(bot);
    const startTick = bot.time.age;

    // Phase 1: Turn parallel to wall (same world direction for both bots)
    const me = bot.entity.position;
    const walkTarget = me.offset(walkDirX * 10, 0, walkDirZ * 10);
    await lookAtSmooth(bot, walkTarget, CAMERA_SPEED_DEGREES_PER_SEC, {
      randomized: false,
      useEasing: false,
    });

    // Phase 2: Walk the length of the wall (fixed tick count)
    bot.setControlState("forward", true);
    for (let i = 0; i < WALK_TICKS; i += WALK_TICK_INTERVAL) {
      const currentPos = bot.entity.position;
      const lookAhead = currentPos.offset(walkDirX * 10, 0, walkDirZ * 10);
      await lookAtSmooth(bot, lookAhead, 90, {
        randomized: false,
        useEasing: false,
      });
      await bot.waitForTicks(WALK_TICK_INTERVAL);
    }
    stopAll(bot);

    // Phase 3: Turn back toward other bot's current position
    const otherEntity = bot.players[args.other_bot_name]?.entity;
    const currentOtherPos = otherEntity
      ? otherEntity.position
      : otherBotPosition;
    await lookAtSmooth(bot, currentOtherPos, CAMERA_SPEED_DEGREES_PER_SEC, {
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
 * Eval episode where a wall spawns between bots, they turn the same direction
 * and walk parallel to the wall, then turn back to face each other.
 * @extends BaseEpisode
 */
class WallWalkEvalEpisode extends BaseEpisode {
  static WORKS_IN_NON_FLAT_WORLD = false;
  static INIT_MIN_BOTS_DISTANCE = 11;
  static INIT_MAX_BOTS_DISTANCE = 11;

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

    // Place bots in a straight line through wall center, 5 blocks from wall surface
    const distFromWall = 5.5; // 5 blocks from surface + 0.5 to wall block center
    const cx = wallCenterX + 0.5; // center of the wall block
    const cz = wallCenterZ + 0.5;
    let botPosNew, otherPosNew;

    if (wallAxis === "x") {
      // Wall along X → bots separated along Z, both at wall center X
      const botSide = botPosition.z < midZ ? -1 : 1;
      botPosNew = new Vec3(cx, botPosition.y, cz + botSide * distFromWall);
      otherPosNew = new Vec3(cx, otherBotPosition.y, cz - botSide * distFromWall);
    } else {
      // Wall along Z → bots separated along X, both at wall center Z
      const botSide = botPosition.x < midX ? -1 : 1;
      botPosNew = new Vec3(cx + botSide * distFromWall, botPosition.y, cz);
      otherPosNew = new Vec3(cx - botSide * distFromWall, otherBotPosition.y, cz);
    }

    return {
      botPositionNew: botPosNew,
      otherBotPositionNew: otherPosNew,
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
