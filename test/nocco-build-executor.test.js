import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { createBuildExecutorRequestHandler } from "../src/build-executor-http.js";
import { KubernetesJobClient } from "../src/kubernetes-job-client.js";
import { NoccoBuildExecutor } from "../src/nocco-build-executor.js";
import { noccoBuildPolicy } from "../src/nocco-build-template.js";
import { UnixBuildExecutorClient } from "../src/unix-build-executor-client.js";
import { SHA_A } from "./helpers.js";

const CHECKOUT_IMAGE = `registry.example/forge/git@sha256:${"a".repeat(64)}`;
const BUILDER_IMAGE = `registry.example/forge/node@sha256:${"b".repeat(64)}`;

async function call(handler, { method, url, body }) {
  const request = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), { method, url, headers: {} });
  const response = { status: null, body: null, writeHead(status) { this.status = status; }, end(bodyText) { this.body = JSON.parse(bodyText); } };
  await handler(request, response);
  return response;
}

test("Nocco-executorn skapar endast det fasta Adesco-jobbet och är idempotent per SHA", async () => {
  const jobs = [];
  const executor = new NoccoBuildExecutor({
    checkoutImage: CHECKOUT_IMAGE,
    builderImage: BUILDER_IMAGE,
    jobClient: {
      async createJob(job) { jobs.push(job); return { state: "created", name: job.metadata.name }; },
      async getJob() { throw new Error("not used by startBuild"); }
    }
  });
  const result = await executor.startBuild({ project: noccoBuildPolicy(), commitSha: SHA_A });
  assert.deepEqual(result, { operationId: "forge-build-adesco-aaaaaaaaaaaa", commitSha: SHA_A, state: "accepted" });
  assert.equal(jobs.length, 1);
  await assert.rejects(
    () => executor.startBuild({ project: { ...noccoBuildPolicy(), repository: "https://github.com/other/repo.git" }, commitSha: SHA_A }),
    { code: "PROJECT_BUILD_NOT_ALLOWED" }
  );
});

test("executorns privata HTTP-yta tar endast projectId och exakt SHA", async () => {
  const handler = createBuildExecutorRequestHandler({
    projectResolver: (projectId) => projectId === "adesco-webb" ? noccoBuildPolicy() : null,
    executor: { async startBuild({ project, commitSha }) { return { operationId: `build-${project.projectId}`, commitSha, state: "accepted" }; } }
  });
  const accepted = await call(handler, { method: "POST", url: "/v1/builds", body: { projectId: "adesco-webb", commitSha: SHA_A } });
  assert.equal(accepted.status, 202);
  assert.equal(accepted.body.operationId, "build-adesco-webb");
  const rejected = await call(handler, { method: "POST", url: "/v1/builds", body: { projectId: "adesco-webb", commitSha: SHA_A, command: "never" } });
  assert.deepEqual(rejected, { status: 400, body: { error: { code: "INVALID_BUILD_REQUEST" } }, writeHead: rejected.writeHead, end: rejected.end });
});

test("Forge-klienten använder enbart lokal Unix-socket med det begränsade buildpayloadet", async () => {
  const calls = [];
  const client = new UnixBuildExecutorClient({
    socketPath: "/var/run/forge-executor/executor.sock",
    requestFn(options, handler) {
      calls.push(options);
      const request = new EventEmitter();
      request.end = () => {
        const response = Readable.from([Buffer.from(JSON.stringify({ operationId: "forge-build-adesco-aaaaaaaaaaaa", commitSha: SHA_A, state: "accepted" }))]);
        response.statusCode = 202;
        queueMicrotask(() => handler(response));
      };
      return request;
    }
  });
  const build = await client.startBuild({ project: { projectId: "adesco-webb" }, commitSha: SHA_A });
  assert.deepEqual(build, { operationId: "forge-build-adesco-aaaaaaaaaaaa", commitSha: SHA_A, state: "accepted" });
  assert.deepEqual(calls, [{ socketPath: "/var/run/forge-executor/executor.sock", method: "POST", path: "/v1/builds", headers: { "content-type": "application/json" } }]);
});

test("Kubernetes Job-klienten skickar endast Jobbet till dess namngivna namespace", async () => {
  const requests = [];
  const client = new KubernetesJobClient({
    apiOrigin: "https://kubernetes.default.svc:443",
    token: "token",
    fetchFn: async (url, options) => {
      requests.push({ url, options });
      return { status: 201, ok: true, json: async () => ({ metadata: { name: "forge-build-adesco-aaaaaaaaaaaa", namespace: "forge-build" } }) };
    }
  });
  const result = await client.createJob({ metadata: { name: "forge-build-adesco-aaaaaaaaaaaa", namespace: "forge-build" } });
  assert.deepEqual(result, { state: "created", name: "forge-build-adesco-aaaaaaaaaaaa" });
  assert.equal(requests[0].url, "https://kubernetes.default.svc:443/apis/batch/v1/namespaces/forge-build/jobs");
  assert.equal(requests[0].options.headers.authorization, "Bearer token");
});

test("executorn rapporterar bara normaliserad Job-status", async () => {
  const executor = new NoccoBuildExecutor({
    checkoutImage: CHECKOUT_IMAGE,
    builderImage: BUILDER_IMAGE,
    jobClient: {
      async createJob() { throw new Error("not used by getBuildStatus"); },
      async getJob({ namespace, name }) {
        assert.equal(namespace, "forge-build");
        assert.equal(name, "forge-build-adesco-aaaaaaaaaaaa");
        return { metadata: { name, namespace, labels: { "forge.lyra/project": "adesco-webb", "forge.lyra/commit": SHA_A } }, status: { succeeded: 1 } };
      }
    }
  });
  assert.deepEqual(await executor.getBuildStatus({ operationId: "forge-build-adesco-aaaaaaaaaaaa" }), {
    operationId: "forge-build-adesco-aaaaaaaaaaaa", commitSha: SHA_A, state: "succeeded"
  });
});
