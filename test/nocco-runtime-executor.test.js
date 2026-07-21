import test from "node:test";
import assert from "node:assert/strict";
import { NoccoRuntimeExecutor } from "../src/nocco-runtime-executor.js";
import { loadNoccoBuildProjects } from "../src/nocco-build-template.js";
import { loadNoccoRuntimeProjects } from "../src/nocco-runtime-template.js";
import { SHA_A, exampleProject } from "./helpers.js";

const CHECKOUT = "docker.io/alpine/git@sha256:5e1543841d987081a1e0e37305039b2bb9908592a4cddad95b4c4c49d07653a3";
const NODE = "docker.io/library/node@sha256:4ba75f835bb8802193e4c114572113d4b26f95f6f094f4b5229d2a77773e0afc";
const ORAS = "docker.io/orasproject/oras@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DIGEST = `sha256:${"c".repeat(64)}`;
const project = { ...exampleProject({ projectId: "adesco-webb", repository: "https://github.com/mkjellma/adesco.git", runtimeBinding: { kind: "kubernetes", namespace: "forge-runtime", workloadName: "forge-adesco-webb" } }), healthCheck: { path: "/healthz", timeoutMs: 3000 } };
const buildPolicies = loadNoccoBuildProjects({ projects: [{ projectId: "adesco-webb", repository: project.repository, allowedBranch: "main", buildProfile: "nextjs-npm", deployKeySecret: "adesco-github-deploy-key", githubKnownHostsConfigMap: "github-com-known-hosts" }] });
const runtimePolicies = loadNoccoRuntimeProjects({ projects: [{ projectId: "adesco-webb", repository: project.repository, allowedBranch: "main", buildProfile: "nextjs-npm", runtimeProfile: "private-http", registryRepository: "forge/adesco-webb" }] });

function makeExecutor({ job = { metadata: { labels: { "forge.lyra/project": "adesco-webb", "forge.lyra/commit": SHA_A, "forge.lyra/release": "release-1" } }, status: { succeeded: 1 } } } = {}) {
  const calls = [];
  let service;
  let deployment;
  const runtimeClient = {
    async createService(value) { service = value; calls.push(["service", value.metadata.name]); return { state: "created", name: value.metadata.name }; },
    async createDeployment(value) { deployment = { ...value, status: { availableReplicas: 1 } }; calls.push(["deployment", value.metadata.name]); return { state: "created", name: value.metadata.name }; },
    async getDeployment() { return deployment; },
    async patchService(value) { calls.push(["switch", value.patch.spec.selector["forge.lyra/release"]]); return {}; },
    async getService() { return service; },
    async patchDeployment() { return {}; }
  };
  const executor = new NoccoRuntimeExecutor({
    jobClient: { async createJob(value) { calls.push(["job", value.metadata.name]); return { state: "created", name: value.metadata.name }; }, async getJob() { return job; } },
    runtimeClient, registryClient: { async getManifestDigest() { return DIGEST; } }, buildPolicies, runtimePolicies,
    checkoutImage: CHECKOUT, builderImage: NODE, publisherImage: ORAS, nodeImage: NODE, orasImage: ORAS, registryOrigin: "http://forge-registry.forge-artifacts.svc:5000"
  });
  return { executor, calls };
}

test("runtimeexecutorn bygger en exakt artifact före kandidatens privata runtime", async () => {
  const { executor, calls } = makeExecutor();
  const release = { releaseId: "release-1", operation: "deploy", commitSha: SHA_A, artifactId: null };
  const started = await executor.startRelease({ project, release });
  assert.equal(started.operationId, "forge-artifact-adesco-webb-release-1");
  const status = await executor.getReleaseStatus({ project, release, operationId: started.operationId });
  assert.deepEqual(status, { operationId: started.operationId, commitSha: SHA_A, artifactId: DIGEST, state: "succeeded" });
  assert.deepEqual(calls.map(([operation]) => operation), ["job", "service", "deployment", "switch"]);
});

test("en misslyckad artifactbuild växlar aldrig den interna tjänsten", async () => {
  const { executor, calls } = makeExecutor({ job: { metadata: { labels: { "forge.lyra/project": "adesco-webb", "forge.lyra/commit": SHA_A, "forge.lyra/release": "release-1" } }, status: { failed: 1 } } });
  const release = { releaseId: "release-1", operation: "deploy", commitSha: SHA_A, artifactId: null };
  const started = await executor.startRelease({ project, release });
  assert.deepEqual(await executor.getReleaseStatus({ project, release, operationId: started.operationId }), { operationId: started.operationId, commitSha: SHA_A, artifactId: null, state: "failed" });
  assert.deepEqual(calls.map(([operation]) => operation), ["job"]);
});

test("ett provisionerat projekt utan första runtime-Service rapporterar pending", async () => {
  const { executor } = makeExecutor();
  executor.runtimeClient.getService = async () => {
    const error = new Error("not found");
    error.code = "RUNTIME_RESOURCE_NOT_FOUND";
    throw error;
  };
  assert.deepEqual(await executor.getWorkload(project), { state: "pending", activeCommitSha: null });
});
