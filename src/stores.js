import { badRequest, conflict, notFound } from "./errors.js";
import { validateProject } from "./validation.js";

export class ProjectRegistry {
  constructor(projects, { pausedState = {}, registeredProjects = [] } = {}) {
    if (!Array.isArray(projects)) {
      throw badRequest("INVALID_PROJECT_REGISTRY");
    }
    if (!Array.isArray(registeredProjects)) {
      throw badRequest("INVALID_PROJECT_REGISTRY");
    }
    this.projects = new Map();
    this.paused = new Map();
    this.registeredProjectIds = new Set();
    for (const sourceProject of projects) {
      this.add(sourceProject, { pausedState, registered: false, duplicateCode: "DUPLICATE_PROJECT_ID" });
    }
    for (const sourceProject of registeredProjects) {
      this.add(sourceProject, { pausedState, registered: true, duplicateCode: "DUPLICATE_PROJECT_ID" });
    }
  }

  add(sourceProject, { pausedState, registered, duplicateCode }) {
    const project = validateProject(sourceProject);
    if (this.projects.has(project.projectId)) {
      throw badRequest(duplicateCode);
    }
    this.projects.set(project.projectId, project);
    this.paused.set(project.projectId, pausedState[project.projectId] === true);
    if (registered) this.registeredProjectIds.add(project.projectId);
    return project;
  }

  register(sourceProject) {
    const project = validateProject(sourceProject);
    if (this.projects.has(project.projectId)) {
      throw conflict("PROJECT_ALREADY_REGISTERED");
    }
    return this.add(project, { pausedState: {}, registered: true, duplicateCode: "PROJECT_ALREADY_REGISTERED" });
  }

  get(projectId) {
    const project = this.projects.get(projectId);
    if (!project) {
      throw notFound();
    }
    return project;
  }

  isPaused(projectId) {
    this.get(projectId);
    return this.paused.get(projectId);
  }

  setPaused(projectId, paused) {
    this.get(projectId);
    this.paused.set(projectId, paused);
  }

  exportPauseState() {
    return Object.fromEntries(this.paused);
  }

  exportRegisteredProjects() {
    return [...this.registeredProjectIds].map((projectId) => ({ ...this.get(projectId), healthCheck: { ...this.get(projectId).healthCheck } }));
  }

  list() {
    return [...this.projects.values()].map((project) => ({ ...project, healthCheck: { ...project.healthCheck } }));
  }
}

export class ReleaseStore {
  constructor({ now = () => new Date().toISOString(), state = null } = {}) {
    this.now = now;
    this.nextId = state?.nextId ?? 1;
    this.records = new Map();
    this.events = new Map();
    this.activeReleaseIds = new Map();
    if (state) this.restore(state);
  }

  create({ projectId, commitSha, artifactId, operation = "deploy" }) {
    if (operation !== "deploy" && operation !== "rollback") {
      throw badRequest("INVALID_RELEASE_OPERATION");
    }
    const release = Object.freeze({
      releaseId: `release-${this.nextId++}`,
      projectId,
      commitSha,
      artifactId,
      operation,
      createdAt: this.now()
    });
    this.records.set(release.releaseId, release);
    this.events.set(release.releaseId, []);
    this.record(release.releaseId, "queued");
    return release;
  }

  record(releaseId, state, category = null) {
    this.getRecord(releaseId);
    this.events.get(releaseId).push(Object.freeze({ state, category, at: this.now() }));
  }

  getRecord(releaseId) {
    const release = this.records.get(releaseId);
    if (!release) {
      throw notFound("RELEASE_NOT_FOUND");
    }
    return release;
  }

  getSummary(releaseId) {
    const release = this.getRecord(releaseId);
    const events = this.events.get(releaseId);
    const current = events.at(-1);
    return Object.freeze({
      ...release,
      state: current.state,
      category: current.category,
      events: events.map((event) => ({ ...event }))
    });
  }

  listByProject(projectId) {
    return [...this.records.values()]
      .filter((release) => release.projectId === projectId)
      .map((release) => this.getSummary(release.releaseId));
  }

  getActive(projectId) {
    const releaseId = this.activeReleaseIds.get(projectId);
    return releaseId ? this.getSummary(releaseId) : null;
  }

