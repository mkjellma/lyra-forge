import { badRequest } from "./errors.js";
import { assertCommitSha } from "./validation.js";

const IMAGE_DIGEST = /^[a-z0-9][a-z0-9./_-]*@[sS][hH][aA]256:[a-f0-9]{64}$/;
const PROJECT_ID = /^[a-z][a-z0-9-]{1,62}$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/;
const KUBERNETES_NAME = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const FIXED_PROFILE = "nextjs-npm";
const BUILD_NAMESPACE = "forge-build";
const FIXED_RESOURCES = Object.freeze({
  requests: Object.freeze({ cpu: "250m", memory: "512Mi", "ephemeral-storage": "1Gi" }),
  limits: Object.freeze({ cpu: "1", memory: "1536Mi", "ephemeral-storage": "2Gi" })
});

const CHECKOUT_SCRIPT = [
  "set -eu",
  "install -m 600 /var/run/forge-git-key/id_ed25519 /var/run/forge-git/id_ed25519",
  "git init /workspace",
  "git -C /workspace remote add origin \"$FORGE_CHECKOUT_REPOSITORY\"",
  "git -C /workspace fetch --no-tags origin \"$FORGE_BRANCH\"",
  "git -C /workspace update-ref refs/forge/allowed FETCH_HEAD",
  "git -C /workspace fetch --no-tags origin \"$FORGE_COMMIT_SHA\"",
  "git -C /workspace cat-file -e \"$FORGE_COMMIT_SHA^{commit}\"",
  "git -C /workspace merge-base --is-ancestor \"$FORGE_COMMIT_SHA\" refs/forge/allowed",
  "git -C /workspace checkout --detach \"$FORGE_COMMIT_SHA\""
].join("\n");

const BUILD_SCRIPT = "set -eu\nnpm ci\nnpm run build";

function policyError() {
  return badRequest("INVALID_BUILD_PROJECT_POLICY");
}

function ownerImage(value, code) {
  if (typeof value !== "string" || !IMAGE_DIGEST.test(value)) throw badRequest(code);
  return value;
}

function canonicalRepository(value) {
  if (typeof value !== "string") throw policyError();
  let url;
  try {
    url = new URL(value);
  } catch {
    throw policyError();
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.search || url.hash || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(url.pathname)) {
    throw policyError();
  }
  return url.toString();
}

function checkoutRepository(repository) {
  return `git@github.com:${new URL(repository).pathname.slice(1)}`;
}

function fixedSecurityContext() {
  return {
    allowPrivilegeEscalation: false,
    capabilities: { drop: ["ALL"] },
    readOnlyRootFilesystem: true,
    runAsNonRoot: true,
    runAsUser: 10001,
    runAsGroup: 10001,
    seccompProfile: { type: "RuntimeDefault" }
  };
}

function checkoutSecurityContext() {
  return {
    allowPrivilegeEscalation: false,
    capabilities: { drop: ["ALL"] },
    readOnlyRootFilesystem: true,
    runAsNonRoot: false,
    runAsUser: 0,
    runAsGroup: 0,
    seccompProfile: { type: "RuntimeDefault" }
  };
}

function resources() {
  return { requests: { ...FIXED_RESOURCES.requests }, limits: { ...FIXED_RESOURCES.limits } };
}

