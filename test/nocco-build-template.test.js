import test from "node:test";
import assert from "node:assert/strict";
import { buildOperationId, createNoccoBuildJob, loadNoccoBuildProjects } from "../src/nocco-build-template.js";
import { createNoccoBuildExecutorRbac } from "../src/nocco-build-rbac.js";
import { SHA_A } from "./helpers.js";

const CHECKOUT_IMAGE = `registry.example/forge/git@sha256:${"a".repeat(64)}`;
const BUILDER_IMAGE = `registry.example/forge/node@sha256:${"b".repeat(64)}`;
const POLICIES = {
  projects: [
    {
      projectId: "adesco-webb",
      repository: "https://github.com/mkjellma/adesco.git",
      allowedBranch: "main",
      buildProfile: "nextjs-npm",
      deployKeySecret: "adesco-github-deploy-key",
      githubKnownHostsConfigMap: "github-com-known-hosts"
    },
    {
      projectId: "other-webb",
      repository: "https://github.com/mkjellma/other.git",
      allowedBranch: "release",
      buildProfile: "nextjs-npm",
      deployKeySecret: "other-github-deploy-key",
      githubKnownHostsConfigMap: "github-com-known-hosts"
    }
  ]
};

test("Nocco-buildern använder ägarinventerade projekt med fasta nextjs-npm-jobb", () => {
  const policies = loadNoccoBuildProjects(POLICIES);
  const policy = policies.get("adesco-webb");
  const job = createNoccoBuildJob({ policy, commitSha: SHA_A, checkoutImage: CHECKOUT_IMAGE, builderImage: BUILDER_IMAGE });
  assert.equal(policies.size, 2);
  assert.equal(policy.checkoutRepository, "git@github.com:mkjellma/adesco.git");
  assert.equal(job.metadata.namespace, "forge-build");
  assert.equal(job.metadata.name, "forge-build-adesco-webb-aaaaaaaaaaaa");
  assert.equal(buildOperationId(policy, SHA_A), job.metadata.name);
  assert.equal(job.metadata.labels["forge.lyra/project"], "adesco-webb");
  assert.equal(job.spec.template.spec.serviceAccountName, "forge-build-job");
  assert.equal(job.spec.template.spec.automountServiceAccountToken, false);
  assert.equal(job.spec.template.spec.initContainers[0].image, CHECKOUT_IMAGE);
  assert.equal(job.spec.template.spec.containers[0].image, BUILDER_IMAGE);
  assert.equal(job.spec.template.spec.initContainers[0].securityContext.runAsUser, 0);
  assert.equal(job.spec.template.spec.containers[0].securityContext.runAsNonRoot, true);
  assert.deepEqual(job.spec.template.spec.containers[0].args, ["set -eu\nnpm ci\nnpm run build"]);
  assert.deepEqual(job.spec.template.spec.initContainers[0].env.slice(0, 3), [
    { name: "FORGE_CHECKOUT_REPOSITORY", value: "git@github.com:mkjellma/adesco.git" },
    { name: "FORGE_BRANCH", value: "main" },
    { name: "FORGE_COMMIT_SHA", valueFrom: { fieldRef: { fieldPath: "metadata.labels['forge.lyra/commit']" } } }
  ]);
  assert.match(job.spec.template.spec.initContainers[0].env.find((entry) => entry.name === "GIT_SSH_COMMAND").value, /StrictHostKeyChecking=yes/);
  assert.deepEqual(job.spec.template.spec.initContainers[0].volumeMounts.slice(-3), [
    { name: "github-deploy-key", mountPath: "/var/run/forge-git-key", readOnly: true },
    { name: "github-known-hosts", mountPath: "/var/run/forge-git-known-hosts", readOnly: true },
    { name: "checkout-ssh", mountPath: "/var/run/forge-git" }
  ]);
  assert.equal(job.spec.template.spec.containers[0].volumeMounts.some((mount) => mount.name.includes("github") || mount.name === "checkout-ssh"), false);
  assert.equal(Object.isFrozen(job), true);
});

test("Nocco-inventeringen avvisar fria repositories, profiler och secret-referenser", () => {
  assert.throws(() => loadNoccoBuildProjects({ projects: [{ ...POLICIES.projects[0], repository: "https://github.com/mkjellma/adesco" }] }), { code: "INVALID_BUILD_PROJECT_POLICY" });
  assert.throws(() => loadNoccoBuildProjects({ projects: [{ ...POLICIES.projects[0], buildProfile: "shell" }] }), { code: "INVALID_BUILD_PROJECT_POLICY" });
  assert.throws(() => loadNoccoBuildProjects({ projects: [{ ...POLICIES.projects[0], deployKeySecret: "../../escape" }] }), { code: "INVALID_BUILD_PROJECT_POLICY" });
  const policy = loadNoccoBuildProjects(POLICIES).get("adesco-webb");
  assert.throws(() => createNoccoBuildJob({ policy, commitSha: SHA_A, checkoutImage: "alpine:latest", builderImage: BUILDER_IMAGE }), { code: "INVALID_CHECKOUT_IMAGE" });
});

test("executor-RBAC är endast Job create/get och buildjobbet får ingen token", () => {
  const contract = createNoccoBuildExecutorRbac({});
  assert.equal(contract.serviceAccount.metadata.namespace, "forge-system");
  assert.equal(contract.serviceAccount.automountServiceAccountToken, false);
  assert.equal(contract.buildJobServiceAccount.automountServiceAccountToken, false);
  assert.deepEqual(contract.role.rules, [{ apiGroups: ["batch"], resources: ["jobs"], verbs: ["create", "get"] }]);
  assert.deepEqual(contract.roleBinding.subjects, [{ kind: "ServiceAccount", name: "forge-build-executor", namespace: "forge-system" }]);
  assert.equal(Object.isFrozen(contract), true);
});
