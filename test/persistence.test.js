import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FixtureBuildExecutor, FixtureGitProvider, FixtureRuntimeExecutor } from "../src/adapters.js";
import { ForgeService } from "../src/forge-service.js";
import { JsonStateStore } from "../src/persistence.js";
import { ContentFreeAuditLog, ProjectRegistry, ReleaseStore } from "../src/stores.js";
import { SHA_A, exampleProject, makeForge } from "./helpers.js";

test("persistent local state restores the active release, pause state, and content-free audit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lyra-forge-test-"));
  const statePath = join(directory, "state.json");
  const stateStore = new JsonStateStore(statePath);
  try {
    const { forge } = makeForge({ stateStore });
    await forge.requestDeploy("adesco", SHA_A);
    await forge.setDeployPaused("adesco", true);

    const saved = await stateStore.load();
    assert.equal(saved.version, 2);
    assert.equal((await stat(statePath)).mode & 0o777, 0o600);

    const restoredForge = new ForgeService({
      registry: new ProjectRegistry([exampleProject()], {
        pausedState: saved.pausedProjects,
        registeredProjects: saved.registeredProjects
      }),
      releases: new ReleaseStore({ state: saved.releases }),
      audit: new ContentFreeAuditLog({ state: saved.audit }),
      gitProvider: new FixtureGitProvider({ adesco: [SHA_A] }),
      buildExecutor: new FixtureBuildExecutor(),
      runtimeExecutor: new FixtureRuntimeExecutor(),
      stateStore
    });
    const status = await restoredForge.getProjectStatus("adesco");
    assert.equal(status.deployPaused, true);
    assert.equal(status.activeRelease.commitSha, SHA_A);
    assert.equal((await restoredForge.listDeployHistory("adesco")).length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("persisted registry entries restore without turning them into static configuration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lyra-forge-test-"));
  const statePath = join(directory, "state.json");
  const stateStore = new JsonStateStore(statePath);
  try {
    const { forge } = makeForge({ stateStore });
    await forge.registerProject({
      projectId: "pilot-app",
      repository: "https://github.com/example/pilot-app.git",
      allowedBranch: "main",
      buildProfile: "nextjs-npm",
      runtimeProfile: "private-http",
      deployPolicy: "manual",
      healthCheck: { path: "/healthz", timeoutMs: 3000 },
      pollIntervalSeconds: 300
    });

    const saved = await stateStore.load();
    assert.deepEqual(saved.registeredProjects.map((project) => project.projectId), ["pilot-app"]);
    const restoredRegistry = new ProjectRegistry([exampleProject()], {
      pausedState: saved.pausedProjects,
      registeredProjects: saved.registeredProjects
    });
    assert.deepEqual(restoredRegistry.list().map((project) => project.projectId), ["adesco", "pilot-app"]);
    assert.deepEqual(restoredRegistry.exportRegisteredProjects().map((project) => project.projectId), ["pilot-app"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
