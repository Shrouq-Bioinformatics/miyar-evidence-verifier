import assert from "node:assert/strict";
import { test } from "node:test";
import type { AIProviderConfig } from "../src/lib/ai-provider.ts";
import { APPROVED_EXTERNAL_DOMAINS } from "../src/lib/authoritative-web-retrieval.ts";
import { retrieveLocalQuranAndTafsir } from "../src/lib/quranenc-tafsir.ts";
import {
  classifySourceTopic,
  retrieveEvidenceWithSourceRouting,
  routeSourceCategories,
  SOURCE_ROUTING_CATEGORIES,
  type SourceClassification,
  type SourceRoutingCategory,
} from "../src/lib/source-routing.ts";

const directProvider: AIProviderConfig = {
  apiKey: "test-key",
  baseUrl: "https://api.openai.com/v1",
  connection: "direct_openai",
};

function responsesOutput(value: unknown, status = 200): Response {
  return new Response(JSON.stringify({
    output: [{
      type: "message",
      content: [{
        type: "output_text",
        text: JSON.stringify(value),
      }],
    }],
  }), { status, headers: { "Content-Type": "application/json" } });
}

function classification(
  categories: SourceRoutingCategory[],
  confidence = 0.84,
  fallbackUsed = false,
): SourceClassification {
  return { categories, confidence, fallbackUsed };
}

test("source classifier uses direct OpenAI with storage disabled and returns categories only", async () => {
  let requestBody: Record<string, unknown> | undefined;
  let authorization = "";
  const result = await classifySourceTopic(
    "ما حكم التأمين التجاري؟",
    directProvider,
    async (input, init) => {
      assert.equal(String(input), "https://api.openai.com/v1/responses");
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return responsesOutput({
        categories: ["fiqh", "contemporary_fiqh"],
        confidence: 0.84,
      });
    },
  );

  assert.equal(authorization, "Bearer test-key");
  assert.equal(requestBody?.store, false);
  assert.equal(requestBody?.model, "gpt-5.4-mini");
  assert.equal(requestBody?.tool_choice, undefined);
  assert.deepEqual(result, {
    categories: ["fiqh", "contemporary_fiqh"],
    confidence: 0.84,
    fallbackUsed: false,
  });
});

test("invalid categories fall back to uncertain and cannot introduce a domain", async () => {
  const result = await classifySourceTopic(
    "claim",
    directProvider,
    async () => responsesOutput({
      categories: ["fiqh", "evil.example"],
      confidence: 0.91,
      reasoning: "must not be surfaced",
    }),
  );
  const route = routeSourceCategories(result);

  assert.deepEqual(result, {
    categories: ["uncertain"],
    confidence: 0.91,
    fallbackUsed: true,
  });
  assert.deepEqual(route.selectedDomains, [...APPROVED_EXTERNAL_DOMAINS]);
  assert.ok(route.selectedDomains.every((domain) =>
    (APPROVED_EXTERNAL_DOMAINS as readonly string[]).includes(domain),
  ));
});

test("low classifier confidence selects the broad approved-domain fallback", async () => {
  const result = await classifySourceTopic(
    "claim",
    directProvider,
    async () => responsesOutput({
      categories: ["aqidah"],
      confidence: 0.64,
    }),
  );

  assert.deepEqual(result, {
    categories: ["uncertain"],
    confidence: 0.64,
    fallbackUsed: true,
  });
  assert.deepEqual(
    routeSourceCategories(result).selectedDomains,
    [...APPROVED_EXTERNAL_DOMAINS],
  );
});

test("a specific category is not broadened by an additional general_islamic label", async () => {
  const result = await classifySourceTopic(
    "ما الفرق بين القضاء والقدر؟",
    directProvider,
    async () => responsesOutput({
      categories: ["aqidah", "general_islamic"],
      confidence: 0.96,
    }),
  );

  assert.deepEqual(result, {
    categories: ["aqidah"],
    confidence: 0.96,
    fallbackUsed: false,
  });
  assert.deepEqual(
    routeSourceCategories(result).selectedDomains,
    ["dorar.net", "binbaz.org.sa", "binothaimeen.net"],
  );
});

test("classifier HTTP and network failures fall back without throwing", async () => {
  const httpFailure = await classifySourceTopic(
    "claim",
    directProvider,
    async () => new Response("unavailable", { status: 503 }),
  );
  const networkFailure = await classifySourceTopic(
    "claim",
    directProvider,
    async () => {
      throw new Error("network failure");
    },
  );

  assert.deepEqual(httpFailure, {
    categories: ["uncertain"],
    confidence: null,
    fallbackUsed: true,
  });
  assert.deepEqual(networkFailure, httpFailure);
});

test("only direct OpenAI providers are eligible for classification", async () => {
  const result = await classifySourceTopic("claim", {
    ...directProvider,
    connection: "replit_managed_openai",
  }, async () => {
    throw new Error("must not call managed provider");
  });

  assert.deepEqual(result, {
    categories: ["uncertain"],
    confidence: null,
    fallbackUsed: true,
  });
});

