import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyProviderException, classifyProviderResponse, createProviderAvailabilityMonitor,
  probeAIProvider, requestWithProviderFallback, resolveAIProviderConfig,
  resolveAIProviderConfigs, shouldFallbackForAvailability,
} from "../src/lib/ai-provider.ts";

test("direct OpenAI is selected when both providers are configured", () => {
  const provider = resolveAIProviderConfig({
    AI_INTEGRATIONS_OPENAI_API_KEY: "managed-key",
    AI_INTEGRATIONS_OPENAI_BASE_URL: "https://managed.example/v1/",
    OPENAI_API_KEY: "direct-key",
  });

  assert.deepEqual(provider, {
    apiKey: "direct-key",
    baseUrl: "https://api.openai.com/v1",
    connection: "direct_openai",
  });
});

test("direct OpenAI stays first while managed OpenAI is retained as fallback", () => {
  const providers = resolveAIProviderConfigs({
    AI_INTEGRATIONS_OPENAI_API_KEY: "managed-key",
    AI_INTEGRATIONS_OPENAI_BASE_URL: "https://managed.example/v1/",
    OPENAI_API_KEY: "direct-key",
  });

  assert.deepEqual(providers.map((provider) => provider.connection), [
    "direct_openai",
    "replit_managed_openai",
  ]);
});

test("direct OpenAI is used when the managed provider is incomplete", () => {
  const provider = resolveAIProviderConfig({
    AI_INTEGRATIONS_OPENAI_API_KEY: "managed-key",
    OPENAI_API_KEY: "direct-key",
  });

  assert.deepEqual(provider, {
    apiKey: "direct-key",
    baseUrl: "https://api.openai.com/v1",
    connection: "direct_openai",
  });
});

test("direct authentication failure falls back to the managed provider", async () => {
  const providers = resolveAIProviderConfigs({
    AI_INTEGRATIONS_OPENAI_API_KEY: "managed-key",
    AI_INTEGRATIONS_OPENAI_BASE_URL: "https://managed.example/v1",
    OPENAI_API_KEY: "direct-key",
  });
  const attempts: string[] = [];
  const monitor = createProviderAvailabilityMonitor(async () => "available");
  const result = await requestWithProviderFallback(providers, async (provider) => {
    attempts.push(provider.connection);
    return new Response(null, {
      status: provider.connection === "direct_openai" ? 401 : 200,
    });
  }, monitor);

  assert.deepEqual(attempts, ["direct_openai", "replit_managed_openai"]);
  assert.equal(result?.kind, "success");
  if (result?.kind === "success") {
    assert.equal(result.provider.connection, "replit_managed_openai");
    assert.equal(result.failures[0]?.state, "auth_failed");
  }
});

test("a request-rejected response does not trigger managed fallback", async () => {
  const providers = resolveAIProviderConfigs({
    AI_INTEGRATIONS_OPENAI_API_KEY: "managed-key",
    AI_INTEGRATIONS_OPENAI_BASE_URL: "https://managed.example/v1",
    OPENAI_API_KEY: "direct-key",
  });
  let attempts = 0;
  const monitor = createProviderAvailabilityMonitor(async () => "available");
  const result = await requestWithProviderFallback(providers, async () => {
    attempts++;
    return new Response(null, { status: 400 });
  }, monitor);

  assert.equal(attempts, 1);
  assert.equal(result?.kind, "failure");
});

test("a cached managed authentication failure is skipped until it expires", async () => {
  const providers = resolveAIProviderConfigs({
    AI_INTEGRATIONS_OPENAI_API_KEY: "managed-key",
    AI_INTEGRATIONS_OPENAI_BASE_URL: "https://managed.example/v1",
    OPENAI_API_KEY: "direct-key",
  });
  const managed = providers.find((provider) => provider.connection === "replit_managed_openai")!;
  const direct = providers.find((provider) => provider.connection === "direct_openai")!;
  let time = 1_000;
  const monitor = createProviderAvailabilityMonitor(
    async () => "available",
    () => time,
  );
  monitor.record(managed, "auth_failed");

  const firstAttempts: string[] = [];
  const first = await requestWithProviderFallback(
    providers,
    async (provider) => {
      firstAttempts.push(provider.connection);
      return new Response(null, { status: 200 });
    },
    monitor,
  );
  assert.deepEqual(firstAttempts, ["direct_openai"]);
  assert.equal(first?.kind, "success");
  assert.equal(monitor.peek(managed, 5 * 60_000)?.state, "auth_failed");
  assert.equal(monitor.peek(direct)?.state, "available");
  assert.equal(JSON.stringify(monitor.peek(managed, 5 * 60_000)).includes("managed-key"), false);

  time += 5 * 60_000 + 1;
  const secondAttempts: string[] = [];
  const second = await requestWithProviderFallback(
    providers,
    async (provider) => {
      secondAttempts.push(provider.connection);
      return new Response(null, {
        status: provider.connection === "direct_openai" ? 401 : 200,
      });
    },
    monitor,
  );
  assert.deepEqual(secondAttempts, ["direct_openai", "replit_managed_openai"]);
  assert.equal(second?.kind, "success");
  if (second?.kind === "success") {
    assert.equal(second.provider.connection, "replit_managed_openai");
  }
  assert.equal(monitor.peek(direct, 5 * 60_000)?.state, "auth_failed");
});

