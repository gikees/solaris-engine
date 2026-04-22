const { Vec3 } = require("vec3");
const {
  gotoWithTimeout,
  initializePathfinder,
  lookAtSmooth,
  sneak,
  stopAll,
} = require("../../primitives/movement");
const { GoalXZ } = require("../../utils/bot-factory");
const { rconTp } = require("../../utils/coordination");
const { sleep } = require("../../utils/helpers");
const {
  hideNameTags,
  restoreNameTags,
} = require("../../utils/name-tag-visibility");
const { BaseEpisode } = require("../base-episode");

const CAMERA_SPEED_DEGREES_PER_SEC = 30;
const EPISODE_MIN_TICKS = 300;
const WALL_WIDTH = 9;
const WALL_HEIGHT = 3;
const WAYPOINT_TIMEOUT_MS = 8000;
const GAZE_OFFSET_DEG = 45;

function getOnWallOcclusionPhaseFn(
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
      "wallOcclusionPhase",
      bot.entity.position.clone(),
      episodeNum,
      "wallOcclusionPhase beginning",
    );

    const isWalker = episodeInstance._isWalker;
    const wallAxis = episodeInstance._wallAxis;
    const wallCenter = episodeInstance._wallCenter;
    const goLeft = episodeInstance._goLeft;

    // Sneak to signal evaluation start
    await sneak(bot);
    const startTick = bot.time.age;

    if (isWalker) {
      // Walker: navigate around the wall via 2 waypoints
      const halfWidth = Math.floor(WALL_WIDTH / 2);
      const cx = wallCenter.x + 0.5;
      const cz = wallCenter.z + 0.5;
      const walkerDist = 5.5;
      const crossDist = 1.5; // stop ~1 block past the wall

      let wp1x, wp1z, wp2x, wp2z;

      if (wallAxis === "x") {
        const walkerSide = episodeInstance._walkerSide;
        const edgeOffset = goLeft ? -(halfWidth + 2) : halfWidth + 2;

        wp1x = cx + edgeOffset;
        wp1z = cz + walkerSide * walkerDist;
        wp2x = cx + edgeOffset;
        wp2z = cz - walkerSide * crossDist;
      } else {
        const walkerSide = episodeInstance._walkerSide;
        const edgeOffset = goLeft ? -(halfWidth + 2) : halfWidth + 2;

        wp1x = cx + walkerSide * walkerDist;
        wp1z = cz + edgeOffset;
        wp2x = cx - walkerSide * crossDist;
        wp2z = cz + edgeOffset;
      }

      const waypoints = [
        { x: wp1x, z: wp1z, label: "WP1 (past edge)" },
        { x: wp2x, z: wp2z, label: "WP2 (cross sides)" },
      ];

      initializePathfinder(bot, { allowSprinting: false });

      for (const wp of waypoints) {
        console.log(
          `[${bot.username}] Walking to ${wp.label}: (${wp.x.toFixed(1)}, ${wp.z.toFixed(1)})`,
        );
        try {
          await gotoWithTimeout(bot, new GoalXZ(wp.x, wp.z), {
            timeoutMs: WAYPOINT_TIMEOUT_MS,
          });
        } catch (err) {
          console.log(
            `[${bot.username}] Waypoint ${wp.label} timeout/error: ${err?.message || err}`,
          );
        }
        await bot.waitForTicks(5);
      }

      stopAll(bot);

      // Turn to face observer
      const otherEntity = bot.players[args.other_bot_name]?.entity;
      const currentOtherPos = otherEntity
        ? otherEntity.position
        : otherBotPosition;
      await lookAtSmooth(bot, currentOtherPos, CAMERA_SPEED_DEGREES_PER_SEC, {
        randomized: false,
        useEasing: false,
      });
    } else {
      // Observer: stand still, hold the oblique starting gaze
    }

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
      "wallOcclusionPhase end",
    );
  };
}

/**
 * Eval episode: same walker/observer/wall mechanics as wallWalkEval, but both
 * bots start with gazes rotated 45° off the wall-perpendicular, in the same
 * rotational sense — yielding antiparallel starting gazes on a single axis.
 * Name tags are hidden so the walker cannot cheat via the observer's tag.
 * @extends BaseEpisode
 */
class WallOcclusionEvalEpisode extends BaseEpisode {
  static WORKS_IN_NON_FLAT_WORLD = false;
  static INIT_MIN_BOTS_DISTANCE = 14;
  static INIT_MAX_BOTS_DISTANCE = 14;

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
    const isLeadBot = bot.username < args.other_bot_name;

    const walkerIsLead = sharedBotRng() < 0.5;
    this._isWalker = walkerIsLead === isLeadBot;

    this._goLeft = sharedBotRng() < 0.5;

    // Shared rotational sense for antiparallel gazes
    const rotateCW = sharedBotRng() < 0.5;

    const midX = (botPosition.x + otherBotPosition.x) / 2;
    const midY = botPosition.y;
    const midZ = (botPosition.z + otherBotPosition.z) / 2;

    const dx = otherBotPosition.x - botPosition.x;
    const dz = otherBotPosition.z - botPosition.z;
    const wallAxis = Math.abs(dx) > Math.abs(dz) ? "z" : "x";

