import { conflict } from "./errors.js";

export class FixtureGitProvider {
  constructor(commitsByProject = {}) {
    this.commitsByProject = new Map(
      Object.entries(commitsByProject).map(([projectId, commits]) => [projectId, new Set(commits)])
    );
  }

  async assertAllowedCommit(project, commitSha) {
    if (!this.commitsByProject.get(project.projectId)?.has(commitSha)) {
      throw conflict("COMMIT_NOT_ALLOWED");
    }
  }
}

export class RejectingGitProvider {
  async assertAllowedCommit() {
    throw conflict("GIT_PROVIDER_UNAVAILABLE");
  }
}

export class FixtureBuildExecutor {
  constructor({ build = async ({ commitSha }) => ({ artifactId: `sha256:${commitSha.slice(0, 1).repeat(64)}` }), health = async () => true } = {}) {
    this.build = build;
    this.health = health;
  }
}

export class RejectingBuildExecutor {
  async build() {
    throw conflict("BUILD_EXECUTOR_UNAVAILABLE");
  }

  async health() {
    throw conflict("BUILD_EXECUTOR_UNAVAILABLE");
  }
}

export class RejectingBuildVerificationExecutor {
  async startBuild() {
    throw conflict("BUILD_EXECUTOR_UNAVAILABLE");
  }
}

export class FixtureRuntimeExecutor {
  constructor({ activate = async () => undefined, restart = async () => undefined } = {}) {
    this.activate = activate;
    this.restart = restart;
  }
}

export class RejectingRuntimeExecutor {
  async activate() {
    throw conflict("RUNTIME_EXECUTOR_UNAVAILABLE");
  }

  async restart() {
    throw conflict("RUNTIME_EXECUTOR_UNAVAILABLE");
  }
}
