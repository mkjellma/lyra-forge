import { badRequest } from "./errors.js";
import { assertCommitSha } from "./validation.js";

const IMAGE_DIGEST = /^[a-z0-9][a-z0-9./_-]*@sha256:[a-f0-9]{64}$/i;
const PROJECT_ID = /^[a-z][a-z0-9-]{1,62}$/;
const KUBERNETES_NAME = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const RUNTIME_PROFILE = "private-http";
const BUILD_PROFILE = "nextjs-npm";
const BUILD_NAMESPACE = "forge-build";
const RUNTIME_NAMESPACE = "forge-runtime";

function policyError() {
  return badRequest("INVALID_RUNTIME_PROJECT_POLICY");
}

function exactKeys(value, keys) {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function name(value) {
  return typeof value === "string" && value.length <= 63 && KUBERNETES_NAME.test(value);
}

function image(value, code) {
  if (typeof value !== "string" || !IMAGE_DIGEST.test(value)) throw badRequest(code);
  return value;
}

function canonicalRepository(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.search || url.hash || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(url.pathname)) throw new Error();
    return url.toString();
  } catch {
    throw policyError();
  }
}

function workloadName(projectId, releaseId) {
  if (typeof releaseId !== "string" || !/^release-[1-9][0-9]*$/.test(releaseId)) throw policyError();
  return `forge-${projectId.slice(0, 46)}-${releaseId}`;
}

