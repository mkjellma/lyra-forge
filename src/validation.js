import { badRequest } from "./errors.js";

const SHA_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{1,62}$/;
const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/;
const COOLIFY_APPLICATION_ID_PATTERN = /^[A-Za-z0-9-]{6,128}$/;
const DEPLOY_POLICIES = new Set(["manual", "on-new-commit"]);

export function assertCommitSha(value) {
  if (typeof value !== "string" || !SHA_PATTERN.test(value)) {
    throw badRequest("INVALID_COMMIT_SHA");
  }
  return value.toLowerCase();
}

export function assertBoolean(value, code) {
  if (typeof value !== "boolean") {
    throw badRequest(code);
  }
  return value;
}

export function validateProject(project) {
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    throw badRequest("INVALID_PROJECT");
  }

  const requiredStrings = [
    "projectId",
    "repository",
    "allowedBranch",
    "buildProfile",
    "runtimeProfile",
    "deployPolicy"
  ];
  for (const field of requiredStrings) {
    if (typeof project[field] !== "string" || project[field].length === 0) {
      throw badRequest("INVALID_PROJECT");
    }
  }
  if (!PROJECT_ID_PATTERN.test(project.projectId)) {
    throw badRequest("INVALID_PROJECT_ID");
  }
  let repositoryUrl;
  try {
    repositoryUrl = new URL(project.repository);
  } catch {
    throw badRequest("INVALID_REPOSITORY");
  }
  if (repositoryUrl.protocol !== "https:" || repositoryUrl.hostname !== "github.com" || repositoryUrl.username || repositoryUrl.password) {
    throw badRequest("INVALID_REPOSITORY");
  }
  if (!BRANCH_PATTERN.test(project.allowedBranch)) {
    throw badRequest("INVALID_ALLOWED_BRANCH");
  }
  if (!DEPLOY_POLICIES.has(project.deployPolicy)) {
    throw badRequest("INVALID_DEPLOY_POLICY");
  }
  if (!project.healthCheck || typeof project.healthCheck !== "object") {
    throw badRequest("INVALID_HEALTH_CHECK");
  }
  if (typeof project.healthCheck.path !== "string" || !project.healthCheck.path.startsWith("/")) {
    throw badRequest("INVALID_HEALTH_CHECK");
  }
  if (!Number.isInteger(project.healthCheck.timeoutMs) || project.healthCheck.timeoutMs < 100) {
    throw badRequest("INVALID_HEALTH_CHECK");
  }
  if (!Number.isInteger(project.pollIntervalSeconds) || project.pollIntervalSeconds < 60) {
    throw badRequest("INVALID_POLL_INTERVAL");
  }
  if (project.coolifyApplicationUuid !== undefined && project.coolifyApplicationUuid !== null && (typeof project.coolifyApplicationUuid !== "string" || !COOLIFY_APPLICATION_ID_PATTERN.test(project.coolifyApplicationUuid))) {
    throw badRequest("INVALID_COOLIFY_APPLICATION");
  }

  return Object.freeze({
    projectId: project.projectId,
    repository: project.repository,
    allowedBranch: project.allowedBranch,
    buildProfile: project.buildProfile,
    runtimeProfile: project.runtimeProfile,
    deployPolicy: project.deployPolicy,
    healthCheck: Object.freeze({ ...project.healthCheck }),
    pollIntervalSeconds: project.pollIntervalSeconds,
    coolifyApplicationUuid: project.coolifyApplicationUuid ?? null
  });
}
