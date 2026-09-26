import assert from "node:assert/strict";
import test from "node:test";
import type { AIProviderConfig } from "../src/lib/ai-provider.ts";
import {
  ArabicRetrievalQueryError,
  detectClaimLanguage,
  generateArabicRetrievalQuery,
} from "../src/lib/multilingual-claim.ts";

const managedProvider: AIProviderConfig = {
  apiKey: "test-managed",
  baseUrl: "https://ai.integrations.replit.com/v1",
  connection: "replit_managed_openai",
};
const directProvider: AIProviderConfig = {
  apiKey: "test-direct",
  baseUrl: "https://api.openai.com/v1",
  connection: "direct_openai",
};

test("detects Arabic, English, and French claims without changing the selected-language fallback", () => {
  assert.equal(
    detectClaimLanguage("هل حديث إنما الأعمال بالنيات صحيح؟", "English"),
    "العربية",
  );
  assert.equal(
    detectClaimLanguage("The hadith is authentic and reported by Bukhari.", "العربية"),
    "English",
  );
  assert.equal(
    detectClaimLanguage("The hadith إنما الأعمال بالنيات is authentic.", "العربية"),
    "English",
  );
  assert.equal(
    detectClaimLanguage("Les actes ne valent que par les intentions.", "العربية"),
    "Français",
  );
  assert.equal(
    detectClaimLanguage("Le hadith إنما الأعمال بالنيات est authentique.", "العربية"),
    "Français",
  );
  assert.equal(detectClaimLanguage("Ambiguous proper name", "Français"), "Français");
});

test("Arabic claims use their exact submitted text without calling a translation provider", async () => {
  const claim = "  هل حديث إنما الأعمال بالنيات صحيح؟  ";
  let calls = 0;
  const query = await generateArabicRetrievalQuery(
    claim,
    "العربية",
    [managedProvider],
    async () => {
      calls++;
      return Response.json({});
    },
  );

  assert.equal(query, claim);
  assert.equal(calls, 0);
});

test("English and French translations return only a bounded Arabic search query", async () => {
  const claim = "Les actes ne valent que par les intentions.";
  let capturedBody: any;
  const query = await generateArabicRetrievalQuery(
    claim,
    "Français",
    [managedProvider],
    async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return Response.json({
        choices: [{
          message: {
            content: JSON.stringify({ query: "حديث إنما الأعمال بالنيات" }),
          },
        }],
      });
    },
  );

  assert.equal(query, "حديث إنما الأعمال بالنيات");
  assert.equal(capturedBody.model, "gpt-5.4-mini");
  assert.equal(capturedBody.store, undefined);
  assert.match(capturedBody.messages[0].content, /not evidence/u);
  assert.deepEqual(JSON.parse(capturedBody.messages[1].content), {
    claim,
    sourceLanguage: "Français",
  });
});

test("malformed translation output is rejected without retrying another provider", async () => {
  let calls = 0;
  await assert.rejects(
    generateArabicRetrievalQuery(
      "The hadith is authentic.",
      "English",
      [managedProvider, directProvider],
      async () => {
        calls++;
        return Response.json({
          choices: [{ message: { content: "not JSON" } }],
        });
      },
    ),
    (error: unknown) => error instanceof ArabicRetrievalQueryError
      && error.reason === "invalid_query_json",
  );
  assert.equal(calls, 1);
});

test("translation output without Arabic script is rejected", async () => {
  await assert.rejects(
    generateArabicRetrievalQuery(
      "The hadith is authentic.",
      "English",
      [managedProvider],
      async () => Response.json({
        choices: [{
          message: { content: JSON.stringify({ query: "hadith authenticity" }) },
        }],
      }),
    ),
    (error: unknown) => error instanceof ArabicRetrievalQueryError
      && error.reason === "invalid_arabic_query",
  );
});