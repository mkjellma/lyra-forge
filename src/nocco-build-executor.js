import { conflict } from "./errors.js";
import { createAdescoNoccoBuildJob, noccoBuildPolicy } from "./nocco-build-template.js";
import { assertCommitSha } from "./validation.js";

function protocolError() {
  return conflict("BUILD_EXECUTOR_PROTOCOL_VIOLATION");
}

function allowedProject(project) {
  const policy = noccoBuildPolicy();
  if (!project || project.projectId !== policy.projectId || project.repository !== policy.repository || project.allowedBranch !== policy.branch || project.buildProfile !== policy.buildProfile) {
    throw conflict("PROJECT_BUILD_NOT_ALLOWED");
  }
  return policy;
}

/**
 * The only live action an executor can take in the lab pilot: create the one
 * fixed Adesco build Job. It accepts no template fragments or free commands.
 */
export class NoccoBuildExecutor {
  constructor({ jobClient, checkoutImage, builderImage }) {
    if (!jobClient || typeof jobClient.createJob !== "function" || typeof jobClient.getJob !== "function") throw new TypeError("KUBERNETES_JOB_CLIENT_REQUIRED");
    this.jobClient = jobClient;
    this.checkoutImage = checkoutImage;
    this.builderImage = builderImage;
  }

  async startBuild({ project, commitSha }) {
    allowedProject(project);
    const job = createAdescoNoccoBuildJob({ commitSha, checkoutImage: this.checkoutImage, builderImage: this.builderImage });
    const result = await this.jobClient.createJob(job);
    if (!result || typeof result !== "object" || !["created", "exists"].includes(result.state) || result.name !== job.metadata.name) {
      throw protocolError();
    }
    return Object.freeze({ operationId: job.metadata.name, commitSha: job.metadata.labels["forge.lyra/commit"], state: "accepted" });
  }

  async getBuildStatus({ operationId }) {
    if (typeof operationId !== "string" || !/^forge-build-adesco-[a-f0-9]{12}$/.test(operationId)) throw protocolError();
    const policy = noccoBuildPolicy();
    const job = await this.jobClient.getJob({ namespace: policy.namespace, name: operationId });
    const commitSha = job?.metadata?.labels?.["forge.lyra/commit"];
    if (job?.metadata?.labels?.["forge.lyra/project"] !== policy.projectId || assertCommitSha(commitSha).slice(0, 12) !== operationId.slice(-12)) {
      throw protocolError();
    }
    const conditions = Array.isArray(job.status?.conditions) ? job.status.conditions : [];
    const failed = job.status?.failed > 0 || conditions.some((condition) => condition?.type === "Failed" && condition.status === "True");
    const complete = job.status?.succeeded > 0 || conditions.some((condition) => condition?.type === "Complete" && condition.status === "True");
    return Object.freeze({ operationId, commitSha, state: failed ? "failed" : complete ? "succeeded" : "pending" });
  }
}
