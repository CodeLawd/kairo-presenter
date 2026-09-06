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
  private accessToken: string | null = null;
  private refreshing: Promise<boolean> | null = null;

  constructor(
    baseUrl: string,
    private readonly onRefresh: () => Promise<string | null>,
  ) {
    this.http = axios.create({
      baseURL: baseUrl,
      timeout: REQUEST_TIMEOUT_MS,
      headers: { "Content-Type": "application/json", "X-PA-Client": "desktop" },
    });
  }

  setBaseUrl(baseUrl: string): void {
    this.http.defaults.baseURL = baseUrl;
  }

  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  async request<T>(
    method: "get" | "post" | "patch" | "put" | "delete",
    path: string,
    body?: unknown,
    options: { authenticated?: boolean; allowRefresh?: boolean } = {},
  ): Promise<T> {
    const authenticated = options.authenticated ?? true;
    try {
      return await this.send<T>(method, path, body, authenticated);
    } catch (error) {
      const status = (error as AxiosError).response?.status ?? null;
      const refreshable =
        authenticated && status === 401 && options.allowRefresh !== false;

      if (refreshable && (await this.refreshOnce())) {
        return this.send<T>(method, path, body, authenticated);
      }
      throw toApiError(error);
    }
  }

  private async send<T>(
    method: "get" | "post" | "patch" | "put" | "delete",
    path: string,
    body: unknown,
    authenticated: boolean,
  ): Promise<T> {
    const headers =
      authenticated && this.accessToken
        ? { Authorization: `Bearer ${this.accessToken}` }
        : undefined;
    const response = await this.http.request<T>({
      method,
      url: path,
      data: body,
      headers,
    });
    return response.data;
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