test("category-to-domain map is bounded, scoped, merged, and deduplicated", () => {
  const expected: Array<[SourceRoutingCategory[], string[]]> = [
    [["quran"], []],
    [["tafsir"], []],
    [["hadith"], ["dorar.net"]],
    [["fiqh"], ["binbaz.org.sa", "alifta.gov.sa", "binothaimeen.net"]],
    [["contemporary_fiqh"], [
      "binbaz.org.sa",
      "alifta.gov.sa",
      "binothaimeen.net",
      "iifa-aifi.org",
    ]],
    [["aqidah"], ["dorar.net", "binbaz.org.sa", "binothaimeen.net"]],
    [["family_social"], ["binbaz.org.sa", "alifta.gov.sa", "binothaimeen.net"]],
    [["family_social", "contemporary_fiqh"], [
      "binbaz.org.sa",
      "alifta.gov.sa",
      "binothaimeen.net",
      "iifa-aifi.org",
    ]],
    [["general_islamic"], [...APPROVED_EXTERNAL_DOMAINS]],
    [["uncertain"], [...APPROVED_EXTERNAL_DOMAINS]],
  ];

  for (const [categories, domains] of expected) {
    assert.deepEqual(
      routeSourceCategories(classification(categories)).selectedDomains,
      domains,
      categories.join(","),
    );
  }

  assert.deepEqual(
    routeSourceCategories(classification(["hadith", "aqidah"]))
      .selectedDomains,
    ["dorar.net", "binbaz.org.sa", "binothaimeen.net"],
  );
  assert.deepEqual(SOURCE_ROUTING_CATEGORIES, [
    "quran",
    "tafsir",
    "hadith",
    "fiqh",
    "contemporary_fiqh",
    "aqidah",
    "family_social",
    "general_islamic",
    "uncertain",
  ]);
});

test("malformed runtime categories fail closed to the approved broad route", () => {
  const route = routeSourceCategories({
    categories: ["evil.example"] as SourceRoutingCategory[],
    confidence: 0.9,
    fallbackUsed: false,
  });

  assert.deepEqual(route.categories, ["uncertain"]);
  assert.deepEqual(route.selectedDomains, [...APPROVED_EXTERNAL_DOMAINS]);
  assert.equal(route.fallbackUsed, true);
});

test("local Quran retrieval runs first and survives a different predicted category", async () => {
  const callOrder: string[] = [];
  const claim = "وهو الذي جعل لكم النجوم لتهتدوا بها";
  const result = await retrieveEvidenceWithSourceRouting({
    claim,
    context: "",
    language: "العربية",
    provider: directProvider,
  }, {
    localRetriever: async (localClaim) => {
      callOrder.push("local");
      return retrieveLocalQuranAndTafsir(localClaim, {
        fetcher: async () => new Response("unavailable", { status: 503 }),
      });
    },
    classifier: async () => {
      callOrder.push("classifier");
      return classification(["aqidah"], 0.91);
    },
    externalRetriever: async (input) => {
      callOrder.push("external");
      assert.deepEqual(input.allowedDomains, [
        "dorar.net",
        "binbaz.org.sa",
        "binothaimeen.net",
      ]);
      return { status: "no_results", evidence: [] };
    },
  });

  assert.deepEqual(callOrder, ["local", "classifier", "external"]);
  assert.ok(result.retrievedEvidence.some((item) =>
    item.id === "quran-6-97" && item.sourceType === "quran",
  ));
});

test("Arabic retrieval query is used for search while the original claim is classified", async () => {
  const claim = "The hadith Actions are judged by intentions is authentic.";
  const retrievalQuery = "هل حديث إنما الأعمال بالنيات صحيح؟";
  let localQuery = "";
  let classifierClaim = "";
  let externalInput: any = null;

  await retrieveEvidenceWithSourceRouting({
    claim,
    retrievalQuery,
    context: "academic",
    language: "English",
    provider: directProvider,
  }, {
    localRetriever: async (query) => {
      localQuery = query;
      return {
        localEvidence: [],
        tafsir: { status: "no_results", evidence: [] },
      } as any;
    },
    classifier: async (originalClaim) => {
      classifierClaim = originalClaim;
      return classification(["hadith"], 0.9);
    },
    externalRetriever: async (input) => {
      externalInput = input;
      return { status: "no_results", evidence: [] };
    },
  });

  assert.equal(localQuery, retrievalQuery);
  assert.equal(classifierClaim, claim);
  assert.equal(externalInput.claim, claim);
  assert.equal(externalInput.retrievalQuery, retrievalQuery);
  assert.equal(externalInput.language, "English");
});

test("classifier failure does not fail retrieval and selects all approved domains", async () => {
  const callOrder: string[] = [];
  const claim = "وهو الذي جعل لكم النجوم لتهتدوا بها";
  const result = await retrieveEvidenceWithSourceRouting({
    claim,
    context: "",
    language: "العربية",
    provider: directProvider,
  }, {
    localRetriever: async (localClaim) => {
      callOrder.push("local");
      return retrieveLocalQuranAndTafsir(localClaim, {
        fetcher: async () => new Response("unavailable", { status: 503 }),
      });
    },
    classifier: async () => {
      callOrder.push("classifier");
      throw new Error("simulated classifier failure");
    },
    externalRetriever: async (input) => {
      callOrder.push("external");
      assert.deepEqual(input.allowedDomains, [...APPROVED_EXTERNAL_DOMAINS]);
      return { status: "unavailable", evidence: [], reason: "request_failed" };
    },
  });

  assert.deepEqual(callOrder, ["local", "classifier", "external"]);
  assert.deepEqual(result.routing.categories, ["uncertain"]);
  assert.equal(result.routing.fallbackUsed, true);
  assert.deepEqual(result.routing.selectedDomains, [...APPROVED_EXTERNAL_DOMAINS]);
  assert.ok(result.retrievedEvidence.some((item) =>
    item.id === "quran-6-97" && item.sourceType === "quran",
  ));
});