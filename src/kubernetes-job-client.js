import { conflict, notFound } from "./errors.js";

function apiError() {
  return conflict("KUBERNETES_JOB_API_UNAVAILABLE");
}

function apiStatusError(status) {
  if (status === 401) return conflict("KUBERNETES_JOB_AUTH_FAILED");
  if (status === 403) return conflict("KUBERNETES_JOB_FORBIDDEN");
  if (status === 422) return conflict("KUBERNETES_JOB_REJECTED");
  return apiError();
}

/**
 * Tiny Kubernetes boundary used only by the executor Deployment. Forge's
 * control-plane does not construct this client or receive its token.
 */
export class KubernetesJobClient {
  constructor({ fetchFn, apiOrigin, token }) {
    if (typeof fetchFn !== "function" || typeof apiOrigin !== "string" || !/^https:\/\/[a-z0-9.-]+(?::[0-9]+)?$/i.test(apiOrigin) || typeof token !== "string" || token.length === 0) {
      throw new TypeError("KUBERNETES_JOB_CLIENT_CONFIG_REQUIRED");
    }
    this.fetchFn = fetchFn;
    this.apiOrigin = apiOrigin;
    this.token = token;
  }

  async createJob(job) {
    const namespace = job?.metadata?.namespace;
    const name = job?.metadata?.name;
    if (typeof namespace !== "string" || typeof name !== "string") throw apiError();
    let response;
    try {
      response = await this.fetchFn(`${this.apiOrigin}/apis/batch/v1/namespaces/${encodeURIComponent(namespace)}/jobs`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify(job)
      });
    } catch {
      throw apiError();
    }
    if (response.status === 409) return Object.freeze({ state: "exists", name });
    if (!response.ok) throw apiStatusError(response.status);
    let created;
    try {
      created = await response.json();
    } catch {
      throw apiError();
    }
    if (created?.metadata?.name !== name || created?.metadata?.namespace !== namespace) throw apiError();
    return Object.freeze({ state: "created", name });
  }

  async getJob({ namespace, name }) {
    if (typeof namespace !== "string" || typeof name !== "string") throw apiError();
    let response;
    try {
      response = await this.fetchFn(`${this.apiOrigin}/apis/batch/v1/namespaces/${encodeURIComponent(namespace)}/jobs/${encodeURIComponent(name)}`, {
        method: "GET",
        headers: { authorization: `Bearer ${this.token}`, accept: "application/json" }
      });
    } catch {
      throw apiError();
    }
    if (response.status === 404) throw notFound("BUILD_NOT_FOUND");
    if (!response.ok) throw apiStatusError(response.status);
    let job;
    try {
      job = await response.json();
    } catch {
      throw apiError();
    }
    if (job?.metadata?.name !== name || job?.metadata?.namespace !== namespace) throw apiError();
    return job;
  }
}
