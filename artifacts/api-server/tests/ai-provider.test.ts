import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyProviderException, classifyProviderResponse, createProviderAvailabilityMonitor,
  probeAIProvider, requestWithProviderFallback, resolveAIProviderConfig,
  resolveAIProviderConfigs, shouldFallbackForAvailability,
} from "../src/lib/ai-provider.ts";

test("managed OpenAI is selected only when both managed settings are present", () => {
  const provider = resolveAIProviderConfig({
    AI_INTEGRATIONS_OPENAI_API_KEY: "managed-key",
    AI_INTEGRATIONS_OPENAI_BASE_URL: "https://managed.example/v1/",
    OPENAI_API_KEY: "direct-key",
  });

  assert.deepEqual(provider, {
    apiKey: "managed-key",
    baseUrl: "https://managed.example/v1",
    connection: "replit_managed_openai",
  });
});

test("managed OpenAI stays first while a configured direct key is retained as fallback", () => {
  const providers = resolveAIProviderConfigs({
    AI_INTEGRATIONS_OPENAI_API_KEY: "managed-key",
    AI_INTEGRATIONS_OPENAI_BASE_URL: "https://managed.example/v1/",
    OPENAI_API_KEY: "direct-key",
  });

  assert.deepEqual(providers.map((provider) => provider.connection), [
    "replit_managed_openai",
    "direct_openai",
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

test("managed authentication failure retries with the direct provider", async () => {
  const providers = resolveAIProviderConfigs({
    AI_INTEGRATIONS_OPENAI_API_KEY: "managed-key",
    AI_INTEGRATIONS_OPENAI_BASE_URL: "https://managed.example/v1",
    OPENAI_API_KEY: "direct-key",
  });
  const attempts: string[] = [];
  const result = await requestWithProviderFallback(providers, async (provider) => {
    attempts.push(provider.connection);
    return new Response(null, {
      status: provider.connection === "replit_managed_openai" ? 401 : 200,
    });
  });

  assert.deepEqual(attempts, ["replit_managed_openai", "direct_openai"]);
  assert.equal(result?.kind, "success");
  if (result?.kind === "success") {
    assert.equal(result.provider.connection, "direct_openai");
    assert.equal(result.failures[0]?.state, "auth_failed");
  }
});

test("a request-rejected response does not trigger direct fallback", async () => {
  const providers = resolveAIProviderConfigs({
    AI_INTEGRATIONS_OPENAI_API_KEY: "managed-key",
    AI_INTEGRATIONS_OPENAI_BASE_URL: "https://managed.example/v1",
    OPENAI_API_KEY: "direct-key",
  });
  let attempts = 0;
  const result = await requestWithProviderFallback(providers, async () => {
    attempts++;
    return new Response(null, { status: 400 });
  });

  assert.equal(attempts, 1);
  assert.equal(result?.kind, "failure");
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