  getChecking(projectId) {
    return this.listByProject(projectId).find((release) => release.state === "checking") ?? null;
  }

  setActive(projectId, releaseId) {
    this.getRecord(releaseId);
    this.activeReleaseIds.set(projectId, releaseId);
  }

  exportState() {
    return {
      nextId: this.nextId,
      records: [...this.records.values()].map((record) => ({ ...record })),
      events: [...this.events.entries()].map(([releaseId, events]) => [releaseId, events.map((event) => ({ ...event }))]),
      activeReleaseIds: [...this.activeReleaseIds.entries()]
    };
  }

  restore(state) {
    if (!Number.isInteger(state.nextId) || state.nextId < 1 || !Array.isArray(state.records) || !Array.isArray(state.events) || !Array.isArray(state.activeReleaseIds)) {
      throw badRequest("INVALID_PERSISTED_STATE");
    }
    for (const record of state.records) {
      if (!record || typeof record.releaseId !== "string" || typeof record.projectId !== "string" || typeof record.commitSha !== "string" || typeof record.artifactId !== "string" || typeof record.createdAt !== "string" || (record.operation !== undefined && record.operation !== "deploy" && record.operation !== "rollback")) {
        throw badRequest("INVALID_PERSISTED_STATE");
      }
      this.records.set(record.releaseId, Object.freeze({ ...record, operation: record.operation ?? "deploy" }));
    }
    for (const [releaseId, events] of state.events) {
      if (!this.records.has(releaseId) || !Array.isArray(events) || events.length === 0) {
        throw badRequest("INVALID_PERSISTED_STATE");
      }
      this.events.set(releaseId, events.map((event) => Object.freeze({ ...event })));
    }
    if (this.events.size !== this.records.size) throw badRequest("INVALID_PERSISTED_STATE");
    for (const [projectId, releaseId] of state.activeReleaseIds) {
      if (typeof projectId !== "string" || !this.records.has(releaseId)) throw badRequest("INVALID_PERSISTED_STATE");
      this.activeReleaseIds.set(projectId, releaseId);
    }
  }
}

const AUDIT_ACTIONS = new Set(["register", "deploy", "restart", "pause", "rollback", "poll"]);
const AUDIT_OUTCOMES = new Set(["accepted", "succeeded", "failed", "rejected"]);
const ACTOR_TYPES = new Set(["lyra", "system"]);
const ERROR_CATEGORY_PATTERN = /^[A-Z0-9_]{1,64}$/;

export class ContentFreeAuditLog {
  constructor({ now = () => new Date().toISOString(), state = null } = {}) {
    this.now = now;
    this.entries = state ? this.restore(state) : [];
  }

  append({ action, projectId, actorType, outcome, commitSha = null, releaseId = null, errorCategory = null }) {
    return this.appendTo(this.entries, { action, projectId, actorType, outcome, commitSha, releaseId, errorCategory });
  }

  listByProject(projectId) {
    return this.entries.filter((entry) => entry.projectId === projectId).map((entry) => ({ ...entry }));
  }

  exportState() {
    return this.entries.map((entry) => ({ ...entry }));
  }

  restore(state) {
    if (!Array.isArray(state)) throw badRequest("INVALID_PERSISTED_STATE");
    return state.map((entry) => {
      if (!entry || typeof entry !== "object") throw badRequest("INVALID_PERSISTED_STATE");
      const restored = this.appendTo([], entry);
      return restored;
    });
  }

  appendTo(entries, { action, projectId, actorType, outcome, commitSha = null, releaseId = null, errorCategory = null, at = this.now() }) {
    if (!AUDIT_ACTIONS.has(action) || !AUDIT_OUTCOMES.has(outcome) || !ACTOR_TYPES.has(actorType) || typeof projectId !== "string" || typeof at !== "string") {
      throw badRequest("INVALID_AUDIT_EVENT");
    }
    const normalizedErrorCategory = typeof errorCategory === "string" && ERROR_CATEGORY_PATTERN.test(errorCategory)
      ? errorCategory
      : null;
    const entry = Object.freeze({ at, action, projectId, actorType, outcome, commitSha, releaseId, errorCategory: normalizedErrorCategory });
    entries.push(entry);
    return entry;
  }
}