function exactKeys(value, keys) {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validatePolicy(source) {
  if (!source || typeof source !== "object" || Array.isArray(source) || !exactKeys(source, ["projectId", "repository", "allowedBranch", "buildProfile", "deployKeySecret", "githubKnownHostsConfigMap"])) {
    throw policyError();
  }
  if (typeof source.projectId !== "string" || !PROJECT_ID.test(source.projectId) || typeof source.allowedBranch !== "string" || !BRANCH.test(source.allowedBranch) || source.buildProfile !== FIXED_PROFILE) {
    throw policyError();
  }
  for (const field of ["deployKeySecret", "githubKnownHostsConfigMap"]) {
    if (typeof source[field] !== "string" || source[field].length > 63 || !KUBERNETES_NAME.test(source[field])) throw policyError();
  }
  const repository = canonicalRepository(source.repository);
  return Object.freeze({
    projectId: source.projectId,
    repository,
    checkoutRepository: checkoutRepository(repository),
    allowedBranch: source.allowedBranch,
    buildProfile: source.buildProfile,
    deployKeySecret: source.deployKeySecret,
    githubKnownHostsConfigMap: source.githubKnownHostsConfigMap
  });
}

/**
 * Owner-installed build inventory. Lyra can register a project, but only an
 * entry here grants the executor a fixed checkout identity and build profile.
 */
export function loadNoccoBuildProjects(source) {
  if (!source || typeof source !== "object" || Array.isArray(source) || !exactKeys(source, ["projects"]) || !Array.isArray(source.projects)) {
    throw policyError();
  }
  const projects = new Map();
  for (const candidate of source.projects) {
    const policy = validatePolicy(candidate);
    if (projects.has(policy.projectId)) throw policyError();
    projects.set(policy.projectId, policy);
  }
  return projects;
}

export function buildOperationId(policy, commitSha) {
  const normalizedCommitSha = assertCommitSha(commitSha);
  if (!policy || typeof policy.projectId !== "string") throw policyError();
  return `forge-build-${policy.projectId.slice(0, 30)}-${normalizedCommitSha.slice(0, 12)}`;
}

/**
 * A fixed v0 nextjs-npm Job. The owner inventory chooses the project and its
 * key reference; neither Lyra nor repository code can submit template fields.
 */
export function createNoccoBuildJob({ policy, commitSha, checkoutImage, builderImage }) {
  const normalizedCommitSha = assertCommitSha(commitSha);
  const jobName = buildOperationId(policy, normalizedCommitSha);
  const images = {
    checkout: ownerImage(checkoutImage, "INVALID_CHECKOUT_IMAGE"),
    builder: ownerImage(builderImage, "INVALID_BUILDER_IMAGE")
  };
  const checkoutEnvironment = [
    { name: "FORGE_CHECKOUT_REPOSITORY", value: policy.checkoutRepository },
    { name: "FORGE_BRANCH", value: policy.allowedBranch },
    { name: "FORGE_COMMIT_SHA", valueFrom: { fieldRef: { fieldPath: "metadata.labels['forge.lyra/commit']" } } },
    { name: "GIT_TERMINAL_PROMPT", value: "0" },
    { name: "GIT_CONFIG_NOSYSTEM", value: "1" },
    { name: "GIT_SSH_COMMAND", value: "ssh -F /dev/null -i /var/run/forge-git/id_ed25519 -o BatchMode=yes -o IdentitiesOnly=yes -o PasswordAuthentication=no -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/var/run/forge-git-known-hosts/known_hosts -o GlobalKnownHostsFile=/dev/null" },
    { name: "GIT_CONFIG_COUNT", value: "1" },
    { name: "GIT_CONFIG_KEY_0", value: "safe.directory" },
    { name: "GIT_CONFIG_VALUE_0", value: "/workspace" }
  ];
  const labels = Object.freeze({
    "app.kubernetes.io/name": "forge-build",
    "forge.lyra/project": policy.projectId,
    "forge.lyra/commit": normalizedCommitSha
  });

  return Object.freeze({
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: Object.freeze({ name: jobName, namespace: BUILD_NAMESPACE, labels }),
    spec: Object.freeze({
      backoffLimit: 0,
      completions: 1,
      parallelism: 1,
      activeDeadlineSeconds: 900,
      ttlSecondsAfterFinished: 3600,
      template: Object.freeze({
        metadata: Object.freeze({ labels }),
        spec: Object.freeze({
          restartPolicy: "Never",
          serviceAccountName: "forge-build-job",
          automountServiceAccountToken: false,
          enableServiceLinks: false,
          hostNetwork: false,
          hostPID: false,
          hostIPC: false,
          securityContext: Object.freeze({ fsGroup: 10001, seccompProfile: Object.freeze({ type: "RuntimeDefault" }) }),
          initContainers: Object.freeze([Object.freeze({
            name: "checkout",
            image: images.checkout,
            imagePullPolicy: "Never",
            terminationMessagePath: "/dev/termination-log",
            terminationMessagePolicy: "File",
            command: Object.freeze(["/bin/sh", "-ec"]),
            args: Object.freeze([CHECKOUT_SCRIPT]),
            env: Object.freeze(checkoutEnvironment.map((entry) => Object.freeze({ ...entry }))),
            resources: Object.freeze(resources()),
            securityContext: Object.freeze(checkoutSecurityContext()),
            volumeMounts: Object.freeze([
              { name: "workspace", mountPath: "/workspace" },
              { name: "runtime-tmp", mountPath: "/tmp" },
              { name: "runtime-home", mountPath: "/home/forge" },
              { name: "github-deploy-key", mountPath: "/var/run/forge-git-key", readOnly: true },
              { name: "github-known-hosts", mountPath: "/var/run/forge-git-known-hosts", readOnly: true },
              { name: "checkout-ssh", mountPath: "/var/run/forge-git" }
            ])
          })]),
          containers: Object.freeze([Object.freeze({
            name: "build",
            image: images.builder,
            imagePullPolicy: "Never",
            terminationMessagePath: "/dev/termination-log",
            terminationMessagePolicy: "File",
            command: Object.freeze(["/bin/sh", "-ec"]),
            args: Object.freeze([BUILD_SCRIPT]),
            env: Object.freeze([
              { name: "HOME", value: "/home/forge" },
              { name: "NPM_CONFIG_CACHE", value: "/workspace/.npm-cache" },
              { name: "TMPDIR", value: "/tmp" }
            ]),
            resources: Object.freeze(resources()),
            securityContext: Object.freeze(fixedSecurityContext()),
            volumeMounts: Object.freeze([
              { name: "workspace", mountPath: "/workspace" },
              { name: "runtime-tmp", mountPath: "/tmp" },
              { name: "runtime-home", mountPath: "/home/forge" }
            ]),
            workingDir: "/workspace"
          })]),
          volumes: Object.freeze([
            { name: "workspace", emptyDir: Object.freeze({ sizeLimit: "2Gi" }) },
            { name: "runtime-tmp", emptyDir: Object.freeze({ sizeLimit: "256Mi" }) },
            { name: "runtime-home", emptyDir: Object.freeze({ sizeLimit: "256Mi" }) },
            { name: "checkout-ssh", emptyDir: Object.freeze({ sizeLimit: "1Mi" }) },
            { name: "github-deploy-key", secret: Object.freeze({
              secretName: policy.deployKeySecret,
              defaultMode: 288,
              items: Object.freeze([{ key: "id_ed25519", path: "id_ed25519" }])
            }) },
            { name: "github-known-hosts", configMap: Object.freeze({
              name: policy.githubKnownHostsConfigMap,
              defaultMode: 292,
              items: Object.freeze([{ key: "known_hosts", path: "known_hosts" }])
            }) }
          ])
        })
      })
    })
  });
}
