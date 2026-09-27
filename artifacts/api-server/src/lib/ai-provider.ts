export type AIProviderConfig = {
  apiKey: string;
  baseUrl: string;
  connection: "replit_managed_openai" | "direct_openai";
};

export type ProviderAvailabilityState =
  | "available" | "unconfigured" | "auth_failed" | "rate_limited" | "timeout" | "unavailable";

export type ProviderAvailability = {
  state: ProviderAvailabilityState;
  checkedAt: string;
};

export type ProviderAttemptFailure = {
  provider: AIProviderConfig;
  state: ProviderAvailabilityState;
};

export type ProviderAvailabilityMonitor = {
  get(provider: AIProviderConfig | null): Promise<ProviderAvailability>;
  peek(provider: AIProviderConfig, maxAgeMs?: number): ProviderAvailability | null;
  record(provider: AIProviderConfig, state: ProviderAvailabilityState, maxAgeMs?: number): void;
};

export type ProviderRequestResult =
  | {
      kind: "success";
      provider: AIProviderConfig;
      response: Response;
      failures: ProviderAttemptFailure[];
    }
  | {
      kind: "failure";
      provider: AIProviderConfig;
      state: ProviderAvailabilityState;
      failures: ProviderAttemptFailure[];
      response?: Response;
    };

const PROVIDER_AVAILABILITY_TTL_MS = 20_000;
const AUTH_FAILURE_FALLBACK_TTL_MS = 5 * 60_000;
const QUOTA_FAILURE_COOLDOWN_MS = 5 * 60_000;
const DEFAULT_MAX_RETRIES_PER_PROVIDER = 2;
const MAX_RETRIES_PER_PROVIDER = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const DEFAULT_MAX_BACKOFF_MS = 5_000;
const DEFAULT_MAX_RETRY_AFTER_MS = 30_000;

export type ProviderRequestOptions = {
  maxRetriesPerProvider?: number;
  retryBaseDelayMs?: number;
  maxBackoffMs?: number;
  maxRetryAfterMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  now?: () => number;
};

export function classifyProviderResponse(status: number): ProviderAvailabilityState {
  if (status === 401 || status === 403) return "auth_failed";
  if (status === 429) return "rate_limited";
  if (status === 408 || status === 504) return "timeout";
  return "unavailable";
}

export function shouldFallbackForAvailability(state: ProviderAvailabilityState): boolean {
  return state === "auth_failed" || state === "rate_limited" ||
    state === "timeout" || state === "unavailable";
}

export function classifyProviderException(error: unknown): ProviderAvailabilityState {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
    ? "timeout"
    : "unavailable";
}

function canFallbackForResponseStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 404 ||
    status === 408 || status === 429 || status === 504 || status >= 500;
}

function isProviderAvailabilityFailureStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 404 ||
    status === 408 || status === 429 || status === 504 || status >= 500;
}

type ProviderErrorDetails = {
  type: string;
  code: string;
  message: string;
};

async function readProviderErrorDetails(response: Response): Promise<ProviderErrorDetails> {
  try {
    const payload = await response.clone().json() as {
      error?: { type?: unknown; code?: unknown; message?: unknown };
    };
    const error = payload?.error;
    return {
      type: typeof error?.type === "string" ? error.type.toLowerCase() : "",
      code: typeof error?.code === "string" ? error.code.toLowerCase() : "",
      message: typeof error?.message === "string" ? error.message.toLowerCase() : "",
    };
  } catch {
    return { type: "", code: "", message: "" };
  }
}

function isNonRetryableQuotaError(details: ProviderErrorDetails): boolean {
  return /credit_balance_exhausted|insufficient_quota|project_spend_limit_exceeded|organization_spend_limit_exceeded|organization_usage_limit_exceeded|billing_hard_limit_reached/u
    .test(`${details.type} ${details.code} ${details.message}`);
}

function retryAfterDelayMs(response: Response, now: number): number | null {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function retryTtlForState(state: ProviderAvailabilityState): number {
  return state === "auth_failed"
    ? AUTH_FAILURE_FALLBACK_TTL_MS
    : PROVIDER_AVAILABILITY_TTL_MS;
}

const defaultSleep = (delayMs: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, delayMs));

