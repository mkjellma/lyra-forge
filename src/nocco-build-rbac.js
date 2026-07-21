import { badRequest } from "./errors.js";

const NAMESPACE = "forge-build";

/**
 * The executor can create and inspect Jobs only. The fixed template is the
 * lab pilot's primary guardrail; admission enforcement remains later
 * hardening because Kubernetes RBAC cannot limit a created Job's Pod template.
 */
export function createNoccoBuildExecutorRbac({ serviceAccountName = "forge-build-executor" } = {}) {
  if (typeof serviceAccountName !== "string" || !/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(serviceAccountName)) {
    throw badRequest("INVALID_EXECUTOR_SERVICE_ACCOUNT");
  }
  return Object.freeze({
    serviceAccount: Object.freeze({
      apiVersion: "v1",
      kind: "ServiceAccount",
      metadata: Object.freeze({ name: serviceAccountName, namespace: NAMESPACE }),
      automountServiceAccountToken: true
    }),
    buildJobServiceAccount: Object.freeze({
      apiVersion: "v1",
      kind: "ServiceAccount",
      metadata: Object.freeze({ name: "forge-build-job", namespace: NAMESPACE }),
      automountServiceAccountToken: false
    }),
    role: Object.freeze({
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "Role",
      metadata: Object.freeze({ name: "forge-build-executor", namespace: NAMESPACE }),
      rules: Object.freeze([{ apiGroups: Object.freeze(["batch"]), resources: Object.freeze(["jobs"]), verbs: Object.freeze(["create", "get"]) }])
    }),
    roleBinding: Object.freeze({
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "RoleBinding",
      metadata: Object.freeze({ name: "forge-build-executor", namespace: NAMESPACE }),
      subjects: Object.freeze([{ kind: "ServiceAccount", name: serviceAccountName, namespace: NAMESPACE }]),
      roleRef: Object.freeze({ apiGroup: "rbac.authorization.k8s.io", kind: "Role", name: "forge-build-executor" })
    })
  });
}
