import { request } from "node:http";
import { conflict } from "./errors.js";
import { assertCommitSha } from "./validation.js";

function protocolError() {
  return conflict("BUILD_EXECUTOR_PROTOCOL_VIOLATION");
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

/** Private local transport from the Forge container to its executor sidecar. */
export class UnixBuildExecutorClient {
  constructor({ socketPath, requestFn = request }) {
    if (typeof socketPath !== "string" || !socketPath.startsWith("/") || typeof requestFn !== "function") {
      throw new TypeError("BUILD_EXECUTOR_SOCKET_PATH_REQUIRED");
    }
    this.socketPath = socketPath;
    this.requestFn = requestFn;
  }

  async startBuild({ project, commitSha }) {
    const normalizedSha = assertCommitSha(commitSha);
    return this.request({ method: "POST", path: "/v1/builds", body: { projectId: project?.projectId, commitSha: normalizedSha } }, (response, body) => {
      if (response.statusCode !== 202 || !exactKeys(body, ["commitSha", "operationId", "state"]) || typeof body.operationId !== "string" || body.commitSha !== normalizedSha || body.state !== "accepted") {
        throw protocolError();
      }
      return Object.freeze(body);
    });
  }

  async getBuildStatus({ operationId }) {
    if (typeof operationId !== "string" || !/^forge-build-adesco-[a-f0-9]{12}$/.test(operationId)) throw protocolError();
    return this.request({ method: "GET", path: `/v1/builds/${operationId}` }, (response, body) => {
      if (response.statusCode !== 200 || !exactKeys(body, ["commitSha", "operationId", "state"]) || body.operationId !== operationId || typeof body.commitSha !== "string" || !["pending", "succeeded", "failed"].includes(body.state)) {
        throw protocolError();
      }
      return Object.freeze(body);
    });
  }

  async request({ method, path, body = null }, validate) {
    return new Promise((resolve, reject) => {
      const clientRequest = this.requestFn({ socketPath: this.socketPath, method, path, headers: body === null ? {} : { "content-type": "application/json" } }, async (response) => {
        const chunks = [];
        for await (const chunk of response) chunks.push(chunk);
        let parsed;
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          resolve(validate(response, parsed));
        } catch (error) {
          reject(error?.code ? error : protocolError());
        }
      });
      clientRequest.once("error", () => reject(conflict("BUILD_EXECUTOR_UNAVAILABLE")));
      clientRequest.end(body === null ? undefined : JSON.stringify(body));
    });
  }
}
