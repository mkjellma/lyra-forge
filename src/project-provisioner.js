import { conflict } from "./errors.js";

function validResult(result) {
  return result && typeof result === "object" && !Array.isArray(result)
    && (result.coolifyApplicationUuid === null || typeof result.coolifyApplicationUuid === "string");
}

/**
 * This deliberately performs no host, Coolify, GitHub or secret mutation.
 * It lets Forge accept a registered project today while reserving one narrow
 * hand-off point for a future deployment-engine provisioner.
 */
export class PendingProjectProvisioner {
  async provision() {
    return Object.freeze({ coolifyApplicationUuid: null });
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
  return result;
}
