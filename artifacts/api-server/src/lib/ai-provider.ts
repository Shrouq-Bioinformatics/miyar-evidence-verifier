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

export async function requestWithProviderFallback(
  providers: AIProviderConfig[],
  request: (provider: AIProviderConfig) => Promise<Response>,
): Promise<ProviderRequestResult | null> {
  const failures: ProviderAttemptFailure[] = [];

  for (let index = 0; index < providers.length; index++) {
    const provider = providers[index];
    const nextProvider = providers[index + 1];
    const canTryDirectFallback =
      provider.connection === "replit_managed_openai" &&
      nextProvider?.connection === "direct_openai";

    let response: Response;
    try {
      response = await request(provider);
    } catch (error) {
      const state = classifyProviderException(error);
      failures.push({ provider, state });
      if (canTryDirectFallback && shouldFallbackForAvailability(state)) continue;
      return { kind: "failure", provider, state, failures };
    }

    if (response.ok) {
      return { kind: "success", provider, response, failures };
    }

    const state = classifyProviderResponse(response.status);
    failures.push({ provider, state });
    if (canTryDirectFallback && canFallbackForResponseStatus(response.status)) continue;
    return { kind: "failure", provider, state, failures };
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
) {
  const ttlMs = 20_000;
  let cache: { provider: AIProviderConfig; value: ProviderAvailability; at: number } | null = null;
  let pending: { provider: AIProviderConfig; promise: Promise<ProviderAvailability> } | null = null;
  const same = (a: AIProviderConfig, b: AIProviderConfig) =>
    a.connection === b.connection && a.baseUrl === b.baseUrl && a.apiKey === b.apiKey;
  const value = (state: ProviderAvailabilityState): ProviderAvailability =>
    ({ state, checkedAt: new Date(now()).toISOString() });
  return {
    async get(provider: AIProviderConfig | null): Promise<ProviderAvailability> {
      if (!provider) return value("unconfigured");
      if (cache && same(cache.provider, provider) && now() - cache.at < ttlMs) return cache.value;
      if (pending && same(pending.provider, provider)) return pending.promise;
      const promise = probe(provider).then((state) => {
        const result = value(state);
        if (pending?.promise === promise) cache = { provider, value: result, at: now() };
        return result;
      }).catch(() => value("unavailable")).finally(() => {
        if (pending?.promise === promise) pending = null;
      });
      pending = { provider, promise };
      return promise;
    },
    record(provider: AIProviderConfig, state: ProviderAvailabilityState) {
      pending = null; // A later probe must not overwrite a newer real analysis outcome.
      cache = { provider, value: value(state), at: now() };
    },
  };
}

export function resolveAIProviderConfigs(
  env: Record<string, string | undefined>,
): AIProviderConfig[] {
  const managedKey = env.AI_INTEGRATIONS_OPENAI_API_KEY?.trim();
  const managedBaseUrl = env.AI_INTEGRATIONS_OPENAI_BASE_URL?.trim();
  const providers: AIProviderConfig[] = [];

  if (managedKey && managedBaseUrl) {
    providers.push({
      apiKey: managedKey,
      baseUrl: managedBaseUrl.replace(/\/+$/, ""),
      connection: "replit_managed_openai",
    });
  }

  const directKey = env.OPENAI_API_KEY?.trim();
  if (directKey) {
    providers.push({
      apiKey: directKey,
      baseUrl: "https://api.openai.com/v1",
      connection: "direct_openai",
    });
  }

  return providers;
}

export function resolveAIProviderConfig(
  env: Record<string, string | undefined>,
): AIProviderConfig | null {
  return resolveAIProviderConfigs(env)[0] ?? null;
}