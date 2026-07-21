import { conflict, notFound } from "./errors.js";

function unavailable() { return conflict("KUBERNETES_RUNTIME_API_UNAVAILABLE"); }
function statusError(status) {
  if (status === 401) return conflict("KUBERNETES_RUNTIME_AUTH_FAILED");
  if (status === 403) return conflict("KUBERNETES_RUNTIME_FORBIDDEN");
  if (status === 422) return conflict("KUBERNETES_RUNTIME_REJECTED");
  return unavailable();
}

function validName(value) { return typeof value === "string" && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(value); }

/** Kubernetes boundary for fixed runtime templates; it never receives Lyra input directly. */
export class KubernetesRuntimeClient {
  constructor({ fetchFn, apiOrigin, token }) {
    if (typeof fetchFn !== "function" || typeof apiOrigin !== "string" || !/^https:\/\/[a-z0-9.-]+(?::[0-9]+)?$/i.test(apiOrigin) || typeof token !== "string" || token.length === 0) {
      throw new TypeError("KUBERNETES_RUNTIME_CLIENT_CONFIG_REQUIRED");
    }
    this.fetchFn = fetchFn;
    this.apiOrigin = apiOrigin;
    this.token = token;
  }

  async request(path, { method = "GET", body = null, allowExists = false } = {}) {
    let response;
    try {
      response = await this.fetchFn(`${this.apiOrigin}${path}`, {
        method,
        headers: { authorization: `Bearer ${this.token}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
    } catch { throw unavailable(); }
    if (allowExists && response.status === 409) return null;
    if (response.status === 404) throw notFound("RUNTIME_RESOURCE_NOT_FOUND");
    if (!response.ok) throw statusError(response.status);
    try { return await response.json(); } catch { throw unavailable(); }
  }

  async createDeployment(deployment) {
    const namespace = deployment?.metadata?.namespace;
    const name = deployment?.metadata?.name;
    if (!validName(namespace) || !validName(name)) throw unavailable();
    const result = await this.request(`/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments`, { method: "POST", body: deployment, allowExists: true });
    if (result !== null && (result?.metadata?.namespace !== namespace || result?.metadata?.name !== name)) throw unavailable();
    return Object.freeze({ state: result === null ? "exists" : "created", name });
  }

  async getDeployment({ namespace, name }) {
    if (!validName(namespace) || !validName(name)) throw unavailable();
    const result = await this.request(`/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments/${encodeURIComponent(name)}`);
    if (result?.metadata?.namespace !== namespace || result?.metadata?.name !== name) throw unavailable();
    return result;
  }

  async patchDeployment({ namespace, name, patch }) {
    if (!validName(namespace) || !validName(name) || !patch || typeof patch !== "object" || Array.isArray(patch)) throw unavailable();
    const result = await this.request(`/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments/${encodeURIComponent(name)}`, { method: "PATCH", body: patch });
    if (result?.metadata?.namespace !== namespace || result?.metadata?.name !== name) throw unavailable();
    return result;
  }

  async createService(service) {
    const namespace = service?.metadata?.namespace;
    const name = service?.metadata?.name;
    if (!validName(namespace) || !validName(name)) throw unavailable();
    const result = await this.request(`/api/v1/namespaces/${encodeURIComponent(namespace)}/services`, { method: "POST", body: service, allowExists: true });
    if (result !== null && (result?.metadata?.namespace !== namespace || result?.metadata?.name !== name)) throw unavailable();
    return Object.freeze({ state: result === null ? "exists" : "created", name });
  }

  async getService({ namespace, name }) {
    if (!validName(namespace) || !validName(name)) throw unavailable();
    const result = await this.request(`/api/v1/namespaces/${encodeURIComponent(namespace)}/services/${encodeURIComponent(name)}`);
    if (result?.metadata?.namespace !== namespace || result?.metadata?.name !== name) throw unavailable();
    return result;
  }

  async patchService({ namespace, name, patch }) {
    if (!validName(namespace) || !validName(name) || !patch || typeof patch !== "object" || Array.isArray(patch)) throw unavailable();
    const result = await this.request(`/api/v1/namespaces/${encodeURIComponent(namespace)}/services/${encodeURIComponent(name)}`, { method: "PATCH", body: patch });
    if (result?.metadata?.namespace !== namespace || result?.metadata?.name !== name) throw unavailable();
    return result;
  }
}
