import { conflict, notFound } from "./errors.js";
import { assertBoolean, assertCommitSha } from "./validation.js";
import { SingleBuildQueue } from "./build-queue.js";
import { PendingProjectProvisioner, provisionProject } from "./project-provisioner.js";

function errorCategory(error, fallback) {
  return typeof error?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(error.code)
    ? error.code
    : fallback;
}

export class ForgeService {
  constructor({ registry, releases, audit, gitProvider, buildExecutor, runtimeExecutor, deploymentAdapter = null, projectProvisioner = new PendingProjectProvisioner(), stateStore = null, buildQueue = new SingleBuildQueue() }) {
    this.registry = registry;
    this.releases = releases;
    this.audit = audit;
    this.gitProvider = gitProvider;
    this.buildExecutor = buildExecutor;
    this.runtimeExecutor = runtimeExecutor;
    this.deploymentAdapter = deploymentAdapter;
    this.projectProvisioner = projectProvisioner;
    this.stateStore = stateStore;
    this.buildQueue = buildQueue;
  }

  async persist() {
    if (!this.stateStore) return;
    await this.stateStore.save({
      version: 2,
      pausedProjects: this.registry.exportPauseState(),
      registeredProjects: this.registry.exportRegisteredProjects(),
      releases: this.releases.exportState(),
      audit: this.audit.exportState(),
      gitProviderState: this.gitProvider.exportState?.() ?? null
    });
  }

  async getProjectStatus(projectId) {
    const project = this.registry.get(projectId);
    await this.refreshCheckingRelease(project);
    const runtime = project.coolifyApplicationUuid === null
      ? { state: "unprovisioned", activeCommitSha: null }
      : typeof this.runtimeExecutor.getRuntimeStatus === "function"
      ? await this.runtimeExecutor.getRuntimeStatus(project)
      : null;
    return {
      projectId: project.projectId,
      deployPaused: this.registry.isPaused(projectId),
      activeRelease: this.releases.getActive(projectId),
      pendingRelease: this.releases.getChecking(projectId),
      runtime,
      poll: this.gitProvider.getPollStatus?.(projectId) ?? { state: "unavailable", checkedAt: null, commitSha: null, errorCategory: null, etag: null }
    };
  }

  async listDeployHistory(projectId) {
    const project = this.registry.get(projectId);
    await this.refreshCheckingRelease(project);
    return this.releases.listByProject(projectId);
  }

  listProjects() {
    return this.registry.list().map((project) => ({
      projectId: project.projectId,
      repository: project.repository,
      allowedBranch: project.allowedBranch,
      buildProfile: project.buildProfile,
      runtimeProfile: project.runtimeProfile,
      deployPolicy: project.deployPolicy,
      healthCheck: project.healthCheck,
      pollIntervalSeconds: project.pollIntervalSeconds,
      provisioningState: project.coolifyApplicationUuid === null ? "pending" : "ready"
    }));
  }

