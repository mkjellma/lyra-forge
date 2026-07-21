import { readFile, unlink } from "node:fs/promises";
import { KubernetesJobClient } from "./kubernetes-job-client.js";
import { KubernetesRuntimeClient } from "./kubernetes-runtime-client.js";
import { OciRegistryClient } from "./oci-registry-client.js";
import { loadNoccoBuildProjects } from "./nocco-build-template.js";
import { loadNoccoRuntimeProjects } from "./nocco-runtime-template.js";
import { NoccoRuntimeExecutor } from "./nocco-runtime-executor.js";
import { createRuntimeExecutorHttpServer } from "./runtime-executor-http.js";

function required(value, code) {
  if (typeof value !== "string" || value.length === 0) throw new Error(code);
  return value;
}

const host = process.env.KUBERNETES_SERVICE_HOST ?? "kubernetes.default.svc";
const port = process.env.KUBERNETES_SERVICE_PORT_HTTPS ?? "443";
const token = (await readFile("/var/run/secrets/kubernetes.io/serviceaccount/token", "utf8")).trim();
const buildPolicies = loadNoccoBuildProjects(JSON.parse(await readFile(required(process.env.FORGE_BUILD_PROJECTS_PATH, "FORGE_BUILD_PROJECTS_PATH_REQUIRED"), "utf8")));
const runtimePolicies = loadNoccoRuntimeProjects(JSON.parse(await readFile(required(process.env.FORGE_RUNTIME_PROJECTS_PATH, "FORGE_RUNTIME_PROJECTS_PATH_REQUIRED"), "utf8")));
const apiOrigin = `https://${host}:${port}`;
const executor = new NoccoRuntimeExecutor({
  jobClient: new KubernetesJobClient({ fetchFn: fetch, apiOrigin, token }),
  runtimeClient: new KubernetesRuntimeClient({ fetchFn: fetch, apiOrigin, token }),
  registryClient: new OciRegistryClient({ fetchFn: fetch, origin: required(process.env.FORGE_ARTIFACT_REGISTRY_ORIGIN, "FORGE_ARTIFACT_REGISTRY_ORIGIN_REQUIRED") }),
  buildPolicies, runtimePolicies,
  checkoutImage: required(process.env.FORGE_CHECKOUT_IMAGE, "FORGE_CHECKOUT_IMAGE_REQUIRED"),
  builderImage: required(process.env.FORGE_BUILDER_IMAGE, "FORGE_BUILDER_IMAGE_REQUIRED"),
  publisherImage: required(process.env.FORGE_PUBLISHER_IMAGE, "FORGE_PUBLISHER_IMAGE_REQUIRED"),
  nodeImage: required(process.env.FORGE_RUNTIME_NODE_IMAGE, "FORGE_RUNTIME_NODE_IMAGE_REQUIRED"),
  orasImage: required(process.env.FORGE_ORAS_IMAGE, "FORGE_ORAS_IMAGE_REQUIRED"),
  registryOrigin: required(process.env.FORGE_ARTIFACT_REGISTRY_ORIGIN, "FORGE_ARTIFACT_REGISTRY_ORIGIN_REQUIRED")
});
const socketPath = process.env.FORGE_RUNTIME_EXECUTOR_SOCKET ?? "/var/run/forge-executor/runtime.sock";
await unlink(socketPath).catch((error) => { if (error.code !== "ENOENT") throw error; });
createRuntimeExecutorHttpServer({ socketPath, executor });