test("a cached managed failure is not retried when direct also fails", async () => {
  const providers = resolveAIProviderConfigs({
    AI_INTEGRATIONS_OPENAI_API_KEY: "managed-key",
    AI_INTEGRATIONS_OPENAI_BASE_URL: "https://managed.example/v1",
    OPENAI_API_KEY: "direct-key",
  });
  const managed = providers.find((provider) => provider.connection === "replit_managed_openai")!;
  const monitor = createProviderAvailabilityMonitor(async () => "available");
  monitor.record(managed, "auth_failed");
  const attempts: string[] = [];
  const result = await requestWithProviderFallback(
    providers,
    async (provider) => {
      attempts.push(provider.connection);
      return new Response(null, {
        status: provider.connection === "direct_openai" ? 503 : 200,
      });
    },
    monitor,
    { sleep: async () => {} },
  );

  assert.deepEqual(attempts, ["direct_openai", "direct_openai", "direct_openai"]);
  assert.equal(result?.kind, "failure");
  if (result?.kind === "failure") {
    assert.equal(result.provider.connection, "direct_openai");
    assert.equal(result.failures.length, 3);
  }
});

test("transient rate limits honor Retry-After before retrying the same provider", async () => {
  const provider = resolveAIProviderConfigs({ OPENAI_API_KEY: "direct-key" })[0]!;
  const delays: number[] = [];
  let attempts = 0;
  const monitor = createProviderAvailabilityMonitor(async () => "available");
  const result = await requestWithProviderFallback(
    [provider],
    async () => {
      attempts++;
      return attempts === 1
        ? new Response(JSON.stringify({
            error: { type: "rate_limit_error", code: "rate_limit_exceeded" },
          }), { status: 429, headers: { "Retry-After": "2" } })
        : new Response(null, { status: 200 });
    },
    monitor,
    { sleep: async (delayMs) => { delays.push(delayMs); } },
  );

  assert.equal(result?.kind, "success");
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [2_000]);
});

test("transient server errors use bounded exponential backoff", async () => {
  const provider = resolveAIProviderConfigs({ OPENAI_API_KEY: "direct-key" })[0]!;
  const delays: number[] = [];
  let attempts = 0;
  const result = await requestWithProviderFallback(
    [provider],
    async () => {
      attempts++;
      return attempts < 3
        ? new Response(null, { status: 503 })
        : new Response(null, { status: 200 });
    },
    createProviderAvailabilityMonitor(async () => "available"),
    {
      retryBaseDelayMs: 100,
      maxBackoffMs: 150,
      sleep: async (delayMs) => { delays.push(delayMs); },
    },
  );

  assert.equal(result?.kind, "success");
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [100, 150]);
});

test("credit-balance exhaustion is not retried and is circuit-broken", async () => {
  const provider = resolveAIProviderConfigs({ OPENAI_API_KEY: "direct-key" })[0]!;
  const monitor = createProviderAvailabilityMonitor(async () => "available");
  let attempts = 0;
  const request = async () => {
    attempts++;
    return new Response(JSON.stringify({
      error: {
        type: "insufficient_quota",
        code: "credit_balance_exhausted",
        message: "Account credit balance exhausted.",
      },
    }), { status: 429 });
  };

  const first = await requestWithProviderFallback(
    [provider],
    request,
    monitor,
    { sleep: async () => {} },
  );
  const second = await requestWithProviderFallback(
    [provider],
    async () => {
      attempts++;
      return new Response(null, { status: 200 });
    },
    monitor,
  );

  assert.equal(first?.kind, "failure");
  assert.equal(second?.kind, "failure");
  assert.equal(attempts, 1);
  assert.equal(monitor.peek(provider, 5 * 60_000)?.state, "rate_limited");
});

