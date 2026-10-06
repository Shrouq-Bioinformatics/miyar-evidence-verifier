import assert from "node:assert/strict";
import { test } from "node:test";
import { createQuranEncTafsirProvider } from "../src/lib/quranenc-tafsir-provider";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("QuranEnc adapts to EvidenceProvider and returns the exact tafsir edition", async () => {
  let requestedUrl = "";
  const provider = createQuranEncTafsirProvider(async (input) => {
    requestedUrl = String(input);
    return jsonResponse({
      result: {
        sura: "16",
        aya: "90",
        translation: "إن الله يأمر بالعدل والإحسان.",
      },
    });
  });

  assert.equal(provider.id, "quranenc-arabic-mokhtasar-tafsir");
  assert.equal(provider.supports({ text: "تفسير 16:90", domain: "التفسير" }), true);
  assert.equal(provider.supports({ text: "16:90", domain: "القرآن" }), false);

  const result = await provider.retrieve({
    text: "تفسير سورة النحل آية 90",
    domain: "التفسير",
  });
  assert.equal(
    requestedUrl,
    "https://quranenc.com/api/v1/translation/aya/arabic_mokhtasar/16/90",
  );
  assert.equal(result.status, "available");
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0]?.sourceType, "tafsir");
  assert.equal(result.evidence[0]?.edition, "المختصر في تفسير القرآن الكريم");
  assert.equal(result.evidence[0]?.tafsirText, "إن الله يأمر بالعدل والإحسان.");
});

test("provider transport errors are isolated as unavailable results", async () => {
  const provider = createQuranEncTafsirProvider(async () => {
    throw new TypeError("network unavailable");
  });
  const result = await provider.retrieve({
    text: "تفسير سورة النحل آية 90",
    domain: "التفسير",
  });

  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.evidence, []);
  assert.equal(result.reason, "request_failed");
});
