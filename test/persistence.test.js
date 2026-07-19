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
    assert.equal(saved.version, 1);
    assert.equal((await stat(statePath)).mode & 0o777, 0o600);

    const restoredForge = new ForgeService({
      registry: new ProjectRegistry([exampleProject()], { pausedState: saved.pausedProjects }),
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
    assert.equal(restoredForge.listDeployHistory("adesco").length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
