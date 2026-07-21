import { readFile } from "node:fs/promises";
import { ContentFreeAuditLog, ProjectRegistry, ReleaseStore } from "./stores.js";
import { RejectingBuildExecutor, RejectingBuildVerificationExecutor, RejectingGitProvider, RejectingRuntimeExecutor } from "./adapters.js";
import { ForgeService } from "./forge-service.js";
import { createForgeHttpServer } from "./http-server.js";
import { JsonStateStore } from "./persistence.js";
import { loadRuntimeConfig } from "./runtime-config.js";
import { UnixBuildExecutorClient } from "./unix-build-executor-client.js";
import { UnixRuntimeExecutorClient } from "./unix-runtime-executor-client.js";
import { NoccoRuntimeAdapter } from "./nocco-runtime-adapter.js";
import { OwnerRuntimeProvisioner } from "./owner-runtime-provisioner.js";
import { loadNoccoRuntimeProjects } from "./nocco-runtime-template.js";

const registryPath = process.argv[2] ?? "config/projects.example.json";
const runtime = loadRuntimeConfig();

const registrySource = JSON.parse(await readFile(registryPath, "utf8"));
const stateStore = new JsonStateStore(runtime.statePath);
const persistedState = await stateStore.load();
const runtimeProvisioner = runtime.runtimeProjectsPath
  ? new OwnerRuntimeProvisioner(loadNoccoRuntimeProjects(JSON.parse(await readFile(runtime.runtimeProjectsPath, "utf8"))))
  : new PendingProjectProvisioner();
const registry = new ProjectRegistry(registrySource.projects, {
  pausedState: persistedState?.pausedProjects,
  registeredProjects: persistedState?.registeredProjects
});
for (const project of registry.list()) {
  const provisioned = await runtimeProvisioner.provision(project);
  if (project.runtimeBinding === null && provisioned.runtimeBinding !== null) registry.setRuntimeBinding(project.projectId, provisioned.runtimeBinding);
}
const runtimeAdapter = runtime.runtimeExecutorSocket
  ? new NoccoRuntimeAdapter({ client: new UnixRuntimeExecutorClient({ socketPath: runtime.runtimeExecutorSocket }) })
  : null;
const forge = new ForgeService({
  registry,
  releases: new ReleaseStore({ state: persistedState?.releases }),
  audit: new ContentFreeAuditLog({ state: persistedState?.audit }),
  gitProvider: new RejectingGitProvider(),
  buildExecutor: new RejectingBuildExecutor(),
  buildVerificationExecutor: runtime.buildExecutorSocket
    ? new UnixBuildExecutorClient({ socketPath: runtime.buildExecutorSocket })
    : new RejectingBuildVerificationExecutor(),
  runtimeExecutor: runtimeAdapter ?? new RejectingRuntimeExecutor(),
  deploymentAdapter: runtimeAdapter,
  projectProvisioner: runtimeProvisioner,
  stateStore
});

const server = createForgeHttpServer({ forge, apiToken: runtime.apiToken, lyraReadToken: runtime.lyraReadToken });
server.listen(runtime.port, runtime.bindHost, () => {
  const address = server.address();
  process.stdout.write(`Forge listening on ${address.address}:${address.port}\n`);
});
