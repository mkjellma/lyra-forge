import test from "node:test";
import assert from "node:assert/strict";
import { SHA_A, SHA_B, makeForge } from "./helpers.js";

function deploymentFixture(states) {
  const calls = [];
  let nextDeployment = 1;
  const adapter = {
    calls,
    async getRuntimeStatus() {
      return { state: "running", activeCommitSha: SHA_A };
    },
    async startDeploy(project, commitSha) {
      calls.push({ operation: "deploy", projectId: project.projectId, commitSha });
      return { deploymentId: `deployment-${nextDeployment++}`, commitSha };
    },
    async getDeploymentStatus({ deploymentId, release, project }) {
      calls.push({ operation: "status", deploymentId, commitSha: release.commitSha, projectId: project.projectId });
      return { deploymentId, commitSha: release.commitSha, state: states.shift() ?? "pending" };
    },
    async restart(project) {
      calls.push({ operation: "restart", projectId: project.projectId });
      return { deploymentId: `restart-${nextDeployment++}` };
    },
    async rollback(project, commitSha) {
      calls.push({ operation: "rollback", projectId: project.projectId, commitSha });
      return { deploymentId: `deployment-${nextDeployment++}`, commitSha };
    }
  };
  return adapter;
}

test("Forge behåller en exakt SHA som väntande tills adaptern rapporterar lyckad rollout", async () => {
  const adapter = deploymentFixture(["pending", "succeeded"]);
  const { forge, audit } = makeForge({ runtimeExecutor: adapter, deploymentAdapter: adapter });

  const queued = await forge.requestDeploy("adesco", SHA_A);
  assert.equal(queued.outcome, "accepted");
  assert.equal(queued.release.state, "checking");
  assert.equal(queued.release.commitSha, SHA_A);

  const status = await forge.getProjectStatus("adesco");
  assert.equal(status.pendingRelease, null);
  assert.equal(status.activeRelease.commitSha, SHA_A);
  assert.deepEqual(audit.listByProject("adesco").map((entry) => [entry.action, entry.outcome]), [
    ["deploy", "accepted"],
    ["deploy", "succeeded"]
  ]);
});

test("misslyckad rollout lämnar föregående release aktiv", async () => {
  const adapter = deploymentFixture(["succeeded", "failed"]);
  const { forge } = makeForge({ runtimeExecutor: adapter, deploymentAdapter: adapter });

  await forge.requestDeploy("adesco", SHA_A);
  const failed = await forge.requestDeploy("adesco", SHA_B);

  assert.equal(failed.outcome, "failed");
  assert.equal(failed.release.state, "failed");
  assert.equal((await forge.getProjectStatus("adesco")).activeRelease.commitSha, SHA_A);
});

test("restart, deploypaus och rollback använder endast begränsade capabilities", async () => {
  const adapter = deploymentFixture(["succeeded", "succeeded", "pending", "succeeded"]);
  const { forge } = makeForge({ runtimeExecutor: adapter, deploymentAdapter: adapter });

  await forge.requestDeploy("adesco", SHA_A);
  await forge.requestDeploy("adesco", SHA_B);
  await forge.restartService("adesco");
  const previous = (await forge.listDeployHistory("adesco")).find((release) => release.state === "previous");
  const rollback = await forge.rollbackProject("adesco", previous.releaseId);
  assert.equal(rollback.outcome, "accepted");
  assert.equal(rollback.release.commitSha, SHA_A);
  assert.equal((await forge.getProjectStatus("adesco")).activeRelease.commitSha, SHA_A);

  await forge.setDeployPaused("adesco", true);
  await assert.rejects(() => forge.requestDeploy("adesco", SHA_B), { code: "DEPLOY_PAUSED" });
  assert.deepEqual(adapter.calls.filter((call) => call.operation === "deploy" || call.operation === "rollback"), [
    { operation: "deploy", projectId: "adesco", commitSha: SHA_A },
    { operation: "deploy", projectId: "adesco", commitSha: SHA_B },
    { operation: "rollback", projectId: "adesco", commitSha: SHA_A }
  ]);
});

test("Forge startar inte en andra build medan en registrerad rollout väntar", async () => {
  const adapter = deploymentFixture(["pending", "pending"]);
  const { forge } = makeForge({ runtimeExecutor: adapter, deploymentAdapter: adapter });

  await forge.requestDeploy("adesco", SHA_A);
  await assert.rejects(() => forge.requestDeploy("adesco", SHA_B), { code: "DEPLOYMENT_IN_PROGRESS" });
  assert.equal(adapter.calls.filter((call) => call.operation === "deploy").length, 1);
});
