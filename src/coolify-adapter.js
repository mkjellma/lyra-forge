import { conflict } from "./errors.js";
import { assertCommitSha } from "./validation.js";

const APPLICATION_ID = /^[A-Za-z0-9-]{6,128}$/;
const DEPLOYMENT_ID = /^[A-Za-z0-9-]{6,128}$/;
const RUNTIME_STATE = /^[a-z][a-z0-9_-]{0,63}$/;
const FAILED_DEPLOYMENT_STATES = new Set(["failed", "cancelled", "error"]);

function protocolError() {
  return conflict("COOLIFY_PROTOCOL_VIOLATION");
}

function requireApplicationId(project) {
  const applicationId = project?.coolifyApplicationUuid;
  if (typeof applicationId !== "string" || !APPLICATION_ID.test(applicationId)) throw protocolError();
  return applicationId;
}

function requireDeploymentId(deploymentId) {
  if (typeof deploymentId !== "string" || !DEPLOYMENT_ID.test(deploymentId)) throw protocolError();
  return deploymentId;
}

function responseObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw protocolError();
  return value;
}

function responseDeploymentId(value) {
  const deploymentId = responseObject(value).deployment_uuid;
  return requireDeploymentId(deploymentId);
}

function responseCommit(value) {
  if (value === null || value === undefined || value === "") return null;
  return assertCommitSha(value);
}

/**
 * Bounded translation of Forge capabilities to Coolify's documented application
 * API. The injected client owns authentication and transport; this adapter never
 * receives a token, logs a response body, or accepts free-form request data.
 */
export class CoolifyApiAdapter {
  constructor({ client }) {
    if (!client || typeof client.request !== "function") throw new TypeError("COOLIFY_CLIENT_REQUIRED");
    this.client = client;
  }

  async getRuntimeStatus(project) {
    const applicationId = requireApplicationId(project);
    const application = responseObject(await this.client.request(Object.freeze({
      method: "GET",
      path: `/applications/${applicationId}`
    })));
    if (application.uuid !== applicationId || typeof application.status !== "string" || !RUNTIME_STATE.test(application.status)) {
      throw protocolError();
    }
    return Object.freeze({ state: application.status, activeCommitSha: responseCommit(application.git_commit_sha) });
  }

  async startDeploy(project, commitSha) {
    const applicationId = requireApplicationId(project);
    const normalizedSha = assertCommitSha(commitSha);
    const updated = responseObject(await this.client.request(Object.freeze({
      method: "PATCH",
      path: `/applications/${applicationId}`,
      body: Object.freeze({ git_commit_sha: normalizedSha, is_auto_deploy_enabled: false })
    })));
    if (updated.uuid !== applicationId) throw protocolError();

    const deploymentId = responseDeploymentId(await this.client.request(Object.freeze({
      method: "POST",
      path: `/applications/${applicationId}/start`
    })));
    return Object.freeze({ deploymentId, commitSha: normalizedSha });
  }

  async getDeploymentStatus(deploymentId, expectedCommitSha) {
    const normalizedDeploymentId = requireDeploymentId(deploymentId);
    const expectedSha = assertCommitSha(expectedCommitSha);
    const deployment = responseObject(await this.client.request(Object.freeze({
      method: "GET",
      path: `/deployments/${normalizedDeploymentId}`
    })));
    if (deployment.deployment_uuid !== normalizedDeploymentId || responseCommit(deployment.commit) !== expectedSha || typeof deployment.status !== "string" || !RUNTIME_STATE.test(deployment.status)) {
      throw protocolError();
    }
    const state = deployment.status === "finished"
      ? "succeeded"
      : FAILED_DEPLOYMENT_STATES.has(deployment.status)
        ? "failed"
        : "pending";
    return Object.freeze({ deploymentId: normalizedDeploymentId, commitSha: expectedSha, state });
  }

  async restart(project) {
    const applicationId = requireApplicationId(project);
    const deploymentId = responseDeploymentId(await this.client.request(Object.freeze({
      method: "POST",
      path: `/applications/${applicationId}/restart`
    })));
    return Object.freeze({ deploymentId });
  }

  async rollback(project, commitSha) {
    return this.startDeploy(project, commitSha);
  }
}
