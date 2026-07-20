import test from "node:test";
import assert from "node:assert/strict";
import { createProjectRbacContract } from "../src/kubernetes-rbac-contract.js";
import { exampleProject } from "./helpers.js";

test("projektets RBAC-kontrakt kan enbart läsa och patcha dess namngivna Deployment", () => {
  const contract = createProjectRbacContract({ projectId: "adesco", runtimeBinding: exampleProject().runtimeBinding });

  assert.deepEqual(contract.role, {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "Role",
    metadata: { name: "forge-control", namespace: "forge" },
    rules: [{ apiGroups: ["apps"], resources: ["deployments"], resourceNames: ["adesco"], verbs: ["get", "patch"] }]
  });
  assert.deepEqual(contract.roleBinding.subjects, [{ kind: "ServiceAccount", name: "forge-control", namespace: "forge-system" }]);
  assert.equal(Object.isFrozen(contract), true);
  assert.equal(Object.isFrozen(contract.role.rules[0]), true);
});

test("RBAC-kontraktet avvisar fria eller felbundna Kubernetes-resurser", () => {
  assert.throws(
    () => createProjectRbacContract({ projectId: "adesco", runtimeBinding: { kind: "kubernetes", namespace: "forge", workloadName: "other" } }),
    { code: "INVALID_RUNTIME_BINDING" }
  );
  assert.throws(
    () => createProjectRbacContract({ projectId: "adesco", runtimeBinding: null }),
    { code: "INVALID_RUNTIME_BINDING" }
  );
});
