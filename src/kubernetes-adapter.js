import { conflict } from "./errors.js";
import { assertCommitSha, assertRuntimeBinding } from "./validation.js";

const OPERATION_ID = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const WORKLOAD_STATES = new Set(["pending", "running", "failed", "unknown"]);
const RELEASE_STATES = new Set(["pending", "succeeded", "failed"]);

function protocolError() {
  return conflict("KUBERNETES_PROTOCOL_VIOLATION");
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function bindingFor(project) {
  const binding = assertRuntimeBinding(project?.runtimeBinding);
  if (binding === null) throw conflict("PROJECT_NOT_PROVISIONED");
  return binding;
}

function projectId(project) {
  if (typeof project?.projectId !== "string" || !/^[a-z][a-z0-9-]{1,62}$/.test(project.projectId)) throw protocolError();
  return project.projectId;
}

function operationId(value) {
  if (typeof value !== "string" || value.length > 63 || !OPERATION_ID.test(value)) throw protocolError();
  return value;
}

function commit(value) {
  try {
    return assertCommitSha(value);
  } catch {
    throw protocolError();
  }
}

/**
 * Forge's only Kubernetes boundary. The injected client is responsible for
 * mapping these fixed calls to Kubernetes Jobs and Deployments; Forge never
 * accepts manifests, kubectl arguments, namespaces or arbitrary resource names
 * from Lyra.
 */
export class KubernetesApiAdapter {
  constructor({ client }) {
    for (const method of ["getWorkload", "startRelease", "getReleaseStatus", "restartWorkload"]) {
      if (!client || typeof client[method] !== "function") throw new TypeError("KUBERNETES_CLIENT_REQUIRED");
    }
    this.client = client;
  }

  async getRuntimeStatus(project) {
    const binding = bindingFor(project);
    const result = await this.client.getWorkload(binding);
    if (!exactKeys(result, ["activeCommitSha", "state"]) || !WORKLOAD_STATES.has(result.state) || (result.activeCommitSha !== null && commit(result.activeCommitSha) !== result.activeCommitSha)) {
      throw protocolError();
    }
    return Object.freeze({ state: result.state, activeCommitSha: result.activeCommitSha });
  }

  async startDeploy(project, commitSha) {
    const binding = bindingFor(project);
    const normalizedCommitSha = commit(commitSha);
    const result = await this.client.startRelease(Object.freeze({ binding, projectId: projectId(project), commitSha: normalizedCommitSha }));
    if (!exactKeys(result, ["commitSha", "operationId"]) || operationId(result.operationId) !== result.operationId || commit(result.commitSha) !== normalizedCommitSha) {
      throw protocolError();
    }
    return Object.freeze({ deploymentId: result.operationId, commitSha: normalizedCommitSha });
  }

  async getDeploymentStatus({ project, release, deploymentId }) {
    const binding = bindingFor(project);
    const operation = operationId(deploymentId);
    const commitSha = commit(release?.commitSha);
    const releaseId = typeof release?.releaseId === "string" && /^release-[1-9][0-9]*$/.test(release.releaseId)
      ? release.releaseId
      : null;
    if (releaseId === null) throw protocolError();
    const result = await this.client.getReleaseStatus(Object.freeze({ binding, projectId: projectId(project), releaseId, operationId: operation, commitSha }));
    if (!exactKeys(result, ["commitSha", "operationId", "state"]) || result.operationId !== operation || commit(result.commitSha) !== commitSha || !RELEASE_STATES.has(result.state)) {
      throw protocolError();
    }
    return Object.freeze({ deploymentId: operation, commitSha, state: result.state });
  }

  async restart(project) {
    const result = await this.client.restartWorkload(Object.freeze({ binding: bindingFor(project), projectId: projectId(project) }));
    if (!exactKeys(result, ["operationId"]) || operationId(result.operationId) !== result.operationId) {
      throw protocolError();
    }
    return Object.freeze({ deploymentId: result.operationId });
  }

  async rollback(project, commitSha) {
    return this.startDeploy(project, commitSha);
  }
}
