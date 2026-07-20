import { conflict } from "./errors.js";
import { assertRuntimeBinding } from "./validation.js";

function validResult(result) {
  return result && typeof result === "object" && !Array.isArray(result)
    && Object.keys(result).length === 1
    && (result.runtimeBinding === null || (result.runtimeBinding && typeof result.runtimeBinding === "object"));
}

/**
 * This deliberately performs no host, Kubernetes, GitHub or secret mutation.
 * It lets Forge accept a registered project today while reserving one narrow
 * hand-off point for a future deployment-engine provisioner.
 */
export class PendingProjectProvisioner {
  async provision() {
    return Object.freeze({ runtimeBinding: null });
  }
}

export async function provisionProject(provisioner, project) {
  if (!provisioner || typeof provisioner.provision !== "function") {
    throw conflict("PROJECT_PROVISIONER_UNAVAILABLE");
  }
  const result = await provisioner.provision(project);
  if (!validResult(result)) {
    throw conflict("PROJECT_PROVISIONER_PROTOCOL_VIOLATION");
  }
  try {
    const runtimeBinding = assertRuntimeBinding(result.runtimeBinding);
    if (runtimeBinding !== null && runtimeBinding.workloadName !== project.projectId) {
      throw new Error("binding must belong to the project");
    }
    return Object.freeze({ runtimeBinding });
  } catch {
    throw conflict("PROJECT_PROVISIONER_PROTOCOL_VIOLATION");
  }
}
