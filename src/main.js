import { readFile } from "node:fs/promises";
import { ContentFreeAuditLog, ProjectRegistry, ReleaseStore } from "./stores.js";
import { RejectingBuildExecutor, RejectingGitProvider, RejectingRuntimeExecutor } from "./adapters.js";
import { ForgeService } from "./forge-service.js";
import { createForgeHttpServer } from "./http-server.js";
import { JsonStateStore } from "./persistence.js";

const registryPath = process.argv[2] ?? "config/projects.example.json";
const statePath = process.env.FORGE_STATE_PATH ?? "data/forge-state.json";
const apiToken = process.env.FORGE_API_TOKEN;
if (!apiToken) {
  throw new Error("FORGE_API_TOKEN_REQUIRED");
}

const registrySource = JSON.parse(await readFile(registryPath, "utf8"));
const stateStore = new JsonStateStore(statePath);
const persistedState = await stateStore.load();
const forge = new ForgeService({
  registry: new ProjectRegistry(registrySource.projects, { pausedState: persistedState?.pausedProjects }),
  releases: new ReleaseStore({ state: persistedState?.releases }),
  audit: new ContentFreeAuditLog({ state: persistedState?.audit }),
  gitProvider: new RejectingGitProvider(),
  buildExecutor: new RejectingBuildExecutor(),
  runtimeExecutor: new RejectingRuntimeExecutor(),
  stateStore
});

const server = createForgeHttpServer({ forge, apiToken });
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  process.stdout.write(`Forge local skeleton listening on 127.0.0.1:${address.port}\n`);
});
