import test from "node:test";
import assert from "node:assert/strict";
import { TypedExecutorAdapter } from "../src/executor-contract.js";
import { SHA_A, exampleProject, makeForge } from "./helpers.js";
import { GithubRestPoller } from "../src/github-polling.js";

const ARTIFACT = `sha256:${"c".repeat(64)}`;

function transportFixture() {
  const calls = [];
  return {
    calls,
    transport: {
      async request(request) {
        calls.push(request);
        if (request.operation === "buildRegisteredCommit") return { artifactId: ARTIFACT };
        if (request.operation === "healthCheck") return { healthy: true };
        if (request.operation === "activateRelease") return { activated: true };
        if (request.operation === "restartActive") return { restarted: true };
        if (request.operation === "getRuntimeStatus") return { state: "active", activeReleaseId: "release-1" };
        throw new Error("unexpected fixture operation");
      }
    }
  };
}

test("typed executor adapter emits only bounded payloads and validates typed responses", async () => {
  const { calls, transport } = transportFixture();
  const executor = new TypedExecutorAdapter({ transport });

  assert.deepEqual(await executor.build({ project: exampleProject(), commitSha: SHA_A }), { artifactId: ARTIFACT });
  assert.equal(await executor.health({ release: { releaseId: "release-1" } }), true);
  await executor.activate({ release: { releaseId: "release-1" } });
  await executor.restart({ project: exampleProject() });
  assert.deepEqual(await executor.getRuntimeStatus("adesco"), { state: "active", activeReleaseId: "release-1" });
  assert.deepEqual(calls, [
    { operation: "buildRegisteredCommit", payload: { projectId: "adesco", commitSha: SHA_A } },
    { operation: "healthCheck", payload: { releaseId: "release-1" } },
    { operation: "activateRelease", payload: { releaseId: "release-1" } },
    { operation: "restartActive", payload: { projectId: "adesco" } },
    { operation: "getRuntimeStatus", payload: { projectId: "adesco" } }
  ]);
});

test("executor protocol rejects malformed results instead of accepting free-form execution data", async () => {
  const executor = new TypedExecutorAdapter({
    transport: { request: async () => ({ artifactId: "not-an-oci-digest", command: "never accepted" }) }
  });
  await assert.rejects(() => executor.build({ project: exampleProject(), commitSha: SHA_A }), { code: "EXECUTOR_PROTOCOL_VIOLATION" });
});

test("Forge deploy can run through the local GitHub and executor adapters without a network or container", async () => {
  const poller = new GithubRestPoller({
    fetchFn: async () => ({ status: 200, ok: true, headers: { get: () => null }, json: async () => [{ sha: SHA_A }] })
  });
  const { transport } = transportFixture();
  const executor = new TypedExecutorAdapter({ transport });
  const { forge } = makeForge({ gitProvider: poller, buildExecutor: executor, runtimeExecutor: executor });

  const result = await forge.requestDeploy("adesco", SHA_A);
  assert.equal(result.outcome, "succeeded");
  assert.equal(result.release.artifactId, ARTIFACT);
});

