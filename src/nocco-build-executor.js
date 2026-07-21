import { conflict } from "./errors.js";
import { createNoccoBuildJob } from "./nocco-build-template.js";
import { assertCommitSha } from "./validation.js";

function protocolError() {
  return conflict("BUILD_EXECUTOR_PROTOCOL_VIOLATION");
}

function allowedProject(project, policies) {
  const policy = policies.get(project?.projectId);
  if (!policy || project.repository !== policy.repository || project.allowedBranch !== policy.allowedBranch || project.buildProfile !== policy.buildProfile) {
    throw conflict("PROJECT_BUILD_NOT_ALLOWED");
  }
  return policy;
}

/**
 * The executor can create only owner-inventoried, fixed-profile build Jobs. It
 * accepts no template fragments, free commands, repositories or images.
 */
export class NoccoBuildExecutor {
  constructor({ jobClient, checkoutImage, builderImage, policies }) {
    if (!jobClient || typeof jobClient.createJob !== "function" || typeof jobClient.getJob !== "function") throw new TypeError("KUBERNETES_JOB_CLIENT_REQUIRED");
    if (!(policies instanceof Map)) throw new TypeError("BUILD_PROJECT_POLICIES_REQUIRED");
    this.jobClient = jobClient;
    this.checkoutImage = checkoutImage;
    this.builderImage = builderImage;
    this.policies = policies;
  }

  async startBuild({ project, commitSha }) {
    const policy = allowedProject(project, this.policies);
    const job = createNoccoBuildJob({ policy, commitSha, checkoutImage: this.checkoutImage, builderImage: this.builderImage });
    const result = await this.jobClient.createJob(job);
    if (!result || typeof result !== "object" || !["created", "exists"].includes(result.state) || result.name !== job.metadata.name) {
      throw protocolError();
    }
    return Object.freeze({ operationId: job.metadata.name, commitSha: job.metadata.labels["forge.lyra/commit"], state: "accepted" });
  }

  async getBuildStatus({ operationId }) {
    if (typeof operationId !== "string" || !/^forge-build-[a-z0-9-]{1,63}$/.test(operationId)) throw protocolError();
    const job = await this.jobClient.getJob({ namespace: "forge-build", name: operationId });
    const commitSha = job?.metadata?.labels?.["forge.lyra/commit"];
    const policy = this.policies.get(job?.metadata?.labels?.["forge.lyra/project"]);
    if (!policy || !operationId.endsWith(`-${assertCommitSha(commitSha).slice(0, 12)}`)) {
      throw protocolError();
    }
    const conditions = Array.isArray(job.status?.conditions) ? job.status.conditions : [];
    const failed = job.status?.failed > 0 || conditions.some((condition) => condition?.type === "Failed" && condition.status === "True");
    const complete = job.status?.succeeded > 0 || conditions.some((condition) => condition?.type === "Complete" && condition.status === "True");
    return Object.freeze({ operationId, commitSha, state: failed ? "failed" : complete ? "succeeded" : "pending" });
  }
}
