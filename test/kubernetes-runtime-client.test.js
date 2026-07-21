import test from "node:test";
import assert from "node:assert/strict";
import { KubernetesRuntimeClient } from "../src/kubernetes-runtime-client.js";

test("runtimeklienten använder Kubernetes merge-patch för begränsade ändringar", async () => {
  let request;
  const client = new KubernetesRuntimeClient({
    apiOrigin: "https://kubernetes.default.svc:443", token: "token",
    fetchFn: async (_url, options) => {
      request = options;
      return { ok: true, status: 200, async json() { return { metadata: { namespace: "forge-runtime", name: "forge-adesco" } }; } };
    }
  });
  await client.patchService({ namespace: "forge-runtime", name: "forge-adesco", patch: { spec: { selector: { "forge.lyra/release": "release-1" } } } });
  assert.equal(request.method, "PATCH");
  assert.equal(request.headers["content-type"], "application/merge-patch+json");
});
