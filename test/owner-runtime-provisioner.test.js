import test from "node:test";
import assert from "node:assert/strict";
import { OwnerRuntimeProvisioner } from "../src/owner-runtime-provisioner.js";
import { exampleProject } from "./helpers.js";

test("ägarinventeringen kan provisionera ett matchande registrerat projekt utan Kubernetes-mutation", async () => {
  const provisioner = new OwnerRuntimeProvisioner({ projects: [{
    projectId: "adesco", repository: "https://github.com/example/adesco.git", allowedBranch: "main",
    buildProfile: "nextjs-npm", runtimeProfile: "private-http", registryRepository: "forge/adesco"
  }] });
  assert.deepEqual(await provisioner.provision(exampleProject({ runtimeBinding: null })), {
    runtimeBinding: { kind: "kubernetes", namespace: "forge-runtime", workloadName: "forge-adesco" }
  });
  assert.deepEqual(await provisioner.provision(exampleProject({ repository: "https://github.com/example/other.git", runtimeBinding: null })), { runtimeBinding: null });
});
