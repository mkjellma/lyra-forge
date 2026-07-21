import { loadNoccoRuntimeProjects } from "./nocco-runtime-template.js";

function matches(project, policy) {
  return policy && project?.projectId === policy.projectId && project.repository === policy.repository
    && project.allowedBranch === policy.allowedBranch && project.buildProfile === policy.buildProfile
    && project.runtimeProfile === policy.runtimeProfile;
}

/** Pure owner-config lookup; it has no Kubernetes client and creates nothing. */
export class OwnerRuntimeProvisioner {
  constructor(source) {
    this.policies = source instanceof Map ? source : loadNoccoRuntimeProjects(source);
  }

  async provision(project) {
    const policy = this.policies.get(project?.projectId);
    return Object.freeze({ runtimeBinding: matches(project, policy) ? policy.runtimeBinding : null });
  }
}
