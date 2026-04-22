const test = require("node:test");
const assert = require("node:assert/strict");

const {
  hideNameTags,
  restoreNameTags,
  TEAM_NAME,
} = require("../../controller/utils/name-tag-visibility");

function makeRcon({ failOnCommand = null } = {}) {
  const calls = [];
  return {
    calls,
    async send(command) {
      calls.push(command);
      if (failOnCommand && command === failOnCommand) {
        throw new Error(`simulated failure: ${command}`);
      }
      return "";
    },
  };
}

test("hideNameTags issues the expected RCON sequence", async () => {
  const rcon = makeRcon();
  await hideNameTags(rcon, ["Alpha", "Bravo"]);
  assert.deepEqual(rcon.calls, [
    `team remove ${TEAM_NAME}`,
    `team add ${TEAM_NAME}`,
    `team modify ${TEAM_NAME} nametagVisibility never`,
    `team join ${TEAM_NAME} Alpha`,
    `team join ${TEAM_NAME} Bravo`,
  ]);
});

test("hideNameTags continues past team-remove error (idempotent)", async () => {
  const rcon = makeRcon({ failOnCommand: `team remove ${TEAM_NAME}` });
  await hideNameTags(rcon, ["Alpha"]);
  assert.deepEqual(rcon.calls, [
    `team remove ${TEAM_NAME}`,
    `team add ${TEAM_NAME}`,
    `team modify ${TEAM_NAME} nametagVisibility never`,
    `team join ${TEAM_NAME} Alpha`,
  ]);
});

test("restoreNameTags removes the team", async () => {
  const rcon = makeRcon();
  await restoreNameTags(rcon);
  assert.deepEqual(rcon.calls, [`team remove ${TEAM_NAME}`]);
});

test("restoreNameTags swallows errors (non-throwing)", async () => {
  const rcon = makeRcon({ failOnCommand: `team remove ${TEAM_NAME}` });
  await restoreNameTags(rcon);
  assert.deepEqual(rcon.calls, [`team remove ${TEAM_NAME}`]);
});
