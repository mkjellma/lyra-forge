import { readFile } from "node:fs/promises";
import { unlink } from "node:fs/promises";
import { createBuildExecutorHttpServer } from "./build-executor-http.js";
import { KubernetesJobClient } from "./kubernetes-job-client.js";
import { NoccoBuildExecutor } from "./nocco-build-executor.js";
import { loadNoccoBuildProjects } from "./nocco-build-template.js";

function required(value, code) {
  if (typeof value !== "string" || value.length === 0) throw new Error(code);
  return value;
}

const host = process.env.KUBERNETES_SERVICE_HOST ?? "kubernetes.default.svc";
const port = process.env.KUBERNETES_SERVICE_PORT_HTTPS ?? "443";
const token = (await readFile("/var/run/secrets/kubernetes.io/serviceaccount/token", "utf8")).trim();
const policyPath = required(process.env.FORGE_BUILD_PROJECTS_PATH, "FORGE_BUILD_PROJECTS_PATH_REQUIRED");
const policies = loadNoccoBuildProjects(JSON.parse(await readFile(policyPath, "utf8")));
const jobClient = new KubernetesJobClient({ fetchFn: fetch, apiOrigin: `https://${host}:${port}`, token });
const executor = new NoccoBuildExecutor({
  jobClient,
  checkoutImage: required(process.env.FORGE_CHECKOUT_IMAGE, "FORGE_CHECKOUT_IMAGE_REQUIRED"),
  builderImage: required(process.env.FORGE_BUILDER_IMAGE, "FORGE_BUILDER_IMAGE_REQUIRED"),
  policies
});
const socketPath = process.env.FORGE_BUILD_EXECUTOR_SOCKET ?? "/var/run/forge-executor/executor.sock";
await unlink(socketPath).catch((error) => {
  if (error.code !== "ENOENT") throw error;
});
createBuildExecutorHttpServer({
  socketPath,
  executor,
  projectResolver(projectId) {
    return policies.get(projectId) ?? null;
  }
});
