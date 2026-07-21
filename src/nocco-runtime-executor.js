import { conflict } from "./errors.js";
import { assertCommitSha } from "./validation.js";
import { createNoccoArtifactJob, createNoccoRuntimeDeployment, createNoccoRuntimeService, runtimeOperationId } from "./nocco-runtime-template.js";

function protocolError() { return conflict("RUNTIME_EXECUTOR_PROTOCOL_VIOLATION"); }

function allowed(project, policy) {
  if (!policy || project?.projectId !== policy.projectId || project.repository !== policy.repository || project.allowedBranch !== policy.allowedBranch || project.buildProfile !== policy.buildProfile || project.runtimeProfile !== policy.runtimeProfile) {
    throw conflict("PROJECT_RUNTIME_NOT_ALLOWED");
  }
  return policy;
}

function jobState(job) {
  const conditions = Array.isArray(job?.status?.conditions) ? job.status.conditions : [];
  if (job?.status?.failed > 0 || conditions.some((entry) => entry?.type === "Failed" && entry.status === "True")) return "failed";
  if (job?.status?.succeeded > 0 || conditions.some((entry) => entry?.type === "Complete" && entry.status === "True")) return "succeeded";
  return "pending";
}

function deploymentState(deployment) {
  const conditions = Array.isArray(deployment?.status?.conditions) ? deployment.status.conditions : [];
  if (conditions.some((entry) => entry?.type === "Progressing" && entry.status === "False" && entry.reason === "ProgressDeadlineExceeded")) return "failed";
  if (deployment?.status?.availableReplicas >= 1) return "succeeded";
  return "pending";
}

function validService(service, policy) {
  return service?.metadata?.namespace === policy.runtimeBinding.namespace
    && service?.metadata?.name === policy.runtimeBinding.workloadName
    && service?.spec?.type === "ClusterIP"
    && service?.spec?.ports?.length === 1
    && service.spec.ports[0]?.port === 3000
    && service.spec.ports[0]?.targetPort === "http"
    && service.spec.selector?.["forge.lyra/project"] === policy.projectId;
}

function validCandidate(deployment, policy, release, commitSha, artifactDigest, nodeImage, orasImage) {
  return deployment?.metadata?.namespace === policy.runtimeBinding.namespace
    && deployment?.metadata?.name === runtimeOperationId(policy, release.releaseId)
    && deployment?.metadata?.labels?.["forge.lyra/project"] === policy.projectId
    && deployment?.metadata?.labels?.["forge.lyra/release"] === release.releaseId
    && deployment?.metadata?.labels?.["forge.lyra/commit"] === commitSha
    && deployment?.spec?.template?.metadata?.annotations?.["forge.lyra/artifact-digest"] === artifactDigest
    && deployment?.spec?.template?.spec?.automountServiceAccountToken === false
    && deployment?.spec?.template?.spec?.containers?.length === 1
    && deployment.spec.template.spec.containers[0]?.image === nodeImage
    && deployment.spec.template.spec.containers[0]?.command?.join(" ") === "npm start"
    && deployment?.spec?.template?.spec?.initContainers?.length === 2
    && deployment.spec.template.spec.initContainers[0]?.image === orasImage;
}

/**
 * Fixed artifact-to-runtime executor. It receives only a project object already
 * registered by Forge and a release record; all images, registry location and
 * Kubernetes names remain owner configuration.
 */
export class NoccoRuntimeExecutor {
  constructor({ jobClient, runtimeClient, registryClient, buildPolicies, runtimePolicies, checkoutImage, builderImage, publisherImage, nodeImage, orasImage, registryOrigin }) {
    if (!jobClient || typeof jobClient.createJob !== "function" || typeof jobClient.getJob !== "function" || !runtimeClient || typeof runtimeClient.createDeployment !== "function" || typeof runtimeClient.getDeployment !== "function" || typeof runtimeClient.createService !== "function" || typeof runtimeClient.patchService !== "function" || !registryClient || typeof registryClient.getManifestDigest !== "function" || !(buildPolicies instanceof Map) || !(runtimePolicies instanceof Map)) {
      throw new TypeError("NOCCO_RUNTIME_EXECUTOR_CONFIG_REQUIRED");
    }
    Object.assign(this, { jobClient, runtimeClient, registryClient, buildPolicies, runtimePolicies, checkoutImage, builderImage, publisherImage, nodeImage, orasImage, registryOrigin });
  }

  policy(project) {
    const runtimePolicy = allowed(project, this.runtimePolicies.get(project?.projectId));
    const buildPolicy = this.buildPolicies.get(project.projectId);
    if (!buildPolicy || buildPolicy.repository !== runtimePolicy.repository || buildPolicy.allowedBranch !== runtimePolicy.allowedBranch || buildPolicy.buildProfile !== runtimePolicy.buildProfile) throw conflict("PROJECT_RUNTIME_NOT_ALLOWED");
    return { runtimePolicy, buildPolicy };
  }

