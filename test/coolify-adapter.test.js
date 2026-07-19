import test from "node:test";
import assert from "node:assert/strict";
import { CoolifyApiAdapter } from "../src/coolify-adapter.js";
import { SHA_A, SHA_B, exampleProject, makeForge } from "./helpers.js";

function clientFixture() {
  const calls = [];
  const responses = [
    { uuid: "adesco-app-1234", status: "running", git_commit_sha: SHA_A },
    { uuid: "adesco-app-1234" },
    { deployment_uuid: "deploy-1234" },
    { deployment_uuid: "deploy-1234", commit: SHA_B, status: "finished" },
    { deployment_uuid: "restart-1234" },
    { uuid: "adesco-app-1234" },
    { deployment_uuid: "rollback-1234" }
  ];
  return {
    calls,
    client: {
      async request(request) {
        calls.push(request);
        return responses.shift();
      }
    }
  };
}

test("Coolify-adaptern översätter endast typade Forge-capabilities till API-anrop", async () => {
  const { calls, client } = clientFixture();
  const coolify = new CoolifyApiAdapter({ client });
  const project = exampleProject();

  assert.deepEqual(await coolify.getRuntimeStatus(project), { state: "running", activeCommitSha: SHA_A });
  assert.deepEqual(await coolify.startDeploy(project, SHA_B), { deploymentId: "deploy-1234", commitSha: SHA_B });
  assert.deepEqual(await coolify.getDeploymentStatus("deploy-1234", SHA_B), {
    deploymentId: "deploy-1234",
    commitSha: SHA_B,
    state: "succeeded"
  });
  assert.deepEqual(await coolify.restart(project), { deploymentId: "restart-1234" });
  assert.deepEqual(await coolify.rollback(project, SHA_A), { deploymentId: "rollback-1234", commitSha: SHA_A });

  assert.deepEqual(calls, [
    { method: "GET", path: "/applications/adesco-app-1234" },
    {
      method: "PATCH",
      path: "/applications/adesco-app-1234",
      body: { git_commit_sha: SHA_B, is_auto_deploy_enabled: false }
    },
    { method: "POST", path: "/applications/adesco-app-1234/start" },
    { method: "GET", path: "/deployments/deploy-1234" },
    { method: "POST", path: "/applications/adesco-app-1234/restart" },
    {
      method: "PATCH",
      path: "/applications/adesco-app-1234",
      body: { git_commit_sha: SHA_A, is_auto_deploy_enabled: false }
    },
    { method: "POST", path: "/applications/adesco-app-1234/start" }
  ]);
});

test("Coolify-adaptern avvisar fria eller inkonsekventa motorresultat", async () => {
  const coolify = new CoolifyApiAdapter({
    client: { request: async () => ({ deployment_uuid: "deploy-1234", command: "never accepted" }) }
  });
  await assert.rejects(() => coolify.getRuntimeStatus(exampleProject()), { code: "COOLIFY_PROTOCOL_VIOLATION" });

  const wrongCommit = new CoolifyApiAdapter({
    client: { request: async () => ({ deployment_uuid: "deploy-1234", commit: SHA_A, status: "finished" }) }
  });
  await assert.rejects(() => wrongCommit.getDeploymentStatus("deploy-1234", SHA_B), { code: "COOLIFY_PROTOCOL_VIOLATION" });
});

test("Coolify-adaptern rapporterar väntande och misslyckade deploymenter utan logginnehåll", async () => {
  const pending = new CoolifyApiAdapter({
    client: { request: async () => ({ deployment_uuid: "deploy-1234", commit: SHA_A, status: "in_progress", logs: "must not escape" }) }
  });
  assert.deepEqual(await pending.getDeploymentStatus("deploy-1234", SHA_A), {
    deploymentId: "deploy-1234",
    commitSha: SHA_A,
    state: "pending"
  });

  const failed = new CoolifyApiAdapter({
    client: { request: async () => ({ deployment_uuid: "deploy-1234", commit: SHA_A, status: "failed", logs: "must not escape" }) }
  });
  assert.deepEqual(await failed.getDeploymentStatus("deploy-1234", SHA_A), {
    deploymentId: "deploy-1234",
    commitSha: SHA_A,
    state: "failed"
  });
});

test("Forge-status kan läsa den begränsade Coolify-runtimebilden", async () => {
  const coolify = new CoolifyApiAdapter({
    client: { request: async () => ({ uuid: "adesco-app-1234", status: "running", git_commit_sha: SHA_A }) }
  });
  const { forge } = makeForge({ runtimeExecutor: coolify });

  assert.deepEqual((await forge.getProjectStatus("adesco")).runtime, {
    state: "running",
    activeCommitSha: SHA_A
  });
});
