import { conflict, notFound } from "./errors.js";
import { assertBoolean, assertCommitSha, validateProject } from "./validation.js";
import { SingleBuildQueue } from "./build-queue.js";
import { PendingProjectProvisioner, provisionProject } from "./project-provisioner.js";
import { RejectingBuildVerificationExecutor } from "./adapters.js";

function errorCategory(error, fallback) {
  return typeof error?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(error.code)
    ? error.code
    : fallback;
}

function immutableArtifact(value) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/i.test(value)) throw conflict("INVALID_BUILD_ARTIFACT");
  return value.toLowerCase();
}

export class ForgeService {
  constructor({ registry, releases, audit, gitProvider, buildExecutor, runtimeExecutor, buildVerificationExecutor = new RejectingBuildVerificationExecutor(), deploymentAdapter = null, projectProvisioner = new PendingProjectProvisioner(), stateStore = null, buildQueue = new SingleBuildQueue(), overviewComponents = { buildExecutor: "disabled", runtimeExecutor: "disabled" } }) {
    this.registry = registry;
    this.releases = releases;
    this.audit = audit;
    this.gitProvider = gitProvider;
    this.buildExecutor = buildExecutor;
    this.buildVerificationExecutor = buildVerificationExecutor;
    this.runtimeExecutor = runtimeExecutor;
    this.deploymentAdapter = deploymentAdapter;
    this.projectProvisioner = projectProvisioner;
    this.stateStore = stateStore;
    this.buildQueue = buildQueue;
    this.overviewComponents = Object.freeze({
      buildExecutor: overviewComponents.buildExecutor === "configured" ? "configured" : "disabled",
      runtimeExecutor: overviewComponents.runtimeExecutor === "configured" ? "configured" : "disabled"
    });
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
    const runtime = project.runtimeBinding === null
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
      provisioningState: project.runtimeBinding === null ? "pending" : "ready"
    }));
  }

  readOverview() {
    const projects = this.registry.list()
      .map((project) => {
        const active = this.releases.getActive(project.projectId);
        const candidate = this.releases.getLatestCandidate(project.projectId);
        return Object.freeze({
          id: project.projectId,
          provisioning: project.runtimeBinding === null ? "pending" : "ready",
          deployPaused: this.registry.isPaused(project.projectId),
          releases: Object.freeze({
            active: active === null ? "none" : "active",
            candidate: candidate === null || !["queued", "checking", "ready", "failed"].includes(candidate.state)
              ? "none"
              : candidate.state
          })
        });
      })
      .sort((left, right) => left.id.localeCompare(right.id));
    const items = projects.slice(0, 64);
    return Object.freeze({
      system: Object.freeze([
        Object.freeze({ id: "control-plane", state: "available" }),
        Object.freeze({ id: "build-executor", state: this.overviewComponents.buildExecutor }),
        Object.freeze({ id: "runtime-executor", state: this.overviewComponents.runtimeExecutor })
      ]),
      applications: Object.freeze({
        total: projects.length,
        truncated: projects.length > items.length,
        items: Object.freeze(items)
      })
    });
  }

  async registerProject(sourceProject, actorType = "lyra") {
    const candidate = validateProject(sourceProject);
    const provisioned = await provisionProject(this.projectProvisioner, candidate);
    const project = this.registry.register({ ...candidate, runtimeBinding: provisioned.runtimeBinding });
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

  requestBuildVerification(projectId, commitSha, actorType = "lyra") {
    return this.buildQueue.run(() => this.performBuildVerification(projectId, commitSha, actorType));
  }

  async getBuildVerificationStatus(projectId, operationId) {
    this.registry.get(projectId);
    if (typeof this.buildVerificationExecutor.getBuildStatus !== "function") throw conflict("BUILD_EXECUTOR_UNAVAILABLE");
    return this.buildVerificationExecutor.getBuildStatus({ operationId });
  }

  async performBuildVerification(projectId, commitSha, actorType) {
    const project = this.registry.get(projectId);
    const normalizedSha = assertCommitSha(commitSha);
    if (this.registry.isPaused(projectId)) {
      this.audit.append({ action: "build", projectId, actorType, outcome: "rejected", commitSha: normalizedSha, errorCategory: "DEPLOY_PAUSED" });
      await this.persist();
      throw conflict("DEPLOY_PAUSED");
    }
    try {
      const result = await this.buildVerificationExecutor.startBuild({ project, commitSha: normalizedSha });
      if (!result || typeof result !== "object" || Object.keys(result).length !== 3 || typeof result.operationId !== "string" || result.operationId.length === 0 || result.commitSha !== normalizedSha || result.state !== "accepted") {
        throw conflict("BUILD_EXECUTOR_PROTOCOL_VIOLATION");
      }
      const accepted = Object.freeze({ operationId: result.operationId, commitSha: normalizedSha, state: "accepted" });
      this.audit.append({ action: "build", projectId, actorType, outcome: "accepted", commitSha: normalizedSha });
      await this.persist();
      return accepted;
    } catch (error) {
      this.audit.append({ action: "build", projectId, actorType, outcome: "rejected", commitSha: normalizedSha, errorCategory: errorCategory(error, "BUILD_EXECUTOR_UNAVAILABLE") });
      await this.persist();
      throw error;
    }
  }

  async performDeploy(projectId, commitSha, actorType) {
    const project = this.registry.get(projectId);
    const normalizedSha = assertCommitSha(commitSha);
    // A pending registration is useful for review, but must never reach the
    // builder. This remains true even before a runtime adapter is wired.
    if (project.runtimeBinding === null) {
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

    // A managed artifact executor verifies the exact SHA during its fixed
    // checkout Job. It cannot accept a repository or branch from this call.
    const managedArtifactBuild = this.deploymentAdapter?.producesArtifact === true;
    if (!managedArtifactBuild) {
      try {
        await this.gitProvider.assertAllowedCommit(project, normalizedSha);
      } catch (error) {
        this.audit.append({ action: "deploy", projectId, actorType, outcome: "rejected", commitSha: normalizedSha, errorCategory: errorCategory(error, "GIT_VALIDATION_FAILED") });
        await this.persist();
        throw error;
      }
    }

    if (managedArtifactBuild) {
      const release = this.releases.create({ projectId, commitSha: normalizedSha, artifactId: null });
      return this.startManagedDeploy(project, release, actorType, "deploy");
    }

    let build;
    try {
      build = await this.buildExecutor.build({ project, commitSha: normalizedSha });
      build = { artifactId: immutableArtifact(build?.artifactId) };
    } catch (error) {
      this.audit.append({ action: "deploy", projectId, actorType, outcome: "failed", commitSha: normalizedSha, errorCategory: errorCategory(error, "BUILD_FAILED") });
      await this.persist();
      return { outcome: "failed", release: null };
    }

    const release = this.releases.create({ projectId, commitSha: normalizedSha, artifactId: build.artifactId });
    if (this.deploymentAdapter) return this.startManagedDeploy(project, release, actorType, "deploy");
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
      const release = this.releases.create({ projectId, commitSha: target.commitSha, artifactId: target.artifactId, operation: "rollback" });
      return this.startManagedDeploy(project, release, actorType, "rollback");
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

  async startManagedDeploy(project, release, actorType, operation) {
    let started;
    try {
      started = operation === "rollback"
        ? await this.deploymentAdapter.rollback(project, release)
        : await this.deploymentAdapter.startDeploy(project, release);
      if (!started || typeof started.deploymentId !== "string" || started.commitSha !== release.commitSha) {
        throw conflict("DEPLOYMENT_PROTOCOL_VIOLATION");
      }
    } catch (error) {
      this.audit.append({ action: operation, projectId: project.projectId, actorType, outcome: "failed", commitSha: release.commitSha, errorCategory: errorCategory(error, "DEPLOYMENT_START_FAILED") });
      await this.persist();
      return { outcome: "failed", release: null };
    }

    this.releases.setDeploymentId(release.releaseId, started.deploymentId);
    this.releases.record(release.releaseId, "checking");
    this.audit.append({ action: operation, projectId: project.projectId, actorType, outcome: "accepted", commitSha: release.commitSha, releaseId: release.releaseId });
    await this.persist();
    await this.refreshCheckingRelease(project);
    const summary = this.releases.getSummary(release.releaseId);
    return { outcome: summary.state === "active" ? "succeeded" : summary.state === "failed" ? "failed" : "accepted", release: summary };
  }

  async refreshCheckingRelease(project) {
    if (!this.deploymentAdapter) return;
    const release = this.releases.getChecking(project.projectId);
    if (!release) return;
    const deploymentId = release.deploymentId;
    if (!deploymentId) throw conflict("DEPLOYMENT_PROTOCOL_VIOLATION");

    const status = await this.deploymentAdapter.getDeploymentStatus({ project, release, deploymentId });
    if (status?.artifactId !== undefined && status.artifactId !== null && release.artifactId === null) {
      this.releases.setArtifactId(release.releaseId, immutableArtifact(status.artifactId));
    }
    if (status.state === "pending") return;
    if (status.state === "failed") {
      this.releases.record(release.releaseId, "failed", "DEPLOYMENT_FAILED");
      this.audit.append({ action: release.operation, projectId: project.projectId, actorType: "system", outcome: "failed", commitSha: release.commitSha, releaseId: release.releaseId, errorCategory: "DEPLOYMENT_FAILED" });
      await this.persist();
      return;
    }
    if (status.state !== "succeeded" || (this.deploymentAdapter.producesArtifact === true && this.releases.getSummary(release.releaseId).artifactId === null)) throw conflict("DEPLOYMENT_PROTOCOL_VIOLATION");

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
