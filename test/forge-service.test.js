import test from "node:test";
import assert from "node:assert/strict";
import { SHA_A, SHA_B, makeForge } from "./helpers.js";

test("deploy promotes a healthy exact commit and retains the prior release", async () => {
  const { forge, audit } = makeForge();
  const first = await forge.requestDeploy("adesco", SHA_A);
  const second = await forge.requestDeploy("adesco", SHA_B);

  assert.equal(first.outcome, "succeeded");
  assert.equal(second.release.state, "active");
  assert.equal((await forge.getProjectStatus("adesco")).activeRelease.commitSha, SHA_B);
  const history = await forge.listDeployHistory("adesco");
  assert.equal(history[0].state, "previous");
  assert.equal(history[1].state, "active");
  assert.deepEqual(Object.keys(audit.listByProject("adesco")[0]).sort(), [
    "action", "actorType", "at", "commitSha", "errorCategory", "outcome", "projectId", "releaseId"
  ]);
});

test("failed health check keeps the active release unchanged", async () => {
  const { forge } = makeForge({ health: async ({ release }) => release.commitSha === SHA_A });
  await forge.requestDeploy("adesco", SHA_A);
  const failed = await forge.requestDeploy("adesco", SHA_B);

  assert.equal(failed.outcome, "failed");
  assert.equal(failed.release.state, "failed");
  assert.equal((await forge.getProjectStatus("adesco")).activeRelease.commitSha, SHA_A);
});

test("a failed build creates no release artifact and records only a normalized category", async () => {
  const { forge, audit } = makeForge({ build: async () => { throw new Error("source output must never be audited"); } });
  const failed = await forge.requestDeploy("adesco", SHA_A);

  assert.deepEqual(failed, { outcome: "failed", release: null });
  assert.deepEqual(await forge.listDeployHistory("adesco"), []);
  assert.equal(audit.listByProject("adesco")[0].errorCategory, "BUILD_FAILED");
});

test("v0 serializes builds to protect a small host from concurrent build load", async () => {
  let runningBuilds = 0;
  let maximumRunningBuilds = 0;
  const gates = [];
  const { forge } = makeForge({
    build: async ({ commitSha }) => {
      runningBuilds += 1;
      maximumRunningBuilds = Math.max(maximumRunningBuilds, runningBuilds);
      await new Promise((resolve) => gates.push(resolve));
      runningBuilds -= 1;
      return { artifactId: `artifact-${commitSha.slice(0, 12)}` };
    }
  });

  const first = forge.requestDeploy("adesco", SHA_A);
  await new Promise((resolve) => setImmediate(resolve));
  const second = forge.requestDeploy("adesco", SHA_B);
  assert.equal(gates.length, 1);
  gates.shift()();
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gates.length, 1);
  gates.shift()();
  await second;
  assert.equal(maximumRunningBuilds, 1);
});


test("paused projects reject deploys and a retained release can be rolled back", async () => {
  const { forge } = makeForge();
  await forge.requestDeploy("adesco", SHA_A);
  await forge.requestDeploy("adesco", SHA_B);
  const previous = (await forge.listDeployHistory("adesco"))[0];
  const restored = await forge.rollbackProject("adesco", previous.releaseId);

  assert.equal(restored.outcome, "succeeded");
  assert.equal(restored.release.commitSha, SHA_A);
  await forge.setDeployPaused("adesco", true);
  await assert.rejects(() => forge.requestDeploy("adesco", SHA_B), { code: "DEPLOY_PAUSED" });
});
