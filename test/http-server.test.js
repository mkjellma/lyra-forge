import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createForgeRequestHandler } from "../src/http-server.js";
import { SHA_A, makeForge } from "./helpers.js";

async function call(handler, { method, url, headers = {}, body }) {
  const request = Object.assign(
    Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]),
    { method, url, headers }
  );
  const response = {
    status: null,
    body: null,
    writeHead(status) {
      this.status = status;
    },
    end(bodyText) {
      this.body = JSON.parse(bodyText);
    }
  };
  await handler(request, response);
  return response;
}

test("HTTP API requires a bearer token and exposes the bounded deploy capability", async () => {
  const { forge } = makeForge();
  const handler = createForgeRequestHandler({ forge, apiToken: "test-token" });
  const rejected = await call(handler, { method: "GET", url: "/v1/projects/adesco" });
  assert.equal(rejected.status, 401);
  assert.deepEqual(rejected.body, { error: { code: "UNAUTHORIZED" } });

  const deployed = await call(handler, {
      method: "POST",
      url: "/v1/projects/adesco/deploy",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: { commitSha: SHA_A }
    });
  assert.equal(deployed.status, 200);
  assert.equal(deployed.body.release.state, "active");

  const status = await call(handler, {
    method: "GET",
    url: "/v1/projects/adesco",
    headers: { authorization: "Bearer test-token" }
  });
  assert.equal(status.body.activeRelease.commitSha, SHA_A);
});

test("HTTP API exposes a stable, content-free status contract for Lyra", async () => {
  const { forge } = makeForge();
  const handler = createForgeRequestHandler({ forge, apiToken: "test-token" });

  const rejected = await call(handler, { method: "GET", url: "/v1/status" });
  assert.equal(rejected.status, 401);

  const status = await call(handler, {
    method: "GET",
    url: "/v1/status",
    headers: { authorization: "Bearer test-token" }
  });
  assert.equal(status.status, 200);
  assert.deepEqual(status.body, {
    apiVersion: "v1",
    service: "lyra-forge",
    capabilities: [
      "projects.list",
      "projects.status",
      "projects.history",
      "projects.register",
      "build.request",
      "deploy.request",
      "deploy.restart",
      "deploy.pause",
      "deploy.rollback"
    ],
    projects: { total: 1, pending: 0, ready: 1 }
  });
});

test("Lyra-läsidentiteten kan endast läsa det begränsade statuskontraktet", async () => {
  const { forge } = makeForge();
  const handler = createForgeRequestHandler({
    forge,
    apiToken: "admin-token",
    lyraReadToken: "lyra-read-token"
  });
  const readHeaders = { authorization: "Bearer lyra-read-token" };

  const status = await call(handler, {
    method: "GET",
    url: "/v1/status",
    headers: readHeaders
  });
  assert.equal(status.status, 200);
  assert.deepEqual(status.body, {
    schema: "forge.read-status.v1",
    service: "lyra-forge",
    capabilities: ["forge.read_status"],
    projects: { total: 1 }
  });

  const adminStatus = await call(handler, {
    method: "GET",
    url: "/v1/status",
    headers: { authorization: "Bearer admin-token" }
  });
  assert.deepEqual(adminStatus.body.capabilities, [
    "projects.list",
    "projects.status",
    "projects.history",
    "projects.register",
    "build.request",
    "deploy.request",
    "deploy.restart",
    "deploy.pause",
    "deploy.rollback"
  ]);

  for (const request of [
    { method: "GET", url: "/v1/projects" },
    { method: "GET", url: "/v1/projects/adesco" },
    { method: "GET", url: "/v1/projects/adesco/releases" },
    { method: "POST", url: "/v1/projects", body: {} },
    { method: "POST", url: "/v1/projects/adesco/build", body: { commitSha: SHA_A } },
    { method: "POST", url: "/v1/projects/adesco/deploy", body: { commitSha: SHA_A } }
  ]) {
    const rejected = await call(handler, { ...request, headers: readHeaders });
    assert.equal(rejected.status, 401);
    assert.deepEqual(rejected.body, { error: { code: "UNAUTHORIZED" } });
  }

  const queryToken = await call(handler, {
    method: "GET",
    url: "/v1/status?token=lyra-read-token"
  });
  assert.equal(queryToken.status, 401);
});

test("en felkonfigurerad Lyra-läsidentitet avvisas av HTTP-servern", () => {
  const { forge } = makeForge();
  assert.throws(
    () => createForgeRequestHandler({ forge, apiToken: "same-token", lyraReadToken: "same-token" }),
    { message: "FORGE_LYRA_READ_TOKEN_MUST_DIFFER" }
  );
});

test("HTTP API lets Lyra register and list a pending private project without exposing the runtime engine", async () => {
  const provisioned = [];
  const { forge } = makeForge({
    projectProvisioner: {
      async provision(project) {
        provisioned.push(project.projectId);
        return { runtimeBinding: null };
      }
    }
  });
  const handler = createForgeRequestHandler({ forge, apiToken: "test-token" });
  const project = {
    projectId: "pilot-app",
    repository: "https://github.com/example/pilot-app.git",
    allowedBranch: "main",
    buildProfile: "nextjs-npm",
    runtimeProfile: "private-http",
    deployPolicy: "manual",
    healthCheck: { path: "/healthz", timeoutMs: 3000 },
    pollIntervalSeconds: 300
  };

  const created = await call(handler, {
    method: "POST",
    url: "/v1/projects",
    headers: { authorization: "Bearer test-token", "content-type": "application/json" },
    body: project
  });
  assert.equal(created.status, 201);
  assert.deepEqual(provisioned, ["pilot-app"]);
  assert.equal(created.body.project.provisioningState, "pending");
  assert.equal(created.body.project.runtimeBinding, undefined);

  const listed = await call(handler, {
    method: "GET",
    url: "/v1/projects",
    headers: { authorization: "Bearer test-token" }
  });
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.projects.map((candidate) => candidate.projectId), ["adesco", "pilot-app"]);
});
