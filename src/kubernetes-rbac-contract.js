import { badRequest } from "./errors.js";
import { assertRuntimeBinding } from "./validation.js";

const PROJECT_ID = /^[a-z][a-z0-9-]{1,62}$/;

function freeze(value) {
  if (Array.isArray(value)) value.forEach(freeze);
  else if (value && typeof value === "object") Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

/**
 * Owner-side input to the future Kubernetes provisioner. This is deliberately
 * not an API payload: Lyra cannot submit Kubernetes manifests, roles or names.
 * The contract grants only status reads and a narrowly named Deployment patch.
 * It must not be applied until an owner has also approved an admission rule
 * that limits the resulting PodTemplate to a verified image digest and fixed
 * non-privileged settings; RBAC alone cannot constrain patch fields.
 */
export function createProjectRbacContract({ projectId, runtimeBinding }) {
  if (typeof projectId !== "string" || !PROJECT_ID.test(projectId)) {
    throw badRequest("INVALID_PROJECT_ID");
  }
  const binding = assertRuntimeBinding(runtimeBinding);
  if (binding === null || binding.workloadName !== projectId) {
    throw badRequest("INVALID_RUNTIME_BINDING");
  }

  return freeze({
    role: {
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "Role",
      metadata: { name: "forge-control", namespace: binding.namespace },
      rules: [{
        apiGroups: ["apps"],
        resources: ["deployments"],
        resourceNames: [binding.workloadName],
        verbs: ["get", "patch"]
      }]
    },
    roleBinding: {
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "RoleBinding",
      metadata: { name: "forge-control", namespace: binding.namespace },
      subjects: [{ kind: "ServiceAccount", name: "forge-control", namespace: "forge-system" }],
      roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "Role", name: "forge-control" }
    }
  });
}
