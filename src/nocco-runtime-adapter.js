import { conflict } from "./errors.js";
import { assertCommitSha } from "./validation.js";

const DIGEST = /^sha256:[a-f0-9]{64}$/i;
const STATES = new Set(["pending", "succeeded", "failed"]);

function protocol() { return conflict("RUNTIME_EXECUTOR_PROTOCOL_VIOLATION"); }
function releaseId(value) { return typeof value === "string" && /^release-[1-9][0-9]*$/.test(value); }

/** Adapts the private executor socket to Forge's typed runtime capabilities. */
export class NoccoRuntimeAdapter {
  constructor({ client }) {
    for (const method of ["startRelease", "getReleaseStatus", "getWorkload", "restartWorkload"]) {
      if (!client || typeof client[method] !== "function") throw new TypeError("NOCCO_RUNTIME_CLIENT_REQUIRED");
    }
    this.client = client;
    this.producesArtifact = true;
  }

  async getRuntimeStatus(project) {
    const result = await this.client.getWorkload({ project });
    if (!result || !["pending", "running", "failed", "unknown"].includes(result.state) || (result.activeCommitSha !== null && assertCommitSha(result.activeCommitSha) !== result.activeCommitSha)) throw protocol();
    return Object.freeze({ state: result.state, activeCommitSha: result.activeCommitSha });
  }

  async startDeploy(project, release) {
    return this.start(project, release);
  }

  async rollback(project, release) {
    return this.start(project, release);
  }

  async start(project, release) {
    if (!releaseId(release?.releaseId) || assertCommitSha(release?.commitSha) !== release.commitSha) throw protocol();
    const result = await this.client.startRelease({ project, release });
    if (!result || typeof result.operationId !== "string" || result.operationId.length === 0 || result.commitSha !== release.commitSha) throw protocol();
    return Object.freeze({ deploymentId: result.operationId, commitSha: result.commitSha });
  }

  async getDeploymentStatus({ project, release, deploymentId }) {
    if (!releaseId(release?.releaseId) || typeof deploymentId !== "string") throw protocol();
    const result = await this.client.getReleaseStatus({ project, release, operationId: deploymentId });
    if (!result || result.operationId !== deploymentId || result.commitSha !== release.commitSha || !STATES.has(result.state) || (result.artifactId !== null && (typeof result.artifactId !== "string" || !DIGEST.test(result.artifactId)))) throw protocol();
    return Object.freeze({ deploymentId, commitSha: result.commitSha, artifactId: result.artifactId, state: result.state });
  }

  async restart(project) {
    const result = await this.client.restartWorkload({ project });
    if (!result || typeof result.operationId !== "string" || result.operationId.length === 0) throw protocol();
    return Object.freeze({ deploymentId: result.operationId });
  }
}