test("HTTP-date Retry-After is parsed and long waits are not retried early", async () => {
  const provider = resolveAIProviderConfigs({ OPENAI_API_KEY: "direct-key" })[0]!;
  const now = Date.parse("2026-09-27T12:00:00.000Z");
  const delays: number[] = [];
  let attempts = 0;
  const result = await requestWithProviderFallback(
    [provider],
    async () => {
      attempts++;
      return attempts === 1
        ? new Response(null, {
            status: 429,
            headers: { "Retry-After": new Date(now + 3_000).toUTCString() },
          })
        : new Response(null, { status: 200 });
    },
    createProviderAvailabilityMonitor(async () => "available", () => now),
    { now: () => now, sleep: async (delayMs) => { delays.push(delayMs); } },
  );

  assert.equal(result?.kind, "success");
  assert.deepEqual(delays, [3_000]);

  attempts = 0;
  const capped = await requestWithProviderFallback(
    [provider],
    async () => {
      attempts++;
      return new Response(null, { status: 429, headers: { "Retry-After": "60" } });
    },
    createProviderAvailabilityMonitor(async () => "available", () => now),
    { now: () => now, sleep: async (delayMs) => { delays.push(delayMs); } },
  );
  assert.equal(capped?.kind, "failure");
  assert.equal(attempts, 1);
});

test("a cached managed failure is not probed again when no direct provider exists", async () => {
  const managed = resolveAIProviderConfigs({
    AI_INTEGRATIONS_OPENAI_API_KEY: "managed-key",
    AI_INTEGRATIONS_OPENAI_BASE_URL: "https://managed.example/v1",
  })[0]!;
  const monitor = createProviderAvailabilityMonitor(async () => "available");
  monitor.record(managed, "auth_failed");
  let attempts = 0;

  const result = await requestWithProviderFallback(
    [managed],
    async () => {
      attempts++;
      return new Response(null, { status: 200 });
    },
    monitor,
  );

  assert.equal(attempts, 0);
  assert.equal(result?.kind, "failure");
  if (result?.kind === "failure") {
    assert.equal(result.provider.connection, "replit_managed_openai");
    assert.equal(result.state, "auth_failed");
    assert.deepEqual(result.failures, []);
  }
});

test("availability failures allow fallback but unconfigured does not", () => {
  assert.equal(shouldFallbackForAvailability("auth_failed"), true);
  assert.equal(shouldFallbackForAvailability("rate_limited"), true);
  assert.equal(shouldFallbackForAvailability("timeout"), true);
  assert.equal(shouldFallbackForAvailability("unavailable"), true);
  assert.equal(shouldFallbackForAvailability("unconfigured"), false);
  assert.equal(shouldFallbackForAvailability("available"), false);
});

test("provider remains unavailable when no complete credentials exist", () => {
  assert.equal(resolveAIProviderConfig({ AI_INTEGRATIONS_OPENAI_BASE_URL: "https://managed.example/v1" }), null);
  assert.equal(resolveAIProviderConfig({}), null);
});

test("provider errors distinguish credentials, throttling, and timeouts", () => {
  assert.equal(classifyProviderResponse(401), "auth_failed");
  assert.equal(classifyProviderResponse(403), "auth_failed");
  assert.equal(classifyProviderResponse(429), "rate_limited");
  assert.equal(classifyProviderResponse(504), "timeout");
  assert.equal(classifyProviderResponse(503), "unavailable");
  assert.equal(classifyProviderException(new DOMException("timed out", "TimeoutError")), "timeout");
  assert.equal(classifyProviderException(new Error("connection failed")), "unavailable");
});

test("availability probe sends no user claim and safely classifies provider responses", async () => {
  const provider = resolveAIProviderConfig({ OPENAI_API_KEY: "private-test-key" })!;
  let requests = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    requests++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "gpt-5.4-mini");
    assert.deepEqual(body.messages, [{ role: "user", content: "Reply OK." }]);
    assert.equal(JSON.stringify(body).includes("private-test-key"), false);
    return requests === 1
      ? new Response(JSON.stringify({ choices: [{ message: { content: " OK " } }] }), { status: 200 })
      : new Response("", { status: 429 });
  };
  assert.equal(await probeAIProvider(provider, fetcher), "available");
  assert.equal(await probeAIProvider(provider, fetcher), "rate_limited");
  assert.equal(requests, 2);
});

test("availability cache deduplicates probes and a real failure overrides an older probe", async () => {
  const provider = resolveAIProviderConfig({ OPENAI_API_KEY: "private-test-key" })!;
  let time = 1_000;
  let resolveProbe!: (state: "available") => void;
  let probes = 0;
  const monitor = createProviderAvailabilityMonitor(() => {
    probes++;
    return new Promise((resolve) => { resolveProbe = resolve; });
  }, () => time);
  assert.equal((await monitor.get(null)).state, "unconfigured");
  const first = monitor.get(provider);
  const second = monitor.get(provider);
  assert.equal(probes, 1);
  monitor.record(provider, "rate_limited");
  resolveProbe("available");
  await Promise.all([first, second]);
  const result = await monitor.get(provider);
  assert.equal(result.state, "rate_limited");
  assert.equal(JSON.stringify(result).includes("private-test-key"), false);
  time += 20_001;
  const third = monitor.get(provider);
  assert.equal(probes, 2);
  resolveProbe("available");
  assert.equal((await third).state, "available");
});