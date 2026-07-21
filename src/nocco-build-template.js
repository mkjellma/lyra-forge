import { badRequest } from "./errors.js";
import { assertCommitSha } from "./validation.js";

const IMAGE_DIGEST = /^[a-z0-9][a-z0-9./_-]*@[sS][hH][aA]256:[a-f0-9]{64}$/;
const ADESCO_POLICY = Object.freeze({
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
  resources: Object.freeze({
    requests: Object.freeze({ cpu: "250m", memory: "512Mi", "ephemeral-storage": "1Gi" }),
    limits: Object.freeze({ cpu: "1", memory: "1536Mi", "ephemeral-storage": "2Gi" })
  })
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

function ownerImage(value, code) {
  if (typeof value !== "string" || !IMAGE_DIGEST.test(value)) throw badRequest(code);
  return value;
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

function resources() {
  return {
    requests: { ...ADESCO_POLICY.resources.requests },
    limits: { ...ADESCO_POLICY.resources.limits }
  };
}

/**
 * Owner-side factory for the only v0 build Job. It deliberately receives no
 * repository command, namespace, path, environment or resource data from
 * Forge or Lyra. Image digests are supplied only by a root-owned executor
 * bundle after an owner inventory has verified them.
 */
export function createAdescoNoccoBuildJob({ commitSha, checkoutImage, builderImage }) {
  const normalizedCommitSha = assertCommitSha(commitSha);
  const jobName = `forge-build-adesco-${normalizedCommitSha.slice(0, 12)}`;
  const images = {
    checkout: ownerImage(checkoutImage, "INVALID_CHECKOUT_IMAGE"),
    builder: ownerImage(builderImage, "INVALID_BUILDER_IMAGE")
  };
  const checkoutEnvironment = [
    { name: "FORGE_CHECKOUT_REPOSITORY", value: ADESCO_POLICY.checkoutRepository },
    { name: "FORGE_BRANCH", value: ADESCO_POLICY.branch },
    { name: "FORGE_COMMIT_SHA", valueFrom: { fieldRef: { fieldPath: "metadata.labels['forge.lyra/commit']" } } },
    { name: "GIT_TERMINAL_PROMPT", value: "0" },
    { name: "GIT_CONFIG_NOSYSTEM", value: "1" },
    { name: "GIT_SSH_COMMAND", value: "ssh -F /dev/null -i /var/run/forge-git/id_ed25519 -o BatchMode=yes -o IdentitiesOnly=yes -o PasswordAuthentication=no -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/var/run/forge-git-known-hosts/known_hosts -o GlobalKnownHostsFile=/dev/null" },
    { name: "GIT_CONFIG_COUNT", value: "1" },
    { name: "GIT_CONFIG_KEY_0", value: "safe.directory" },
    { name: "GIT_CONFIG_VALUE_0", value: "/workspace" }
  ];

  return Object.freeze({
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: Object.freeze({
      name: jobName,
      namespace: ADESCO_POLICY.namespace,
      labels: Object.freeze({
        "app.kubernetes.io/name": "forge-build",
        "forge.lyra/project": ADESCO_POLICY.projectId,
        "forge.lyra/commit": normalizedCommitSha
      })
    }),
    spec: Object.freeze({
      backoffLimit: 0,
      completions: 1,
      parallelism: 1,
      activeDeadlineSeconds: ADESCO_POLICY.activeDeadlineSeconds,
      ttlSecondsAfterFinished: ADESCO_POLICY.ttlSecondsAfterFinished,
      template: Object.freeze({
        metadata: Object.freeze({ labels: Object.freeze({
          "app.kubernetes.io/name": "forge-build",
          "forge.lyra/project": ADESCO_POLICY.projectId,
          "forge.lyra/commit": normalizedCommitSha
        }) }),
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
            command: Object.freeze(["/bin/sh", "-ec"]),
            args: Object.freeze([CHECKOUT_SCRIPT]),
            env: Object.freeze(checkoutEnvironment.map((entry) => Object.freeze({ ...entry }))),
            resources: Object.freeze(resources()),
            securityContext: Object.freeze(fixedSecurityContext()),
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
              secretName: ADESCO_POLICY.deployKeySecret,
              defaultMode: 288,
              items: Object.freeze([{ key: "id_ed25519", path: "id_ed25519" }])
            }) },
            { name: "github-known-hosts", configMap: Object.freeze({
              name: ADESCO_POLICY.githubKnownHostsConfigMap,
              defaultMode: 292,
              items: Object.freeze([{ key: "known_hosts", path: "known_hosts" }])
            }) }
          ])
        })
      })
    })
  });
}

export function noccoBuildPolicy() {
  return ADESCO_POLICY;
}
