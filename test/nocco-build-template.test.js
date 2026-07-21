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
  assert.equal(job.spec.template.spec.initContainers[0].terminationMessagePath, "/dev/termination-log");
  assert.equal(job.spec.template.spec.initContainers[0].terminationMessagePolicy, "File");
  assert.equal(job.spec.template.spec.containers[0].terminationMessagePath, "/dev/termination-log");
  assert.equal(job.spec.template.spec.containers[0].terminationMessagePolicy, "File");
  assert.deepEqual(job.spec.template.spec.containers[0].args, ["set -eu\nnpm ci\nnpm run build"]);
  assert.deepEqual(job.spec.template.spec.containers[0].env, [
    { name: "HOME", value: "/home/forge" },
    { name: "NPM_CONFIG_CACHE", value: "/workspace/.npm-cache" },
    { name: "TMPDIR", value: "/tmp" }
  ]);
  assert.equal(job.spec.template.spec.containers[0].securityContext.allowPrivilegeEscalation, false);
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
  assert.deepEqual(job.spec.template.spec.volumes, [
    { name: "workspace", emptyDir: { sizeLimit: "2Gi" } },
    { name: "runtime-tmp", emptyDir: { sizeLimit: "256Mi" } },
    { name: "runtime-home", emptyDir: { sizeLimit: "256Mi" } },
    { name: "checkout-ssh", emptyDir: { sizeLimit: "1Mi" } },
    { name: "github-deploy-key", secret: { secretName: "adesco-github-deploy-key", defaultMode: 288, items: [{ key: "id_ed25519", path: "id_ed25519" }] } },
    { name: "github-known-hosts", configMap: { name: "github-com-known-hosts", defaultMode: 292, items: [{ key: "known_hosts", path: "known_hosts" }] } }
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
    checkoutRepository: "git@github.com:mkjellma/adesco.git",
    deployKeySecret: "adesco-github-deploy-key",
    githubKnownHostsConfigMap: "github-com-known-hosts",
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
