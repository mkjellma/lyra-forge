import { readFile } from "node:fs/promises";
import { ContentFreeAuditLog, ProjectRegistry, ReleaseStore } from "./stores.js";
import { RejectingBuildExecutor, RejectingGitProvider, RejectingRuntimeExecutor } from "./adapters.js";
import { ForgeService } from "./forge-service.js";
import { createForgeHttpServer } from "./http-server.js";
import { JsonStateStore } from "./persistence.js";
import { loadRuntimeConfig } from "./runtime-config.js";

const registryPath = process.argv[2] ?? "config/projects.example.json";
const runtime = loadRuntimeConfig();

const registrySource = JSON.parse(await readFile(registryPath, "utf8"));
const stateStore = new JsonStateStore(runtime.statePath);
const persistedState = await stateStore.load();
const forge = new ForgeService({
  registry: new ProjectRegistry(registrySource.projects, {
    pausedState: persistedState?.pausedProjects,
    registeredProjects: persistedState?.registeredProjects
  }),
  releases: new ReleaseStore({ state: persistedState?.releases }),
  audit: new ContentFreeAuditLog({ state: persistedState?.audit }),
  gitProvider: new RejectingGitProvider(),
  buildExecutor: new RejectingBuildExecutor(),
  runtimeExecutor: new RejectingRuntimeExecutor(),
  stateStore
});

const server = createForgeHttpServer({ forge, apiToken: runtime.apiToken });
server.listen(runtime.port, runtime.bindHost, () => {
  const address = server.address();
  process.stdout.write(`Forge listening on ${address.address}:${address.port}\n`);
});