  async registerProject(sourceProject, actorType = "lyra") {
    const provisioned = await provisionProject(this.projectProvisioner, sourceProject);
    const project = this.registry.register({ ...sourceProject, coolifyApplicationUuid: provisioned.coolifyApplicationUuid });
    this.audit.append({ action: "register", projectId: project.projectId, actorType, outcome: "accepted" });
    await this.persist();
    return this.listProjects().find((candidate) => candidate.projectId === project.projectId);
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
    if (this.deploymentAdapter && project.coolifyApplicationUuid === null) {
      this.audit.append({ action: "deploy", projectId, actorType, outcome: "rejected", commitSha: normalizedSha, errorCategory: "PROJECT_NOT_PROVISIONED" });
      await this.persist();
      throw conflict("PROJECT_NOT_PROVISIONED");
    }
    if (this.registry.isPaused(projectId)) {
      this.audit.append({ action: "deploy", projectId, actorType, outcome: "rejected", commitSha: normalizedSha, errorCategory: "DEPLOY_PAUSED" });
      await this.persist();
      throw conflict("DEPLOY_PAUSED");
    }

    await this.refreshCheckingRelease(project);
    if (this.releases.getChecking(projectId)) {
      this.audit.append({ action: "deploy", projectId, actorType, outcome: "rejected", commitSha: normalizedSha, errorCategory: "DEPLOYMENT_IN_PROGRESS" });
      await this.persist();
      throw conflict("DEPLOYMENT_IN_PROGRESS");
    }

    try {
      await this.gitProvider.assertAllowedCommit(project, normalizedSha);
    } catch (error) {
      this.audit.append({ action: "deploy", projectId, actorType, outcome: "rejected", commitSha: normalizedSha, errorCategory: errorCategory(error, "GIT_VALIDATION_FAILED") });
      await this.persist();
      throw error;
    }

    if (this.deploymentAdapter) {
      return this.startCoolifyDeploy(project, normalizedSha, actorType, "deploy");
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
      if (this.deploymentAdapter) {
        await this.deploymentAdapter.restart(project);
      } else {
        await this.runtimeExecutor.restart({ project, release: activeRelease });
      }
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
    if (this.deploymentAdapter) {
      return this.startCoolifyDeploy(project, target.commitSha, actorType, "rollback");
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
      return { outcome: "succeeded", release: this.releases.getSummary(target.releaseId) };
    } catch (error) {
      this.audit.append({ action: "rollback", projectId, actorType, outcome: "failed", releaseId: target.releaseId, errorCategory: errorCategory(error, "ROLLBACK_FAILED") });
      await this.persist();
      throw error;
    }
  }

  async startCoolifyDeploy(project, commitSha, actorType, operation) {
    let started;
    try {
      started = operation === "rollback"
        ? await this.deploymentAdapter.rollback(project, commitSha)
        : await this.deploymentAdapter.startDeploy(project, commitSha);
      if (!started || typeof started.deploymentId !== "string" || started.commitSha !== commitSha) {
        throw conflict("COOLIFY_PROTOCOL_VIOLATION");
      }
    } catch (error) {
      this.audit.append({ action: operation, projectId: project.projectId, actorType, outcome: "failed", commitSha, errorCategory: errorCategory(error, "COOLIFY_DEPLOY_FAILED") });
      await this.persist();
      return { outcome: "failed", release: null };
    }

    const release = this.releases.create({
      projectId: project.projectId,
      commitSha,
      artifactId: `coolify-deployment:${started.deploymentId}`,
      operation
    });
    this.releases.record(release.releaseId, "checking");
    this.audit.append({ action: operation, projectId: project.projectId, actorType, outcome: "accepted", commitSha, releaseId: release.releaseId });
    await this.persist();
    await this.refreshCheckingRelease(project);
    const summary = this.releases.getSummary(release.releaseId);
    return { outcome: summary.state === "active" ? "succeeded" : summary.state === "failed" ? "failed" : "accepted", release: summary };
  }

  async refreshCheckingRelease(project) {
    if (!this.deploymentAdapter) return;
    const release = this.releases.getChecking(project.projectId);
    if (!release) return;
    const deploymentId = release.artifactId.startsWith("coolify-deployment:")
      ? release.artifactId.slice("coolify-deployment:".length)
      : null;
    if (!deploymentId) throw conflict("COOLIFY_PROTOCOL_VIOLATION");

    const status = await this.deploymentAdapter.getDeploymentStatus(deploymentId, release.commitSha);
    if (status.state === "pending") return;
    if (status.state === "failed") {
      this.releases.record(release.releaseId, "failed", "COOLIFY_DEPLOYMENT_FAILED");
      this.audit.append({ action: release.operation, projectId: project.projectId, actorType: "system", outcome: "failed", commitSha: release.commitSha, releaseId: release.releaseId, errorCategory: "COOLIFY_DEPLOYMENT_FAILED" });
      await this.persist();
      return;
    }
    if (status.state !== "succeeded") throw conflict("COOLIFY_PROTOCOL_VIOLATION");

    const priorActive = this.releases.getActive(project.projectId);
    if (priorActive) {
      this.releases.record(priorActive.releaseId, "previous");
    }
    this.releases.record(release.releaseId, "ready");
    this.releases.record(release.releaseId, "active");
    this.releases.setActive(project.projectId, release.releaseId);
    this.audit.append({ action: release.operation, projectId: project.projectId, actorType: "system", outcome: "succeeded", commitSha: release.commitSha, releaseId: release.releaseId });
    await this.persist();
  }
}
