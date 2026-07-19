import { conflict, notFound } from "./errors.js";
import { assertBoolean, assertCommitSha } from "./validation.js";
import { SingleBuildQueue } from "./build-queue.js";

function errorCategory(error, fallback) {
  return typeof error?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(error.code)
    ? error.code
    : fallback;
}

export class ForgeService {
  constructor({ registry, releases, audit, gitProvider, buildExecutor, runtimeExecutor, stateStore = null, buildQueue = new SingleBuildQueue() }) {
    this.registry = registry;
    this.releases = releases;
    this.audit = audit;
    this.gitProvider = gitProvider;
    this.buildExecutor = buildExecutor;
    this.runtimeExecutor = runtimeExecutor;
    this.stateStore = stateStore;
    this.buildQueue = buildQueue;
  }

  async persist() {
    if (!this.stateStore) return;
    await this.stateStore.save({
      version: 1,
      pausedProjects: this.registry.exportPauseState(),
      releases: this.releases.exportState(),
      audit: this.audit.exportState(),
      gitProviderState: this.gitProvider.exportState?.() ?? null
    });
  }

  getProjectStatus(projectId) {
    const project = this.registry.get(projectId);
    return {
      projectId: project.projectId,
      deployPaused: this.registry.isPaused(projectId),
      activeRelease: this.releases.getActive(projectId),
      poll: this.gitProvider.getPollStatus?.(projectId) ?? { state: "unavailable", checkedAt: null, commitSha: null, errorCategory: null, etag: null }
    };
  }

  listDeployHistory(projectId) {
    this.registry.get(projectId);
    return this.releases.listByProject(projectId);
  }

  async pollProject(projectId, actorType = "system") {
    const project = this.registry.get(projectId);
    if (typeof this.gitProvider.poll !== "function") {
      throw conflict("GIT_PROVIDER_UNAVAILABLE");
    }
    const status = await this.gitProvider.poll(project);
    this.audit.append({
      action: "poll",
      projectId,
      actorType,
      outcome: status.state === "failed" ? "failed" : "succeeded",
      commitSha: status.commitSha,
      errorCategory: status.errorCategory
    });
    await this.persist();
    return status;
  }

  requestDeploy(projectId, commitSha, actorType = "lyra") {
    return this.buildQueue.run(() => this.performDeploy(projectId, commitSha, actorType));
  }

  async performDeploy(projectId, commitSha, actorType) {
    const project = this.registry.get(projectId);
    const normalizedSha = assertCommitSha(commitSha);
    if (this.registry.isPaused(projectId)) {
      this.audit.append({ action: "deploy", projectId, actorType, outcome: "rejected", commitSha: normalizedSha, errorCategory: "DEPLOY_PAUSED" });
      await this.persist();
      throw conflict("DEPLOY_PAUSED");
    }

    try {
      await this.gitProvider.assertAllowedCommit(project, normalizedSha);
    } catch (error) {
      this.audit.append({ action: "deploy", projectId, actorType, outcome: "rejected", commitSha: normalizedSha, errorCategory: errorCategory(error, "GIT_VALIDATION_FAILED") });
      await this.persist();
      throw error;
    }

    let build;
    try {
      build = await this.buildExecutor.build({ project, commitSha: normalizedSha });
      if (!build?.artifactId || typeof build.artifactId !== "string") {
        throw conflict("INVALID_BUILD_RESULT");
      }
    } catch (error) {
      this.audit.append({ action: "deploy", projectId, actorType, outcome: "failed", commitSha: normalizedSha, errorCategory: errorCategory(error, "BUILD_FAILED") });
      await this.persist();
      return { outcome: "failed", release: null };
    }

    const release = this.releases.create({ projectId, commitSha: normalizedSha, artifactId: build.artifactId });
    this.releases.record(release.releaseId, "checking");
    try {
      const healthy = await this.buildExecutor.health({ project, release });
      if (!healthy) {
        this.releases.record(release.releaseId, "failed", "HEALTH_CHECK_FAILED");
        this.audit.append({ action: "deploy", projectId, actorType, outcome: "failed", commitSha: normalizedSha, releaseId: release.releaseId, errorCategory: "HEALTH_CHECK_FAILED" });
        await this.persist();
        return { outcome: "failed", release: this.releases.getSummary(release.releaseId) };
      }
      this.releases.record(release.releaseId, "ready");
      await this.runtimeExecutor.activate({ project, release });
    } catch (error) {
      this.releases.record(release.releaseId, "failed", errorCategory(error, "ACTIVATION_FAILED"));
      this.audit.append({ action: "deploy", projectId, actorType, outcome: "failed", commitSha: normalizedSha, releaseId: release.releaseId, errorCategory: errorCategory(error, "ACTIVATION_FAILED") });
      await this.persist();
      return { outcome: "failed", release: this.releases.getSummary(release.releaseId) };
    }

    const priorActive = this.releases.getActive(projectId);
    if (priorActive) {
      this.releases.record(priorActive.releaseId, "previous");
    }
    this.releases.record(release.releaseId, "active");
    this.releases.setActive(projectId, release.releaseId);
    this.audit.append({ action: "deploy", projectId, actorType, outcome: "succeeded", commitSha: normalizedSha, releaseId: release.releaseId });
    await this.persist();
    return { outcome: "succeeded", release: this.releases.getSummary(release.releaseId) };
  }

  async restartService(projectId, actorType = "lyra") {
    const project = this.registry.get(projectId);
    const activeRelease = this.releases.getActive(projectId);
    if (!activeRelease) {
      throw conflict("NO_ACTIVE_RELEASE");
    }
    try {
      await this.runtimeExecutor.restart({ project, release: activeRelease });
      this.audit.append({ action: "restart", projectId, actorType, outcome: "succeeded", releaseId: activeRelease.releaseId });
      await this.persist();
      return activeRelease;
    } catch (error) {
      this.audit.append({ action: "restart", projectId, actorType, outcome: "failed", releaseId: activeRelease.releaseId, errorCategory: errorCategory(error, "RESTART_FAILED") });
      await this.persist();
      throw error;
    }
  }

  async setDeployPaused(projectId, paused, actorType = "lyra") {
    const value = assertBoolean(paused, "INVALID_PAUSE_VALUE");
    this.registry.setPaused(projectId, value);
    this.audit.append({ action: "pause", projectId, actorType, outcome: "succeeded" });
    await this.persist();
    return { projectId, deployPaused: value };
  }

  async rollbackProject(projectId, targetReleaseId, actorType = "lyra") {
    const project = this.registry.get(projectId);
    const target = this.releases.getSummary(targetReleaseId);
    if (target.projectId !== projectId) {
      throw notFound("RELEASE_NOT_FOUND");
    }
    if (target.state !== "previous") {
      throw conflict("ROLLBACK_TARGET_NOT_AVAILABLE");
    }
    const current = this.releases.getActive(projectId);
    try {
      await this.runtimeExecutor.activate({ project, release: target });
      if (current) {
        this.releases.record(current.releaseId, "previous");
      }
      this.releases.record(target.releaseId, "active");
      this.releases.setActive(projectId, target.releaseId);
      this.audit.append({ action: "rollback", projectId, actorType, outcome: "succeeded", releaseId: target.releaseId });
      await this.persist();
      return this.releases.getSummary(target.releaseId);
    } catch (error) {
      this.audit.append({ action: "rollback", projectId, actorType, outcome: "failed", releaseId: target.releaseId, errorCategory: errorCategory(error, "ROLLBACK_FAILED") });
      await this.persist();
      throw error;
    }
  }
}
