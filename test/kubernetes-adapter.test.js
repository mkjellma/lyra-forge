import test from "node:test";
import assert from "node:assert/strict";
import { KubernetesApiAdapter } from "../src/kubernetes-adapter.js";
import { SHA_A, SHA_B, exampleProject, makeForge } from "./helpers.js";

function clientFixture() {
  const calls = [];
  return {
    calls,
    client: {
      async getWorkload(binding) {
        calls.push({ operation: "getWorkload", binding });
        return { state: "running", activeCommitSha: SHA_A };
      },
      async startRelease(request) {
        calls.push({ operation: "startRelease", ...request });
        return { operationId: "build-adesco-aaaaaaaaaaaa", commitSha: request.commitSha };
      },
      async getReleaseStatus(request) {
        calls.push({ operation: "getReleaseStatus", ...request });
        return { operationId: request.operationId, commitSha: request.commitSha, state: "succeeded" };
      },
      async restartWorkload(request) {
        calls.push({ operation: "restartWorkload", ...request });
        return { operationId: "restart-adesco" };
      }
    }
  };
}

test("Kubernetes-adaptern använder enbart fasta build- och workload-capabilities", async () => {
  const { calls, client } = clientFixture();
  const adapter = new KubernetesApiAdapter({ client });
  const project = exampleProject();
  const release = { releaseId: "release-1", commitSha: SHA_B };

  assert.deepEqual(await adapter.getRuntimeStatus(project), { state: "running", activeCommitSha: SHA_A });
  assert.deepEqual(await adapter.startDeploy(project, SHA_B), { deploymentId: "build-adesco-aaaaaaaaaaaa", commitSha: SHA_B });
  assert.deepEqual(await adapter.getDeploymentStatus({ project, release, deploymentId: "build-adesco-aaaaaaaaaaaa" }), {
    deploymentId: "build-adesco-aaaaaaaaaaaa",
    commitSha: SHA_B,
    state: "succeeded"
  });
  assert.deepEqual(await adapter.restart(project), { deploymentId: "restart-adesco" });
  assert.deepEqual(await adapter.rollback(project, SHA_A), { deploymentId: "build-adesco-aaaaaaaaaaaa", commitSha: SHA_A });

  assert.deepEqual(calls, [
    { operation: "getWorkload", binding: project.runtimeBinding },
    { operation: "startRelease", binding: project.runtimeBinding, projectId: "adesco", commitSha: SHA_B },
    { operation: "getReleaseStatus", binding: project.runtimeBinding, projectId: "adesco", releaseId: "release-1", operationId: "build-adesco-aaaaaaaaaaaa", commitSha: SHA_B },
    { operation: "restartWorkload", binding: project.runtimeBinding, projectId: "adesco" },
    { operation: "startRelease", binding: project.runtimeBinding, projectId: "adesco", commitSha: SHA_A }
  ]);
});

test("Kubernetes-adaptern avvisar fria resurser, shell-liknande data och felaktiga svar", async () => {
  const adapter = new KubernetesApiAdapter({
    client: {
      getWorkload: async () => ({ state: "running", activeCommitSha: SHA_A, command: "kubectl delete" }),
      startRelease: async () => ({ operationId: "build-adesco", commitSha: SHA_A }),
      getReleaseStatus: async () => ({ operationId: "build-adesco", commitSha: SHA_A, state: "succeeded" }),
      restartWorkload: async () => ({ operationId: "restart-adesco" })
    }
  });
  await assert.rejects(() => adapter.getRuntimeStatus(exampleProject()), { code: "KUBERNETES_PROTOCOL_VIOLATION" });
  await assert.rejects(() => adapter.startDeploy({ ...exampleProject(), runtimeBinding: { kind: "kubernetes", namespace: "forge", workloadName: "../../escape" } }, SHA_A), { code: "INVALID_RUNTIME_BINDING" });
});

test("Forge behåller exakt SHA tills Kubernetes rapporterar lyckad rollout", async () => {
  const { client } = clientFixture();
  const adapter = new KubernetesApiAdapter({ client });
  const { forge } = makeForge({ runtimeExecutor: adapter, deploymentAdapter: adapter });

  const result = await forge.requestDeploy("adesco", SHA_B);
  assert.equal(result.outcome, "succeeded");
  assert.equal(result.release.commitSha, SHA_B);
});
