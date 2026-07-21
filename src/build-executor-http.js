import { createServer } from "node:http";
import { ForgeError, badRequest } from "./errors.js";
import { assertCommitSha } from "./validation.js";

const JSON_LIMIT_BYTES = 1024;

async function readBuildRequest(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > JSON_LIMIT_BYTES) throw badRequest("REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw badRequest("INVALID_JSON_BODY");
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 2 || typeof body.projectId !== "string") {
    throw badRequest("INVALID_BUILD_REQUEST");
  }
  return Object.freeze({ projectId: body.projectId, commitSha: assertCommitSha(body.commitSha) });
}

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

export function createBuildExecutorRequestHandler({ executor, projectResolver }) {
  if (!executor || typeof executor.startBuild !== "function" || typeof projectResolver !== "function") {
    throw new TypeError("BUILD_EXECUTOR_DEPENDENCIES_REQUIRED");
  }
  return async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/healthz") return send(response, 200, { status: "ok" });
      const statusMatch = request.url?.match(/^\/v1\/builds\/(forge-build-[a-z0-9-]{1,63})$/);
      if (request.method === "GET" && statusMatch) {
        return send(response, 200, await executor.getBuildStatus({ operationId: statusMatch[1] }));
      }
      if (request.method !== "POST" || request.url !== "/v1/builds") throw new ForgeError("ROUTE_NOT_FOUND", 404);
      const input = await readBuildRequest(request);
      const project = projectResolver(input.projectId);
      const build = await executor.startBuild({ project, commitSha: input.commitSha });
      return send(response, 202, build);
    } catch (error) {
      if (error instanceof ForgeError) return send(response, error.status, { error: { code: error.code } });
      return send(response, 500, { error: { code: "INTERNAL_ERROR" } });
    }
  };
}

export function createBuildExecutorHttpServer({ socketPath, ...dependencies }) {
  if (typeof socketPath !== "string" || !socketPath.startsWith("/")) throw new TypeError("BUILD_EXECUTOR_SOCKET_PATH_REQUIRED");
  const server = createServer(createBuildExecutorRequestHandler(dependencies));
  server.listen(socketPath);
  return server;
}
