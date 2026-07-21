import test from "node:test";
import assert from "node:assert/strict";
import { createNoccoArtifactJob, createNoccoRuntimeDeployment, createNoccoRuntimeService, loadNoccoRuntimeProjects } from "../src/nocco-runtime-template.js";
import { loadNoccoBuildProjects } from "../src/nocco-build-template.js";
import { SHA_A } from "./helpers.js";

const CHECKOUT = "docker.io/alpine/git@sha256:5e1543841d987081a1e0e37305039b2bb9908592a4cddad95b4c4c49d07653a3";
const NODE = "docker.io/library/node@sha256:4ba75f835bb8802193e4c114572113d4b26f95f6f094f4b5229d2a77773e0afc";
const ORAS = "docker.io/orasproject/oras@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DIGEST = `sha256:${"b".repeat(64)}`;

const buildProjects = loadNoccoBuildProjects({ projects: [{
  projectId: "adesco-webb",
  repository: "https://github.com/mkjellma/adesco.git",
  allowedBranch: "main",
  buildProfile: "nextjs-npm",
  deployKeySecret: "adesco-github-deploy-key",
  githubKnownHostsConfigMap: "github-com-known-hosts"
}] });

const runtimeProjects = loadNoccoRuntimeProjects({ projects: [{
  projectId: "adesco-webb",
  repository: "https://github.com/mkjellma/adesco.git",
  allowedBranch: "main",
  buildProfile: "nextjs-npm",
  runtimeProfile: "private-http",
  registryRepository: "forge/adesco-webb"
}] });

test("runtimeinventeringen ger en fast intern binding utan credentials", () => {
  const policy = runtimeProjects.get("adesco-webb");
  assert.deepEqual(policy.runtimeBinding, { kind: "kubernetes", namespace: "forge-runtime", workloadName: "adesco-webb" });
  assert.equal(Object.hasOwn(policy, "deployKeySecret"), false);
  assert.throws(() => loadNoccoRuntimeProjects({ projects: [{
    projectId: "adesco-webb", repository: "https://github.com/mkjellma/adesco.git", allowedBranch: "main",
    buildProfile: "nextjs-npm", runtimeProfile: "private-http", registryRepository: "../../escape"
  }] }), { code: "INVALID_RUNTIME_PROJECT_POLICY" });
});

test("artifactjobbet har fast checkout, build och intern ORAS-publicering", () => {
  const job = createNoccoArtifactJob({
    policy: runtimeProjects.get("adesco-webb"), buildPolicy: buildProjects.get("adesco-webb"), releaseId: "release-7", commitSha: SHA_A,
    checkoutImage: CHECKOUT, builderImage: NODE, publisherImage: ORAS, registryOrigin: "http://forge-registry.forge-artifacts.svc:5000"
  });
  assert.equal(job.metadata.namespace, "forge-build");
  assert.equal(job.metadata.name, "forge-artifact-adesco-webb-release-7");
  assert.equal(job.spec.template.spec.initContainers[1].name, "build");
  assert.deepEqual(job.spec.template.spec.containers[0].command.slice(0, 4), ["oras", "push", "--plain-http", "--disable-path-validation"]);
  assert.match(job.spec.template.spec.containers[0].command[4], new RegExp(`:${SHA_A}$`));
  assert.equal(job.spec.template.spec.initContainers[1].volumeMounts.some((mount) => mount.name === "git-key"), false);
});

test("runtimekandidaten hämtar immutable digest privat och exponeras bara genom ClusterIP-service", () => {
  const policy = runtimeProjects.get("adesco-webb");
  const deployment = createNoccoRuntimeDeployment({
    policy, releaseId: "release-7", commitSha: SHA_A, artifactDigest: DIGEST, nodeImage: NODE, orasImage: ORAS,
    registryOrigin: "http://forge-registry.forge-artifacts.svc:5000", healthCheck: { path: "/healthz", timeoutMs: 3000 }
  });
  const service = createNoccoRuntimeService(policy);
  assert.equal(deployment.metadata.namespace, "forge-runtime");
  assert.equal(deployment.spec.strategy.type, "Recreate");
  assert.match(deployment.spec.template.spec.initContainers[0].command[3], new RegExp(`@${DIGEST}$`));
  assert.equal(deployment.spec.template.spec.containers[0].command.join(" "), "npm start");
  assert.equal(service.spec.type, "ClusterIP");
  assert.equal(Object.hasOwn(service.spec, "externalIPs"), false);
});
