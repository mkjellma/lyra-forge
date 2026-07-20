import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { ForgeError, badRequest, unauthorized } from "./errors.js";

const JSON_LIMIT_BYTES = 16 * 1024;

function tokensMatch(received, expected) {
  const receivedBuffer = Buffer.from(received ?? "");
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > JSON_LIMIT_BYTES) {
      throw badRequest("REQUEST_TOO_LARGE");
    }
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw badRequest("INVALID_JSON_BODY");
    }
    return body;
  } catch (error) {
    if (error instanceof ForgeError) throw error;
    throw badRequest("INVALID_JSON_BODY");
  }
}

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

export function createForgeRequestHandler({ forge, apiToken }) {
  if (!apiToken || typeof apiToken !== "string") {
    throw new Error("FORGE_API_TOKEN_REQUIRED");
  }

  return async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      if (request.method === "GET" && url.pathname === "/healthz") {
        return send(response, 200, { status: "ok" });
      }

      const authorization = request.headers.authorization;
      const bearerToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
      if (!tokensMatch(bearerToken, apiToken)) {
        throw unauthorized();
      }

      if (url.pathname === "/v1/projects") {
        if (request.method === "GET") {
          return send(response, 200, { projects: forge.listProjects() });
        }
        if (request.method === "POST") {
          const body = await readJson(request);
          return send(response, 201, { project: await forge.registerProject(body) });
        }
        throw new ForgeError("ROUTE_NOT_FOUND", 404);
      }

      const matches = url.pathname.match(/^\/v1\/projects\/([a-z][a-z0-9-]{1,62})(?:\/(releases|deploy|restart|deploy-pause|rollback))?$/);
      if (!matches) {
        throw new ForgeError("ROUTE_NOT_FOUND", 404);
      }
      const [, projectId, operation] = matches;
      let result;
      if (request.method === "GET" && !operation) {
        result = await forge.getProjectStatus(projectId);
      } else if (request.method === "GET" && operation === "releases") {
        result = await forge.listDeployHistory(projectId);
      } else if (request.method === "POST" && operation === "deploy") {
        const body = await readJson(request);
        result = await forge.requestDeploy(projectId, body.commitSha);
      } else if (request.method === "POST" && operation === "restart") {
        result = await forge.restartService(projectId);
      } else if (request.method === "POST" && operation === "deploy-pause") {
        const body = await readJson(request);
        result = await forge.setDeployPaused(projectId, body.paused);
      } else if (request.method === "POST" && operation === "rollback") {
        const body = await readJson(request);
        result = await forge.rollbackProject(projectId, body.targetReleaseId);
      } else {
        throw new ForgeError("ROUTE_NOT_FOUND", 404);
      }
      return send(response, 200, result);
    } catch (error) {
      if (error instanceof ForgeError) {
        return send(response, error.status, { error: { code: error.code } });
      }
      return send(response, 500, { error: { code: "INTERNAL_ERROR" } });
    }
  };
}

export function createForgeHttpServer(dependencies) {
  return createServer(createForgeRequestHandler(dependencies));
}