function securityContext() {
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

function resources({ cpu, memory, storage }) {
  return {
    requests: { cpu, memory, ...(storage ? { "ephemeral-storage": storage } : {}) },
    limits: { cpu: "1", memory: "1Gi", ...(storage ? { "ephemeral-storage": storage } : {}) }
  };
}

/**
 * Owner-installed runtime inventory. It intentionally contains no credentials:
 * GitHub keys remain in the separate build inventory/namespace.
 */
export function loadNoccoRuntimeProjects(source) {
  if (!exactKeys(source, ["projects"]) || !Array.isArray(source.projects)) throw policyError();
  const projects = new Map();
  for (const candidate of source.projects) {
    if (!exactKeys(candidate, ["projectId", "repository", "allowedBranch", "buildProfile", "runtimeProfile", "registryRepository"])) throw policyError();
    if (typeof candidate.projectId !== "string" || !PROJECT_ID.test(candidate.projectId)
      || typeof candidate.allowedBranch !== "string" || candidate.allowedBranch.length === 0
      || candidate.buildProfile !== BUILD_PROFILE || candidate.runtimeProfile !== RUNTIME_PROFILE
      || typeof candidate.registryRepository !== "string" || !/^[a-z0-9][a-z0-9._/-]{0,127}$/.test(candidate.registryRepository)) {
      throw policyError();
    }
    const policy = Object.freeze({
      projectId: candidate.projectId,
      repository: canonicalRepository(candidate.repository),
      allowedBranch: candidate.allowedBranch,
      buildProfile: candidate.buildProfile,
      runtimeProfile: candidate.runtimeProfile,
      registryRepository: candidate.registryRepository,
      runtimeBinding: Object.freeze({ kind: "kubernetes", namespace: RUNTIME_NAMESPACE, workloadName: candidate.projectId })
    });
    if (projects.has(policy.projectId)) throw policyError();
    projects.set(policy.projectId, policy);
  }
  return projects;
}

export function runtimeOperationId(policy, releaseId) {
  if (!policy || typeof policy.projectId !== "string") throw policyError();
  return workloadName(policy.projectId, releaseId);
}

export function artifactReference({ registryOrigin, policy, commitSha }) {
  if (typeof registryOrigin !== "string" || !/^https?:\/\/[a-z0-9.-]+(?::[0-9]+)?$/i.test(registryOrigin)) throw policyError();
  const sha = assertCommitSha(commitSha);
  if (!policy?.registryRepository) throw policyError();
  return `${registryOrigin.replace(/^https?:\/\//, "")}/${policy.registryRepository}:${sha}`;
}

/** A fixed publisher job: repository code never supplies a Dockerfile or command. */
export function createNoccoArtifactJob({ policy, buildPolicy, releaseId, commitSha, checkoutImage, builderImage, publisherImage, registryOrigin }) {
  const sha = assertCommitSha(commitSha);
  const jobName = `forge-artifact-${policy.projectId.slice(0, 42)}-${releaseId}`;
  if (!name(jobName) || !buildPolicy || buildPolicy.projectId !== policy.projectId) throw policyError();
  const checkout = image(checkoutImage, "INVALID_CHECKOUT_IMAGE");
  const builder = image(builderImage, "INVALID_BUILDER_IMAGE");
  const publisher = image(publisherImage, "INVALID_PUBLISHER_IMAGE");
  const reference = artifactReference({ registryOrigin, policy, commitSha: sha });
  const labels = {
    "app.kubernetes.io/name": "forge-artifact",
    "forge.lyra/project": policy.projectId,
    "forge.lyra/commit": sha,
    "forge.lyra/release": releaseId
  };
  const checkoutScript = [
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
  const buildScript = "set -eu\nnpm ci\nnpm run build\ntar -C /workspace -cf /staging/app.tar package.json package-lock.json node_modules .next";
  const checkoutEnv = [
    { name: "FORGE_CHECKOUT_REPOSITORY", value: buildPolicy.checkoutRepository },
    { name: "FORGE_BRANCH", value: buildPolicy.allowedBranch },
    { name: "FORGE_COMMIT_SHA", value: sha },
    { name: "GIT_TERMINAL_PROMPT", value: "0" },
    { name: "GIT_CONFIG_NOSYSTEM", value: "1" },
    { name: "GIT_SSH_COMMAND", value: "ssh -F /dev/null -i /var/run/forge-git/id_ed25519 -o BatchMode=yes -o IdentitiesOnly=yes -o PasswordAuthentication=no -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/var/run/forge-git-known-hosts/known_hosts -o GlobalKnownHostsFile=/dev/null" },
    { name: "GIT_CONFIG_COUNT", value: "1" },
    { name: "GIT_CONFIG_KEY_0", value: "safe.directory" },
    { name: "GIT_CONFIG_VALUE_0", value: "/workspace" }
  ];
  return Object.freeze({
    apiVersion: "batch/v1", kind: "Job", metadata: { name: jobName, namespace: BUILD_NAMESPACE, labels },
    spec: {
      backoffLimit: 0, activeDeadlineSeconds: 900, ttlSecondsAfterFinished: 3600,
      template: {
        metadata: { labels },
        spec: {
          restartPolicy: "Never", serviceAccountName: "forge-build-job", automountServiceAccountToken: false,
          enableServiceLinks: false, hostNetwork: false, hostPID: false, hostIPC: false,
          securityContext: { fsGroup: 10001, seccompProfile: { type: "RuntimeDefault" } },
          initContainers: [
            { name: "checkout", image: checkout, imagePullPolicy: "Never", command: ["/bin/sh", "-ec"], args: [checkoutScript], env: checkoutEnv, resources: resources({ cpu: "250m", memory: "512Mi", storage: "1Gi" }), securityContext: { ...securityContext(), runAsNonRoot: false, runAsUser: 0, runAsGroup: 0 }, volumeMounts: [{ name: "workspace", mountPath: "/workspace" }, { name: "git-key", mountPath: "/var/run/forge-git-key", readOnly: true }, { name: "known-hosts", mountPath: "/var/run/forge-git-known-hosts", readOnly: true }, { name: "checkout-ssh", mountPath: "/var/run/forge-git" }, { name: "tmp", mountPath: "/tmp" }, { name: "home", mountPath: "/home/forge" }] },
            { name: "build", image: builder, imagePullPolicy: "Never", command: ["/bin/sh", "-ec"], args: [buildScript], env: [{ name: "HOME", value: "/home/forge" }, { name: "NPM_CONFIG_CACHE", value: "/workspace/.npm-cache" }, { name: "TMPDIR", value: "/tmp" }], workingDir: "/workspace", resources: resources({ cpu: "250m", memory: "512Mi", storage: "2Gi" }), securityContext: securityContext(), volumeMounts: [{ name: "workspace", mountPath: "/workspace" }, { name: "staging", mountPath: "/staging" }, { name: "tmp", mountPath: "/tmp" }, { name: "home", mountPath: "/home/forge" }] }
          ],
          containers: [{ name: "publish", image: publisher, imagePullPolicy: "Never", command: ["oras", "push", "--plain-http", reference, "/staging/app.tar:application/vnd.lyra.forge.nextjs.v1.tar"], resources: resources({ cpu: "100m", memory: "128Mi", storage: "256Mi" }), securityContext: securityContext(), volumeMounts: [{ name: "staging", mountPath: "/staging", readOnly: true }, { name: "tmp", mountPath: "/tmp" }, { name: "home", mountPath: "/home/forge" }] }],
          volumes: [
            { name: "workspace", emptyDir: { sizeLimit: "2Gi" } }, { name: "staging", emptyDir: { sizeLimit: "2Gi" } },
            { name: "tmp", emptyDir: { sizeLimit: "256Mi" } }, { name: "home", emptyDir: { sizeLimit: "256Mi" } }, { name: "checkout-ssh", emptyDir: { sizeLimit: "1Mi" } },
            { name: "git-key", secret: { secretName: buildPolicy.deployKeySecret, defaultMode: 288, items: [{ key: "id_ed25519", path: "id_ed25519" }] } },
            { name: "known-hosts", configMap: { name: buildPolicy.githubKnownHostsConfigMap, defaultMode: 292, items: [{ key: "known_hosts", path: "known_hosts" }] } }
          ]
        }
      }
    }
  });
}

export function createNoccoRuntimeDeployment({ policy, releaseId, commitSha, artifactDigest, nodeImage, orasImage, healthCheck, registryOrigin }) {
  const sha = assertCommitSha(commitSha);
  if (typeof artifactDigest !== "string" || !/^sha256:[a-f0-9]{64}$/i.test(artifactDigest) || !healthCheck || typeof healthCheck.path !== "string" || !healthCheck.path.startsWith("/")) throw policyError();
  const deploymentName = runtimeOperationId(policy, releaseId);
  const labels = { "app.kubernetes.io/name": "forge-runtime", "forge.lyra/project": policy.projectId, "forge.lyra/release": releaseId, "forge.lyra/commit": sha };
  if (typeof registryOrigin !== "string" || !/^https?:\/\/[a-z0-9.-]+(?::[0-9]+)?$/i.test(registryOrigin)) throw policyError();
  const artifact = `${registryOrigin.replace(/^https?:\/\//, "")}/${policy.registryRepository}@${artifactDigest}`;
  const probe = { httpGet: { path: healthCheck.path, port: "http" }, timeoutSeconds: Math.max(1, Math.ceil(healthCheck.timeoutMs / 1000)), periodSeconds: 3, failureThreshold: 10 };
  return Object.freeze({
    apiVersion: "apps/v1", kind: "Deployment", metadata: { name: deploymentName, namespace: RUNTIME_NAMESPACE, labels },
    spec: {
      replicas: 1, progressDeadlineSeconds: 90, revisionHistoryLimit: 2,
      strategy: { type: "Recreate" }, selector: { matchLabels: { "forge.lyra/release": releaseId } },
      template: {
        metadata: { labels: { ...labels }, annotations: { "forge.lyra/artifact-digest": artifactDigest } },
        spec: {
          automountServiceAccountToken: false, enableServiceLinks: false,
          securityContext: { fsGroup: 10001, seccompProfile: { type: "RuntimeDefault" } },
          initContainers: [
            { name: "fetch-artifact", image: image(orasImage, "INVALID_ORAS_IMAGE"), imagePullPolicy: "Never", command: ["oras", "pull", "--plain-http", artifact, "--output", "/download"], securityContext: securityContext(), resources: resources({ cpu: "100m", memory: "128Mi", storage: "512Mi" }), volumeMounts: [{ name: "download", mountPath: "/download" }, { name: "tmp", mountPath: "/tmp" }, { name: "home", mountPath: "/home/forge" }] },
            { name: "unpack-artifact", image: image(nodeImage, "INVALID_RUNTIME_IMAGE"), imagePullPolicy: "Never", command: ["/bin/sh", "-ec"], args: ["set -eu\ntar -xf /download/app.tar -C /app"], securityContext: securityContext(), resources: resources({ cpu: "100m", memory: "128Mi", storage: "1Gi" }), volumeMounts: [{ name: "download", mountPath: "/download", readOnly: true }, { name: "app", mountPath: "/app" }, { name: "tmp", mountPath: "/tmp" }, { name: "home", mountPath: "/home/forge" }] }
          ],
          containers: [{ name: "app", image: image(nodeImage, "INVALID_RUNTIME_IMAGE"), imagePullPolicy: "Never", command: ["npm", "start"], workingDir: "/app", ports: [{ name: "http", containerPort: 3000 }], readinessProbe: probe, startupProbe: { ...probe, failureThreshold: 30 }, livenessProbe: probe, securityContext: securityContext(), resources: resources({ cpu: "100m", memory: "256Mi", storage: "512Mi" }), volumeMounts: [{ name: "app", mountPath: "/app", readOnly: true }, { name: "tmp", mountPath: "/tmp" }, { name: "home", mountPath: "/home/forge" }] }],
          volumes: [{ name: "download", emptyDir: { sizeLimit: "1Gi" } }, { name: "app", emptyDir: { sizeLimit: "1Gi" } }, { name: "tmp", emptyDir: { sizeLimit: "256Mi" } }, { name: "home", emptyDir: { sizeLimit: "128Mi" } }]
        }
      }
    }
  });
}

export function createNoccoRuntimeService(policy) {
  if (!policy?.projectId || !name(policy.runtimeBinding?.workloadName)) throw policyError();
  return Object.freeze({
    apiVersion: "v1", kind: "Service", metadata: { name: policy.runtimeBinding.workloadName, namespace: RUNTIME_NAMESPACE, labels: { "app.kubernetes.io/name": "forge-runtime", "forge.lyra/project": policy.projectId } },
    spec: { type: "ClusterIP", selector: { "forge.lyra/project": policy.projectId, "forge.lyra/release": "none" }, ports: [{ name: "http", port: 3000, targetPort: "http" }] }
  });
}
