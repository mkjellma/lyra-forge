import { conflict } from "./errors.js";
import { assertCommitSha } from "./validation.js";

const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/i;
const RELEASE_ID = /^release-[1-9][0-9]*$/;

function protocolError() {
  return conflict("EXECUTOR_PROTOCOL_VIOLATION");
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function requireProjectId(projectId) {
  if (typeof projectId !== "string" || !/^[a-z][a-z0-9-]{1,62}$/.test(projectId)) throw protocolError();
  return projectId;
}

function requireReleaseId(releaseId) {
  if (typeof releaseId !== "string" || !RELEASE_ID.test(releaseId)) throw protocolError();
  return releaseId;
}

function requireArtifactId(artifactId) {
  if (typeof artifactId !== "string" || !SHA256_DIGEST.test(artifactId)) throw protocolError();
  return artifactId;
}

function releasePayload(project, release) {
  return {
    projectId: requireProjectId(project?.projectId),
    releaseId: requireReleaseId(release?.releaseId),
    commitSha: assertCommitSha(release?.commitSha),
    artifactId: requireArtifactId(release?.artifactId)
  };
}

export class TypedExecutorAdapter {
  constructor({ transport }) {
    if (!transport || typeof transport.request !== "function") throw new TypeError("EXECUTOR_TRANSPORT_REQUIRED");
    this.transport = transport;
  }

  async build({ project, commitSha }) {
    const result = await this.request("buildRegisteredCommit", {
      projectId: requireProjectId(project.projectId),
      commitSha: assertCommitSha(commitSha)
    });
    if (!exactKeys(result, ["artifactId"]) || typeof result.artifactId !== "string" || !SHA256_DIGEST.test(result.artifactId)) throw protocolError();
    return result;
  }

  async health({ project, release }) {
    const result = await this.request("healthCheck", releasePayload(project, release));
    if (!exactKeys(result, ["healthy"]) || typeof result.healthy !== "boolean") throw protocolError();
    return result.healthy;
  }

  async activate({ project, release }) {
    const result = await this.request("activateRelease", releasePayload(project, release));
    if (!exactKeys(result, ["activated"]) || result.activated !== true) throw protocolError();
  }

  async restart({ project }) {
    const result = await this.request("restartActive", { projectId: requireProjectId(project.projectId) });
    if (!exactKeys(result, ["restarted"]) || result.restarted !== true) throw protocolError();
  }

  async getRuntimeStatus(project) {
    const projectId = typeof project === "string" ? project : project?.projectId;
    const result = await this.request("getRuntimeStatus", { projectId: requireProjectId(projectId) });
    if (!exactKeys(result, ["activeReleaseId", "state"]) || typeof result.state !== "string" || (result.activeReleaseId !== null && !RELEASE_ID.test(result.activeReleaseId))) {
      throw protocolError();
    }
    return Object.freeze({ state: result.state, activeReleaseId: result.activeReleaseId });
  }

  async request(operation, payload) {
    return this.transport.request(Object.freeze({ operation, payload: Object.freeze({ ...payload }) }));
  }
}
