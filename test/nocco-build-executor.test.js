import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { createBuildExecutorRequestHandler } from "../src/build-executor-http.js";
import { KubernetesJobClient } from "../src/kubernetes-job-client.js";
import { NoccoBuildExecutor } from "../src/nocco-build-executor.js";
import { buildOperationId, loadNoccoBuildProjects } from "../src/nocco-build-template.js";
import { UnixBuildExecutorClient } from "../src/unix-build-executor-client.js";
import { SHA_A } from "./helpers.js";

const CHECKOUT_IMAGE = `registry.example/forge/git@sha256:${"a".repeat(64)}`;
const BUILDER_IMAGE = `registry.example/forge/node@sha256:${"b".repeat(64)}`;
const policies = loadNoccoBuildProjects({ projects: [{
  projectId: "adesco-webb",
  repository: "https://github.com/mkjellma/adesco.git",
  allowedBranch: "main",
  buildProfile: "nextjs-npm",
  deployKeySecret: "adesco-github-deploy-key",
  githubKnownHostsConfigMap: "github-com-known-hosts"
}, {
  projectId: "other-webb",
  repository: "https://github.com/mkjellma/other.git",
  allowedBranch: "main",
  buildProfile: "nextjs-npm",
  deployKeySecret: "other-github-deploy-key",
  githubKnownHostsConfigMap: "github-com-known-hosts"
}] });

function project(projectId = "adesco-webb") {
  const policy = policies.get(projectId);
  return { projectId, repository: policy.repository, allowedBranch: policy.allowedBranch, buildProfile: policy.buildProfile };
}

async function call(handler, { method, url, body }) {
  const request = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), { method, url, headers: {} });
  const response = { status: null, body: null, writeHead(status) { this.status = status; }, end(bodyText) { this.body = JSON.parse(bodyText); } };
  await handler(request, response);
  return response;
}

test("Nocco-executorn skapar inventerade projektjobb och avvisar avvikande registerdata", async () => {
  const jobs = [];
  const executor = new NoccoBuildExecutor({
    checkoutImage: CHECKOUT_IMAGE,
    builderImage: BUILDER_IMAGE,
    policies,
    jobClient: {
      async createJob(job) { jobs.push(job); return { state: "created", name: job.metadata.name }; },
      async getJob() { throw new Error("not used by startBuild"); }
    }
  });
  const result = await executor.startBuild({ project: project(), commitSha: SHA_A });
  assert.deepEqual(result, { operationId: "forge-build-adesco-webb-aaaaaaaaaaaa", commitSha: SHA_A, state: "accepted" });
  assert.equal(jobs.length, 1);
  await assert.rejects(() => executor.startBuild({ project: { ...project(), repository: "https://github.com/other/repo.git" }, commitSha: SHA_A }), { code: "PROJECT_BUILD_NOT_ALLOWED" });
  await assert.rejects(() => executor.startBuild({ project: { ...project(), projectId: "missing" }, commitSha: SHA_A }), { code: "PROJECT_BUILD_NOT_ALLOWED" });
});

test("executorns privata HTTP-yta tar endast projectId och exakt SHA", async () => {
  const handler = createBuildExecutorRequestHandler({
    projectResolver: (projectId) => policies.get(projectId) ?? null,
    executor: { async startBuild({ project: resolved, commitSha }) { return { operationId: `build-${resolved.projectId}`, commitSha, state: "accepted" }; } }
  });
  const accepted = await call(handler, { method: "POST", url: "/v1/builds", body: { projectId: "adesco-webb", commitSha: SHA_A } });
  assert.equal(accepted.status, 202);
  assert.equal(accepted.body.operationId, "build-adesco-webb");
  const rejected = await call(handler, { method: "POST", url: "/v1/builds", body: { projectId: "adesco-webb", commitSha: SHA_A, command: "never" } });
  assert.equal(rejected.status, 400);
});

test("Forge-klienten använder enbart lokal Unix-socket med det begränsade buildpayloadet", async () => {
  const calls = [];
  const client = new UnixBuildExecutorClient({
    socketPath: "/var/run/forge-executor/executor.sock",
    requestFn(options, handler) {
      calls.push(options);
      const request = new EventEmitter();
      request.end = () => {
        const response = Readable.from([Buffer.from(JSON.stringify({ operationId: "forge-build-adesco-webb-aaaaaaaaaaaa", commitSha: SHA_A, state: "accepted" }))]);
        response.statusCode = 202;
        queueMicrotask(() => handler(response));
      };
      return request;
    }
  });
  const build = await client.startBuild({ project: { projectId: "adesco-webb" }, commitSha: SHA_A });
  assert.equal(build.operationId, "forge-build-adesco-webb-aaaaaaaaaaaa");
  assert.equal(calls[0].path, "/v1/builds");
});

test("executorn normaliserar status för ett inventerat projektjobb", async () => {
  const policy = policies.get("other-webb");
  const operationId = buildOperationId(policy, SHA_A);
  const executor = new NoccoBuildExecutor({
    checkoutImage: CHECKOUT_IMAGE,
    builderImage: BUILDER_IMAGE,
    policies,
    jobClient: {
      async createJob() { throw new Error("not used by getBuildStatus"); },
      async getJob({ namespace, name }) {
        assert.equal(namespace, "forge-build");
        assert.equal(name, operationId);
        return { metadata: { name, namespace, labels: { "forge.lyra/project": "other-webb", "forge.lyra/commit": SHA_A } }, status: { succeeded: 1 } };
      }
    }
  });
  assert.deepEqual(await executor.getBuildStatus({ operationId }), { operationId, commitSha: SHA_A, state: "succeeded" });
});

test("Kubernetes Job-klienten normaliserar API-avslag utan response-innehåll", async () => {
  const client = new KubernetesJobClient({ apiOrigin: "https://kubernetes.default.svc:443", token: "token", fetchFn: async () => ({ status: 422, ok: false }) });
  await assert.rejects(() => client.createJob({ metadata: { name: "forge-build-adesco-webb-aaaaaaaaaaaa", namespace: "forge-build" } }), { code: "KUBERNETES_JOB_REJECTED" });
});
