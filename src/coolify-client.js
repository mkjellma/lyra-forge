import { conflict } from "./errors.js";

const METHODS = new Set(["GET", "PATCH", "POST"]);
const PATH = /^\/[a-z0-9/-]+$/;

function protocolError() {
  return conflict("COOLIFY_PROTOCOL_VIOLATION");
}

function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("COOLIFY_API_URL_INVALID");
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new TypeError("COOLIFY_API_URL_INVALID");
  }
  return url.origin;
}

function validRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request) || !METHODS.has(request.method) || typeof request.path !== "string" || !PATH.test(request.path)) {
    throw protocolError();
  }
  if (request.body !== undefined && (!request.body || typeof request.body !== "object" || Array.isArray(request.body))) {
    throw protocolError();
  }
}

/**
 * The only network boundary for the Coolify adapter. Its token is supplied at
 * runtime and is never returned, logged, or persisted by this module.
 */
export class CoolifyHttpClient {
  constructor({ baseUrl, apiToken, fetchFn = globalThis.fetch }) {
    if (typeof apiToken !== "string" || apiToken.length === 0) throw new TypeError("COOLIFY_API_TOKEN_REQUIRED");
    if (typeof fetchFn !== "function") throw new TypeError("COOLIFY_FETCH_REQUIRED");
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.apiToken = apiToken;
    this.fetchFn = fetchFn;
  }

  async request(request) {
    validRequest(request);
    const headers = {
      accept: "application/json",
      authorization: `Bearer ${this.apiToken}`
    };
    const options = { method: request.method, headers };
    if (request.body !== undefined) {
      headers["content-type"] = "application/json";
      options.body = JSON.stringify(request.body);
    }
    let response;
    try {
      response = await this.fetchFn(`${this.baseUrl}/api/v1${request.path}`, options);
    } catch {
      throw conflict("COOLIFY_UNAVAILABLE");
    }
    if (!response || typeof response.ok !== "boolean" || typeof response.json !== "function") throw protocolError();
    if (!response.ok) throw conflict("COOLIFY_API_REJECTED");
    try {
      return await response.json();
    } catch {
      throw protocolError();
    }
  }
}