export async function requestWithProviderFallback(
  providers: AIProviderConfig[],
  request: (provider: AIProviderConfig) => Promise<Response>,
  availabilityMonitor?: ProviderAvailabilityMonitor,
  options: ProviderRequestOptions = {},
): Promise<ProviderRequestResult | null> {
  const monitor = availabilityMonitor ?? sharedAIProviderAvailabilityMonitor;
  const maxRetries = Math.min(
    MAX_RETRIES_PER_PROVIDER,
    Math.max(0, Math.trunc(options.maxRetriesPerProvider ?? DEFAULT_MAX_RETRIES_PER_PROVIDER)),
  );
  const retryBaseDelayMs = Math.max(0, options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS);
  const maxBackoffMs = Math.max(0, options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS);
  const maxRetryAfterMs = Math.max(0, options.maxRetryAfterMs ?? DEFAULT_MAX_RETRY_AFTER_MS);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const cachedFailures = providers
    .map((provider) => ({ provider, availability: monitor.peek(provider) }))
    .filter(({ availability }) =>
      availability && shouldFallbackForAvailability(availability.state),
    );
  const orderedProviders = providers.filter((provider) =>
    !cachedFailures.some((entry) => entry.provider === provider),
  );
  const failures: ProviderAttemptFailure[] = [];

  if (orderedProviders.length === 0) {
    const lastCachedFailure = cachedFailures.at(-1);
    if (lastCachedFailure?.availability) {
      return {
        kind: "failure",
        provider: lastCachedFailure.provider,
        state: lastCachedFailure.availability.state,
        failures,
      };
    }
    return null;
  }

  for (let index = 0; index < orderedProviders.length; index++) {
    const provider = orderedProviders[index];
    const hasNextProvider = index + 1 < orderedProviders.length;

    let attempt = 0;
    while (true) {
      let response: Response;
      try {
        response = await request(provider);
      } catch (error) {
        const state = classifyProviderException(error);
        failures.push({ provider, state });
        monitor.record(provider, state);
        if (hasNextProvider && shouldFallbackForAvailability(state)) break;
        return { kind: "failure", provider, state, failures };
      }

      if (response.ok) {
        monitor.record(provider, "available");
        return { kind: "success", provider, response, failures };
      }

      const state = classifyProviderResponse(response.status);
      const errorDetails = await readProviderErrorDetails(response);
      const quotaFailure = isNonRetryableQuotaError(errorDetails);
      const retryAfterMs = retryAfterDelayMs(response, now());
      const transientStatus = response.status === 429 ||
        (response.status >= 500 && response.status <= 599);
      failures.push({ provider, state });

      if (
        transientStatus &&
        !quotaFailure &&
        attempt < maxRetries
      ) {
        const retryDelayMs = retryAfterMs === null
          ? Math.min(retryBaseDelayMs * (2 ** attempt), maxBackoffMs)
          : retryAfterMs <= maxRetryAfterMs
            ? retryAfterMs
            : null;
        if (retryDelayMs !== null) {
          attempt++;
          await sleep(retryDelayMs);
          continue;
        }
      }

      if (isProviderAvailabilityFailureStatus(response.status)) {
        const cooldownMs = quotaFailure
          ? QUOTA_FAILURE_COOLDOWN_MS
          : retryAfterMs === null
            ? retryTtlForState(state)
            : Math.max(retryTtlForState(state), retryAfterMs);
        monitor.record(provider, state, cooldownMs);
      }
      if (hasNextProvider && canFallbackForResponseStatus(response.status)) break;
      return { kind: "failure", provider, state, failures, response };
    }
  }

  const lastFailure = failures.at(-1);
  if (lastFailure) {
    return {
      kind: "failure",
      provider: lastFailure.provider,
      state: lastFailure.state,
      failures,
    };
  }
  return null;
}

export async function probeAIProvider(
  provider: AIProviderConfig,
  fetcher: typeof fetch = fetch,
): Promise<ProviderAvailabilityState> {
  try {
    // No user claim or source material is sent by the availability check.
    const response = await fetcher(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(4_000),
      body: JSON.stringify({
        model: "gpt-5.4-mini",
        max_completion_tokens: 8,
        messages: [{ role: "user", content: "Reply OK." }],
      }),
    });
    if (!response.ok) return classifyProviderResponse(response.status);
    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    return payload.choices?.[0]?.message?.content?.trim() === "OK"
      ? "available"
      : "unavailable";
  } catch (error) {
    return classifyProviderException(error);
  }
}

