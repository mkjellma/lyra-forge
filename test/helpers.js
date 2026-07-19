import { FixtureBuildExecutor, FixtureGitProvider, FixtureRuntimeExecutor } from "../src/adapters.js";
import { ForgeService } from "../src/forge-service.js";
import { ContentFreeAuditLog, ProjectRegistry, ReleaseStore } from "../src/stores.js";

export const SHA_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const SHA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

export function exampleProject(overrides = {}) {
  return {
    projectId: "adesco",
    repository: "https://github.com/example/adesco.git",
    allowedBranch: "main",
    buildProfile: "containerfile",
    runtimeProfile: "private-http",
    deployPolicy: "manual",
    healthCheck: { path: "/health", timeoutMs: 1000 },
    pollIntervalSeconds: 300,
    coolifyApplicationUuid: "adesco-app-1234",
    ...overrides
  };
}

export function makeForge({ build, health, activate, restart, stateStore = null, gitProvider = null, buildExecutor = null, runtimeExecutor = null, deploymentAdapter = null } = {}) {
  const now = (() => {
    let counter = 0;
    return () => `2026-07-19T00:00:0${counter++}.000Z`;
  })();
  const registry = new ProjectRegistry([exampleProject()]);
  const releases = new ReleaseStore({ now });
  const audit = new ContentFreeAuditLog({ now });
  const forge = new ForgeService({
    registry,
    releases,
    audit,
    gitProvider: gitProvider ?? new FixtureGitProvider({ adesco: [SHA_A, SHA_B] }),
    buildExecutor: buildExecutor ?? new FixtureBuildExecutor({ build, health }),
    runtimeExecutor: runtimeExecutor ?? new FixtureRuntimeExecutor({ activate, restart }),
    deploymentAdapter,
    stateStore
  });
  return { forge, registry, releases, audit };
}
