import { badRequest, conflict } from "./errors.js";
import { assertCommitSha } from "./validation.js";

function pollFailure(code) {
  return conflict(code);
}

function githubRepository(repository) {
  const url = new URL(repository);
  const parts = url.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/");
  if (url.hostname !== "github.com" || parts.length !== 2 || !parts[0] || !parts[1]) {
    throw pollFailure("INVALID_GITHUB_REPOSITORY");
  }
  return { owner: parts[0], repository: parts[1] };
}

function checkedStatus({ state, checkedAt, commitSha = null, errorCategory = null, etag = null }) {
  return Object.freeze({ state, checkedAt, commitSha, errorCategory, etag });
}

export class GithubRestPoller {
  constructor({ fetchFn, now = () => new Date().toISOString(), state = null }) {
    if (typeof fetchFn !== "function") throw new TypeError("FETCH_FUNCTION_REQUIRED");
    this.fetchFn = fetchFn;
    this.now = now;
    this.statuses = new Map();
    if (state) this.restoreState(state);
  }

  getPollStatus(projectId) {
    return this.statuses.get(projectId) ?? checkedStatus({ state: "never-polled", checkedAt: null });
  }

  async poll(project) {
    const { owner, repository } = githubRepository(project.repository);
    const endpoint = new URL(`https://api.github.com/repos/${owner}/${repository}/commits`);
    endpoint.searchParams.set("sha", project.allowedBranch);
    endpoint.searchParams.set("per_page", "1");
    const prior = this.getPollStatus(project.projectId);
    const headers = {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28"
    };
    if (prior.etag) headers["if-none-match"] = prior.etag;

    let response;
    try {
      response = await this.fetchFn(endpoint, { method: "GET", headers });
    } catch {
      return this.recordFailure(project.projectId, "GITHUB_POLL_UNAVAILABLE");
    }

    if (response.status === 304) {
      const status = checkedStatus({ state: "unchanged", checkedAt: this.now(), commitSha: prior.commitSha, etag: prior.etag });
      this.statuses.set(project.projectId, status);
      return status;
    }
    if (response.status === 401 || response.status === 403) {
      return this.recordFailure(project.projectId, "GITHUB_AUTH_FAILED");
    }
    if (response.status === 404) {
      return this.recordFailure(project.projectId, "GITHUB_REPOSITORY_UNAVAILABLE");
    }
    if (!response.ok) {
      return this.recordFailure(project.projectId, "GITHUB_POLL_FAILED");
    }

    let commits;
    try {
      commits = await response.json();
      if (!Array.isArray(commits) || commits.length !== 1) throw new Error("INVALID_RESPONSE");
      const commitSha = assertCommitSha(commits[0]?.sha);
      const status = checkedStatus({
        state: "candidate",
        checkedAt: this.now(),
        commitSha,
        etag: response.headers?.get?.("etag") ?? null
      });
      this.statuses.set(project.projectId, status);
      return status;
    } catch {
      return this.recordFailure(project.projectId, "GITHUB_INVALID_RESPONSE");
    }
  }

  async assertAllowedCommit(project, commitSha) {
    const status = await this.poll(project);
    if (status.state !== "candidate" && status.state !== "unchanged") {
      throw pollFailure(status.errorCategory ?? "GITHUB_POLL_FAILED");
    }
    if (status.commitSha !== commitSha) {
      throw conflict("COMMIT_NOT_ALLOWED");
    }
  }

  recordFailure(projectId, errorCategory) {
    const status = checkedStatus({ state: "failed", checkedAt: this.now(), errorCategory });
    this.statuses.set(projectId, status);
    return status;
  }

  exportState() {
    return { statuses: [...this.statuses.entries()].map(([projectId, status]) => [projectId, { ...status }]) };
  }

  restoreState(state) {
    if (!state || !Array.isArray(state.statuses)) throw badRequest("INVALID_POLL_STATE");
    for (const [projectId, status] of state.statuses) {
      if (typeof projectId !== "string" || !status || typeof status !== "object" || !["candidate", "unchanged", "failed"].includes(status.state) || typeof status.checkedAt !== "string" || (status.commitSha !== null && typeof status.commitSha !== "string") || (status.errorCategory !== null && typeof status.errorCategory !== "string") || (status.etag !== null && typeof status.etag !== "string")) {
        throw badRequest("INVALID_POLL_STATE");
      }
      this.statuses.set(projectId, checkedStatus(status));
    }
  }
}