    const wallCenterX = Math.floor(midX);
    const wallCenterY = Math.floor(midY);
    const wallCenterZ = Math.floor(midZ);

    this._wallCenter = new Vec3(wallCenterX, wallCenterY, wallCenterZ);
    this._wallAxis = wallAxis;
    this._isLeadBot = isLeadBot;

    const halfWidth = Math.floor(WALL_WIDTH / 2);
    let x1, y1, z1, x2, y2, z2;

    if (wallAxis === "x") {
      x1 = wallCenterX - halfWidth;
      z1 = wallCenterZ;
      x2 = wallCenterX + halfWidth;
      z2 = wallCenterZ;
    } else {
      x1 = wallCenterX;
      z1 = wallCenterZ - halfWidth;
      x2 = wallCenterX;
      z2 = wallCenterZ + halfWidth;
    }

    y1 = wallCenterY;
    y2 = wallCenterY + WALL_HEIGHT - 1;

    this._fillCoords = { x1, y1, z1, x2, y2, z2 };

    if (isLeadBot) {
      console.log(
        `[${bot.username}] Placing ${WALL_WIDTH}x${WALL_HEIGHT} wall at (${x1},${y1},${z1}) to (${x2},${y2},${z2})`,
      );
      const fillCmd = `fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} stone`;
      const fillRes = await rcon.send(fillCmd);
      console.log(`[${bot.username}] Wall fill result: ${fillRes}`);

      await hideNameTags(rcon, [bot.username, args.other_bot_name]);
    }

    this._evalMetadata = {
      wall_width: WALL_WIDTH,
      wall_height: WALL_HEIGHT,
      wall_center: { x: wallCenterX, y: wallCenterY, z: wallCenterZ },
      wall_axis: wallAxis,
      role: this._isWalker ? "walker" : "observer",
      walk_direction: this._goLeft ? "left" : "right",
      rotation_direction: rotateCW ? "cw" : "ccw",
      gaze_angle_deg: GAZE_OFFSET_DEG,
    };

    const walkerDist = 5.5;
    const observerDist = 7.5;
    const cx = wallCenterX + 0.5;
    const cz = wallCenterZ + 0.5;
    let botPosNew, otherPosNew;

    const botDist = this._isWalker ? walkerDist : observerDist;
    const otherDist = this._isWalker ? observerDist : walkerDist;

    if (wallAxis === "x") {
      const botSide = botPosition.z < midZ ? -1 : 1;
      botPosNew = new Vec3(cx, botPosition.y, cz + botSide * botDist);
      otherPosNew = new Vec3(cx, otherBotPosition.y, cz - botSide * otherDist);
      this._walkerSide = this._isWalker ? botSide : -botSide;
    } else {
      const botSide = botPosition.x < midX ? -1 : 1;
      botPosNew = new Vec3(cx + botSide * botDist, botPosition.y, cz);
      otherPosNew = new Vec3(cx - botSide * otherDist, otherBotPosition.y, cz);
      this._walkerSide = this._isWalker ? botSide : -botSide;
    }

    console.log(
      `[${bot.username}] Role: ${this._isWalker ? "WALKER" : "OBSERVER"}, direction: ${this._goLeft ? "left" : "right"}, rotate: ${rotateCW ? "CW" : "CCW"}`,
    );

    await rconTp(rcon, bot.username, botPosNew.x, botPosNew.y, botPosNew.z);
    await sleep(1000);

    // Build a fake-target 10 blocks away in this bot's rotated gaze direction.
    // Baseline = unit vector from this bot toward the other bot (XZ only).
    // Both bots apply the same rotation sign → antiparallel gazes on one axis.
    const baseDx = otherPosNew.x - botPosNew.x;
    const baseDz = otherPosNew.z - botPosNew.z;
    const mag = Math.sqrt(baseDx * baseDx + baseDz * baseDz) || 1;
    const ux = baseDx / mag;
    const uz = baseDz / mag;

    const theta = (GAZE_OFFSET_DEG * Math.PI) / 180;
    const s = rotateCW ? Math.sin(theta) : -Math.sin(theta);
    const c = Math.cos(theta);
    // 2D rotation about Y. With Minecraft's right-handed XZ plane:
    //   CW-from-above rotation matrix: [[c, s], [-s, c]] applied to (x, z).
    const rx = c * ux + s * uz;
    const rz = -s * ux + c * uz;

    const fakeTarget = new Vec3(
      botPosNew.x + rx * 10,
      botPosNew.y,
      botPosNew.z + rz * 10,
    );

    return {
      botPositionNew: botPosNew,
      otherBotPositionNew: fakeTarget,
    };
  }

  async tearDownEpisode(bot, rcon, sharedBotRng, coordinator, episodeNum, args) {
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
      await restoreNameTags(rcon);
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
      "wallOcclusionPhase",
      episodeNum,
      getOnWallOcclusionPhaseFn(
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
      "wallOcclusionPhase",
      bot.entity.position.clone(),
      episodeNum,
      "teleportPhase end",
    );
  }
}

module.exports = { WallOcclusionEvalEpisode };
