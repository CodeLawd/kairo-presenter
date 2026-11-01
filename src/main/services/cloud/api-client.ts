import axios, { AxiosInstance, AxiosError } from "axios";
import log from "electron-log/main";

/** Short: no cloud call may ever be the reason an operator waits. */
const REQUEST_TIMEOUT_MS = 8000;

export interface ApiError {
  status: number | null;
  message: string;
}

export class CloudApiClient {
  private http: AxiosInstance;
  private baseUrl: string;
  private selectedBaseUrl: string | null = null;
  private selecting: Promise<string> | null = null;
  private accessToken: string | null = null;
  private refreshing: Promise<boolean> | null = null;

  constructor(
    baseUrl: string,
    private readonly onRefresh: () => Promise<string | null>,
    private readonly fallbackBaseUrl?: string,
  ) {
    this.baseUrl = baseUrl;
    this.http = axios.create({
      baseURL: baseUrl,
      timeout: REQUEST_TIMEOUT_MS,
      headers: { "Content-Type": "application/json", "X-PA-Client": "desktop" },
    });
  }

  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl;
    this.selectedBaseUrl = null;
    this.http.defaults.baseURL = baseUrl;
  }

  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  async request<T>(
    method: "get" | "post" | "patch" | "put" | "delete",
    path: string,
    body?: unknown,
    options: {
      authenticated?: boolean;
      allowRefresh?: boolean;
      /** Override the 8s default. Only for calls nobody is waiting on. */
      timeoutMs?: number;
    } = {},
  ): Promise<T> {
    const endpoint = await this.endpoint();
    const authenticated = options.authenticated ?? true;
    if (authenticated && !this.accessToken && options.allowRefresh !== false) {
      await this.refreshOnce();
    }
    try {
      return await this.send<T>(method, path, body, authenticated, options.timeoutMs, endpoint);
    } catch (error) {
      if (this.fallbackBaseUrl && !(error as AxiosError).response) {
        this.selectedBaseUrl = null;
        // A timed-out write may have reached the server. Only reads are safe
        // to repeat against the other address automatically.
        if (method === "get") {
          const retryEndpoint = await this.endpoint();
          if (retryEndpoint !== endpoint) {
            return this.send<T>(method, path, body, authenticated, options.timeoutMs, retryEndpoint);
          }
        }
      }
      const status = (error as AxiosError).response?.status ?? null;
      const refreshable =
        authenticated && status === 401 && options.allowRefresh !== false;

      if (refreshable && (await this.refreshOnce())) {
        return this.send<T>(method, path, body, authenticated, options.timeoutMs, endpoint);
      }
      throw toApiError(error);
    }
  }

  private async send<T>(
    method: "get" | "post" | "patch" | "put" | "delete",
    path: string,
    body: unknown,
    authenticated: boolean,
    timeoutMs?: number,
    endpoint = this.baseUrl,
  ): Promise<T> {
    const headers =
      authenticated && this.accessToken
        ? { Authorization: `Bearer ${this.accessToken}` }
        : undefined;
    const response = await this.http.request<T>({
      method,
      url: path.startsWith(`${this.baseUrl}/`) && endpoint !== this.baseUrl
        ? `${endpoint}${path.slice(this.baseUrl.length)}`
        : path,
      baseURL: endpoint,
      data: body,
      headers,
      timeout: timeoutMs,
    });
    return response.data;
  }

  /** Pick a reachable API address before a write, so failover cannot duplicate it. */
  private async endpoint(): Promise<string> {
    if (!this.fallbackBaseUrl) return this.baseUrl;
    if (this.selectedBaseUrl) return this.selectedBaseUrl;
    if (!this.selecting) {
      this.selecting = (async () => {
        for (const candidate of [this.baseUrl, this.fallbackBaseUrl!]) {
          try {
            await this.http.get(`${candidate}/v1/health`, { timeout: 3_000 });
            this.selectedBaseUrl = candidate;
            if (candidate === this.fallbackBaseUrl) log.info('[Cloud] Using backup API route');
            return candidate;
          } catch { /* Try the next address. */ }
        }
        // Preserve the normal API error when neither address is reachable.
        return this.baseUrl;
      })().finally(() => { this.selecting = null; });
    }
    return this.selecting;
  }

  /** Collapses concurrent refreshes into one — see the class comment. */
  private async refreshOnce(): Promise<boolean> {
    if (!this.refreshing) {
      this.refreshing = this.onRefresh()
        .then((token) => {
          if (token) this.accessToken = token;
          return token !== null;
        })
        .catch((error) => {
          log.warn("[Cloud] Token refresh failed", {
            error: (error as Error).message,
          });
          return false;
        })
        .finally(() => {
          this.refreshing = null;
        });
    }
    return this.refreshing;
  }
}

/** Turns an axios failure into something an operator can read. */
export function toApiError(error: unknown): ApiError {
  const axiosError = error as AxiosError<{ message?: string | string[] }>;
  const status = axiosError.response?.status ?? null;

  if (!axiosError.response) {
    return {
      status: null,
      message: "Could not reach Kairo. Check your internet connection.",
    };
  }

  const raw = axiosError.response.data?.message;
  // Nest's ValidationPipe returns an array of messages; the first is the one
  // that matters to whoever is looking at the form.
  const message = Array.isArray(raw) ? raw[0] : raw;
  if (message) return { status, message };

  if (status === 401) return { status, message: "Please sign in again." };
  if (status === 403)
    return { status, message: "You do not have access to that." };
  if (status && status >= 500) {
    return {
      status,
      message: "Kairo is having trouble. Try again shortly.",
    };
  }
  return { status, message: "Something went wrong." };
}