export function createProviderAvailabilityMonitor(
  probe: (provider: AIProviderConfig) => Promise<ProviderAvailabilityState> = probeAIProvider,
  now: () => number = Date.now,
) : ProviderAvailabilityMonitor {
  const cache = new Map<
    string,
    { provider: AIProviderConfig; value: ProviderAvailability; at: number; maxAgeMs: number }
  >();
  const pending = new Map<
    string,
    { provider: AIProviderConfig; promise: Promise<ProviderAvailability> }
  >();
  const cacheKey = (provider: AIProviderConfig) =>
    `${provider.connection}\u0000${provider.baseUrl}`;
  const same = (a: AIProviderConfig, b: AIProviderConfig) =>
    a.connection === b.connection && a.baseUrl === b.baseUrl && a.apiKey === b.apiKey;
  const value = (state: ProviderAvailabilityState): ProviderAvailability =>
    ({ state, checkedAt: new Date(now()).toISOString() });
  return {
    async get(provider: AIProviderConfig | null): Promise<ProviderAvailability> {
      if (!provider) return value("unconfigured");
      const key = cacheKey(provider);
      const cached = cache.get(key);
      if (
        cached &&
        same(cached.provider, provider) &&
        now() - cached.at < cached.maxAgeMs
      ) {
        return cached.value;
      }
      const existingPending = pending.get(key);
      if (existingPending && same(existingPending.provider, provider)) {
        return existingPending.promise;
      }
      let promise: Promise<ProviderAvailability>;
      promise = probe(provider).then((state) => {
        const result = value(state);
        if (pending.get(key)?.promise === promise) {
          cache.set(key, {
            provider,
            value: result,
            at: now(),
            maxAgeMs: retryTtlForState(state),
          });
        }
        return result;
      }).catch(() => {
        const result = value("unavailable");
        if (pending.get(key)?.promise === promise) {
          cache.set(key, {
            provider,
            value: result,
            at: now(),
            maxAgeMs: PROVIDER_AVAILABILITY_TTL_MS,
          });
        }
        return result;
      }).finally(() => {
        if (pending.get(key)?.promise === promise) pending.delete(key);
      });
      pending.set(key, { provider, promise });
      return promise;
    },
    peek(provider: AIProviderConfig, maxAgeMs?: number) {
      const cached = cache.get(cacheKey(provider));
      if (
        !cached ||
        !same(cached.provider, provider) ||
        now() - cached.at >= (maxAgeMs ?? cached.maxAgeMs)
      ) {
        return null;
      }
      return cached.value;
    },
    record(provider: AIProviderConfig, state: ProviderAvailabilityState, maxAgeMs?: number) {
      const key = cacheKey(provider);
      pending.delete(key); // A later probe must not overwrite a newer real analysis outcome.
      cache.set(key, {
        provider,
        value: value(state),
        at: now(),
        maxAgeMs: maxAgeMs ?? retryTtlForState(state),
      });
    },
  };
}

export const sharedAIProviderAvailabilityMonitor =
  createProviderAvailabilityMonitor();

export function resolveAIProviderConfigs(
  env: Record<string, string | undefined>,
): AIProviderConfig[] {
  const providers: AIProviderConfig[] = [];
  const directKey = env.OPENAI_API_KEY?.trim();
  if (directKey) {
    providers.push({
      apiKey: directKey,
      baseUrl: "https://api.openai.com/v1",
      connection: "direct_openai",
    });
  }

  const managedKey = env.AI_INTEGRATIONS_OPENAI_API_KEY?.trim();
  const managedBaseUrl = env.AI_INTEGRATIONS_OPENAI_BASE_URL?.trim();

  if (managedKey && managedBaseUrl) {
    providers.push({
      apiKey: managedKey,
      baseUrl: managedBaseUrl.replace(/\/+$/, ""),
      connection: "replit_managed_openai",
    });
  }

  return providers;
}

export function resolveAIProviderConfig(
  env: Record<string, string | undefined>,
): AIProviderConfig | null {
  return resolveAIProviderConfigs(env)[0] ?? null;
}