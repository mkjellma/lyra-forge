import test from "node:test";
import assert from "node:assert/strict";
import { createAdescoNoccoBuildJob, noccoBuildPolicy } from "../src/nocco-build-template.js";
import { createNoccoBuildExecutorRbac } from "../src/nocco-build-rbac.js";
import { SHA_A } from "./helpers.js";

const CHECKOUT_IMAGE = `registry.example/forge/git@sha256:${"a".repeat(64)}`;
const BUILDER_IMAGE = `registry.example/forge/node@sha256:${"b".repeat(64)}`;

test("Nocco-buildern kan bara skapa Adescos fasta, SHA-pinnade nextjs-npm-jobb", () => {
  const job = createAdescoNoccoBuildJob({ commitSha: SHA_A, checkoutImage: CHECKOUT_IMAGE, builderImage: BUILDER_IMAGE });
  assert.equal(job.metadata.namespace, "forge-build");
  assert.equal(job.metadata.name, "forge-build-adesco-aaaaaaaaaaaa");
  assert.equal(job.metadata.labels["forge.lyra/project"], "adesco-webb");
  assert.equal(job.spec.template.spec.serviceAccountName, "forge-build-job");
  assert.equal(job.spec.template.spec.automountServiceAccountToken, false);
  assert.equal(job.spec.template.spec.initContainers[0].image, CHECKOUT_IMAGE);
  assert.equal(job.spec.template.spec.containers[0].image, BUILDER_IMAGE);
  assert.deepEqual(job.spec.template.spec.containers[0].args, ["set -eu\nnpm ci\nnpm run build"]);
  assert.deepEqual(job.spec.template.spec.containers[0].env, [
    { name: "HOME", value: "/home/forge" },
    { name: "NPM_CONFIG_CACHE", value: "/workspace/.npm-cache" },
    { name: "TMPDIR", value: "/tmp" }
  ]);
  assert.equal(job.spec.template.spec.containers[0].securityContext.allowPrivilegeEscalation, false);
  assert.deepEqual(job.spec.template.spec.volumes, [
    { name: "workspace", emptyDir: { sizeLimit: "2Gi" } },
    { name: "runtime-tmp", emptyDir: { sizeLimit: "256Mi" } },
    { name: "runtime-home", emptyDir: { sizeLimit: "256Mi" } }
  ]);
  assert.match(job.spec.template.spec.initContainers[0].args[0], /refs\/forge\/allowed/);
  assert.deepEqual(job.spec.template.spec.initContainers[0].env.slice(-3), [
    { name: "GIT_CONFIG_COUNT", value: "1" },
    { name: "GIT_CONFIG_KEY_0", value: "safe.directory" },
    { name: "GIT_CONFIG_VALUE_0", value: "/workspace" }
  ]);
  assert.equal(job.spec.template.spec.securityContext.fsGroup, 10001);
  assert.equal(Object.isFrozen(job), true);
  assert.deepEqual(noccoBuildPolicy(), {
    projectId: "adesco-webb",
    namespace: "forge-build",
    repository: "https://github.com/mkjellma/adesco.git",
    branch: "main",
    allowedBranch: "main",
    buildProfile: "nextjs-npm",
    activeDeadlineSeconds: 900,
    ttlSecondsAfterFinished: 3600,
    resources: {
      requests: { cpu: "250m", memory: "512Mi", "ephemeral-storage": "1Gi" },
      limits: { cpu: "1", memory: "1536Mi", "ephemeral-storage": "2Gi" }
    }
  });
});

test("Nocco-buildern avvisar opinnade eller fria image-referenser", () => {
  assert.throws(
    () => createAdescoNoccoBuildJob({ commitSha: SHA_A, checkoutImage: "alpine:latest", builderImage: BUILDER_IMAGE }),
    { code: "INVALID_CHECKOUT_IMAGE" }
  );
  assert.throws(
    () => createAdescoNoccoBuildJob({ commitSha: "not-a-sha", checkoutImage: CHECKOUT_IMAGE, builderImage: BUILDER_IMAGE }),
    { code: "INVALID_COMMIT_SHA" }
  );
});

test("executor-RBAC är endast Job create/get och buildjobbet får ingen token", () => {
  const contract = createNoccoBuildExecutorRbac({});
  assert.equal(contract.serviceAccount.metadata.namespace, "forge-system");
  assert.equal(contract.serviceAccount.automountServiceAccountToken, false);
  assert.equal(contract.buildJobServiceAccount.automountServiceAccountToken, false);
  assert.deepEqual(contract.role.rules, [{ apiGroups: ["batch"], resources: ["jobs"], verbs: ["create", "get"] }]);
  assert.deepEqual(contract.roleBinding.subjects, [{ kind: "ServiceAccount", name: "forge-build-executor", namespace: "forge-system" }]);
  assert.equal(Object.isFrozen(contract), true);
  assert.throws(() => createNoccoBuildExecutorRbac({ serviceAccountName: "../../escape" }), { code: "INVALID_EXECUTOR_SERVICE_ACCOUNT" });
});
