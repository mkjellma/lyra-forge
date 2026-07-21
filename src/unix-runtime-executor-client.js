import http from "node:http";
import { conflict } from "./errors.js";

function protocol() { return conflict("RUNTIME_EXECUTOR_PROTOCOL_VIOLATION"); }

/** Private Unix-socket client; no Kubernetes credential reaches Forge itself. */
export class UnixRuntimeExecutorClient {
  constructor({ socketPath, requestFn = http.request }) {
    if (typeof socketPath !== "string" || !socketPath.startsWith("/") || typeof requestFn !== "function") throw new TypeError("RUNTIME_EXECUTOR_SOCKET_REQUIRED");
    this.socketPath = socketPath;
    this.requestFn = requestFn;
  }

  request(path, body) {
    return new Promise((resolve, reject) => {
      const request = this.requestFn({ socketPath: this.socketPath, path, method: "POST", headers: { "content-type": "application/json" } }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          let parsed;
          try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return reject(protocol()); }
          if (response.statusCode !== 200) return reject(protocol());
          resolve(parsed);
        });
      });
      request.on("error", () => reject(conflict("RUNTIME_EXECUTOR_UNAVAILABLE")));
      request.end(JSON.stringify(body));
    });
  }

  startRelease({ project, release }) { return this.request("/v1/releases", { project, release }); }
  getReleaseStatus({ project, release, operationId }) { return this.request("/v1/releases/status", { project, release, operationId }); }
  getWorkload({ project }) { return this.request("/v1/runtime/status", { project }); }
  restartWorkload({ project }) { return this.request("/v1/runtime/restart", { project }); }
}