  async startRelease({ project, release }) {
    const { runtimePolicy, buildPolicy } = this.policy(project);
    const commitSha = assertCommitSha(release?.commitSha);
    if (typeof release?.releaseId !== "string" || !/^release-[1-9][0-9]*$/.test(release.releaseId)) throw protocolError();
    if (release.operation === "rollback") {
      if (typeof release.artifactId !== "string" || !/^sha256:[a-f0-9]{64}$/i.test(release.artifactId)) throw protocolError();
      await this.ensureCandidate({ policy: runtimePolicy, release, commitSha, artifactDigest: release.artifactId, healthCheck: project.healthCheck });
      return Object.freeze({ operationId: runtimeOperationId(runtimePolicy, release.releaseId), commitSha });
    }
    const job = createNoccoArtifactJob({ policy: runtimePolicy, buildPolicy, releaseId: release.releaseId, commitSha, checkoutImage: this.checkoutImage, builderImage: this.builderImage, publisherImage: this.publisherImage, registryOrigin: this.registryOrigin });
    const result = await this.jobClient.createJob(job);
    if (!result || !["created", "exists"].includes(result.state) || result.name !== job.metadata.name) throw protocolError();
    return Object.freeze({ operationId: job.metadata.name, commitSha });
  }

  async ensureCandidate({ policy, release, commitSha, artifactDigest, healthCheck }) {
    const deployment = createNoccoRuntimeDeployment({ policy, releaseId: release.releaseId, commitSha, artifactDigest, nodeImage: this.nodeImage, orasImage: this.orasImage, registryOrigin: this.registryOrigin, healthCheck });
    const service = createNoccoRuntimeService(policy);
    await this.runtimeClient.createService(service);
    const existingService = await this.runtimeClient.getService({ namespace: service.metadata.namespace, name: service.metadata.name });
    if (!validService(existingService, policy)) throw protocolError();
    const result = await this.runtimeClient.createDeployment(deployment);
    if (!result || !["created", "exists"].includes(result.state) || result.name !== deployment.metadata.name) throw protocolError();
    const existingDeployment = await this.runtimeClient.getDeployment({ namespace: deployment.metadata.namespace, name: deployment.metadata.name });
    if (!validCandidate(existingDeployment, policy, release, commitSha, artifactDigest, this.nodeImage, this.orasImage)) throw protocolError();
    return deployment.metadata.name;
  }

  async getReleaseStatus({ project, release, operationId }) {
    const { runtimePolicy } = this.policy(project);
    const commitSha = assertCommitSha(release?.commitSha);
    let artifactDigest = release.artifactId;
    let deploymentName = runtimeOperationId(runtimePolicy, release.releaseId);
    if (operationId.startsWith("forge-artifact-")) {
      const job = await this.jobClient.getJob({ namespace: "forge-build", name: operationId });
      if (job?.metadata?.labels?.["forge.lyra/project"] !== project.projectId || job?.metadata?.labels?.["forge.lyra/commit"] !== commitSha || job?.metadata?.labels?.["forge.lyra/release"] !== release.releaseId) throw protocolError();
      const build = jobState(job);
      if (build !== "succeeded") return Object.freeze({ operationId, commitSha, artifactId: null, state: build });
      artifactDigest = await this.registryClient.getManifestDigest({ repository: runtimePolicy.registryRepository, tag: commitSha });
      deploymentName = await this.ensureCandidate({ policy: runtimePolicy, release, commitSha, artifactDigest, healthCheck: project.healthCheck });
    }
    if (operationId !== deploymentName && !operationId.startsWith("forge-artifact-")) throw protocolError();
    const deployment = await this.runtimeClient.getDeployment({ namespace: "forge-runtime", name: deploymentName });
    if (!validCandidate(deployment, runtimePolicy, release, commitSha, artifactDigest, this.nodeImage, this.orasImage)) throw protocolError();
    const state = deploymentState(deployment);
    if (state === "succeeded") {
      await this.runtimeClient.patchService({ namespace: "forge-runtime", name: runtimePolicy.runtimeBinding.workloadName, patch: { spec: { selector: { "forge.lyra/project": project.projectId, "forge.lyra/release": release.releaseId } } } });
    }
    return Object.freeze({ operationId, commitSha, artifactId: artifactDigest ?? null, state });
  }

  async getWorkload(project) {
    const policy = allowed(project, this.runtimePolicies.get(project?.projectId));
    let service;
    try {
      service = await this.runtimeClient.getService({ namespace: policy.runtimeBinding.namespace, name: policy.runtimeBinding.workloadName });
    } catch (error) {
      if (error?.code === "RUNTIME_RESOURCE_NOT_FOUND") return Object.freeze({ state: "pending", activeCommitSha: null });
      throw error;
    }
    const releaseId = service?.spec?.selector?.["forge.lyra/release"];
    if (typeof releaseId !== "string" || releaseId === "none") return Object.freeze({ state: "pending", activeCommitSha: null });
    const deployment = await this.runtimeClient.getDeployment({ namespace: policy.runtimeBinding.namespace, name: runtimeOperationId(policy, releaseId) });
    const commitSha = deployment?.metadata?.labels?.["forge.lyra/commit"];
    return Object.freeze({ state: deploymentState(deployment) === "succeeded" ? "running" : "failed", activeCommitSha: assertCommitSha(commitSha) });
  }

  async restartWorkload({ project }) {
    const policy = allowed(project, this.runtimePolicies.get(project?.projectId));
    const service = await this.runtimeClient.getService({ namespace: policy.runtimeBinding.namespace, name: policy.runtimeBinding.workloadName });
    const releaseId = service?.spec?.selector?.["forge.lyra/release"];
    if (typeof releaseId !== "string" || releaseId === "none") throw conflict("NO_ACTIVE_RELEASE");
    const name = runtimeOperationId(policy, releaseId);
    await this.runtimeClient.patchDeployment({
      namespace: policy.runtimeBinding.namespace,
      name,
      patch: { spec: { template: { metadata: { annotations: { "forge.lyra/restarted-at": new Date().toISOString() } } } } }
    });
    return Object.freeze({ operationId: name });
  }
}
