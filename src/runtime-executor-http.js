import { createServer } from "node:http";
import { ForgeError, badRequest } from "./errors.js";

async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16 * 1024) throw badRequest("REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw badRequest("INVALID_JSON_BODY"); }
}

function send(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

export function createRuntimeExecutorRequestHandler({ executor }) {
  if (!executor || typeof executor.startRelease !== "function" || typeof executor.getReleaseStatus !== "function" || typeof executor.getWorkload !== "function" || typeof executor.restartWorkload !== "function") throw new TypeError("RUNTIME_EXECUTOR_DEPENDENCIES_REQUIRED");
  return async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/healthz") return send(response, 200, { status: "ok" });
      if (request.method !== "POST") throw new ForgeError("ROUTE_NOT_FOUND", 404);
      const input = await body(request);
      if (request.url === "/v1/releases" && Object.keys(input).length === 2) return send(response, 200, await executor.startRelease(input));
      if (request.url === "/v1/releases/status" && Object.keys(input).length === 3) return send(response, 200, await executor.getReleaseStatus(input));
      if (request.url === "/v1/runtime/status" && Object.keys(input).length === 1) return send(response, 200, await executor.getWorkload(input.project));
      if (request.url === "/v1/runtime/restart" && Object.keys(input).length === 1) return send(response, 200, await executor.restartWorkload(input));
      throw new ForgeError("ROUTE_NOT_FOUND", 404);
    } catch (error) {
      if (error instanceof ForgeError) return send(response, error.status, { error: { code: error.code } });
      return send(response, 500, { error: { code: "INTERNAL_ERROR" } });
    }
  };
}

export function createRuntimeExecutorHttpServer({ socketPath, ...dependencies }) {
  if (typeof socketPath !== "string" || !socketPath.startsWith("/")) throw new TypeError("RUNTIME_EXECUTOR_SOCKET_REQUIRED");
  const server = createServer(createRuntimeExecutorRequestHandler(dependencies));
  server.listen(socketPath);
  return server;
}
