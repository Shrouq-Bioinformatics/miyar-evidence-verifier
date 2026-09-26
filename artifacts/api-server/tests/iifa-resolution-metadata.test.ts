import assert from "node:assert/strict";
import test from "node:test";
import {
  extractExternalWebEvidence,
  retrieveAuthoritativeWebEvidence,
} from "../src/lib/authoritative-web-retrieval.ts";
import { extractIifaResolutionMetadata } from "../src/lib/iifa-resolution-metadata.ts";

const IIFA_URL = "https://iifa-aifi.org/ar/1813.html";
const CLAIM = "ما حكم السندات المالية؟";
const CITATION_TEXT =
  "يشرح المصدر حكم السندات المالية وما يتصل باستثمارها. يلزم التحقق البشري.";
const FULL_RESOLUTION_SENTINEL = "FULL_RESOLUTION_BODY_MUST_NOT_BE_STORED";
const VERIFIED_PAGE_HTML = `
  <!doctype html>
  <html lang="ar">
    <head>
      <meta property="og:title" content="قرار بشأن السندات">
      <title>قرار بشأن السندات – مجمع الفقه الإسلامي الدولي</title>
    </head>
    <body>
      <main>
        <h1>قرار بشأن السندات</h1>
        <h5>قرار رقم: 60 (6/11)</h5>
        <p>إن مجلس المجمع المنعقد في دورة مؤتمره السادسة بجدة من 17-23 شعبان 1410هـ الموافق 14-20 آذار (مارس) 1990م، وبعد اطلاعه على الأوراق.</p>
        <a class="metaacdtag">المعاملات المالية</a>
        <a class="metaacdtag">السندات</a>
        <p>${FULL_RESOLUTION_SENTINEL} ونص القرار الكامل غير مطلوب تخزينه.</p>
      </main>
    </body>
  </html>`;

const directProvider = {
  apiKey: "test-key",
  baseUrl: "https://api.openai.com/v1",
  connection: "direct_openai" as const,
};

function responseWithCitation(
  url: string,
  title: string | null = "قرار بشأن السندات المالية",
) {
  return {
    output: [{
      type: "message",
      content: [{
        type: "output_text",
        text: CITATION_TEXT,
        annotations: [{
          type: "url_citation",
          url,
          start_index: 0,
          end_index: CITATION_TEXT.length,
          ...(title ? { title } : {}),
        }],
      }],
    }],
  };
}

function extractCitation(
  url: string,
  title?: string | null,
) {
  return extractExternalWebEvidence(responseWithCitation(url, title), CLAIM);
}

async function retrieveCitation(
  url: string,
  metadataFetcher: typeof fetch,
  title: string | null = "قرار بشأن السندات المالية",
) {
  return retrieveAuthoritativeWebEvidence({
    claim: CLAIM,
    context: "",
    language: "en",
    provider: directProvider,
    fetcher: async () => new Response(JSON.stringify(responseWithCitation(url, title)), {
      headers: { "content-type": "application/json" },
    }),
    metadataFetcher,
  });
}

test("IIFA root and encountered www subdomain are accepted as collective resolutions", () => {
  for (const url of [
    IIFA_URL,
    "https://www.iifa-aifi.org/ar/1813.html",
  ]) {
    const evidence = extractCitation(url);
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0]?.sourceType, "external_web");
    assert.equal(evidence[0]?.sourceSubtype, "collective_fiqh_resolution");
    assert.equal(evidence[0]?.sourceName, "مجمع الفقه الإسلامي الدولي");
    assert.equal(evidence[0]?.sourceProvider, "International Islamic Fiqh Academy");
  }
});

test("an IIFA citation without an annotation title requires verified page metadata", async () => {
  assert.deepEqual(extractCitation(IIFA_URL, null), []);

  const result = await retrieveCitation(
    IIFA_URL,
    async () => new Response("unavailable", { status: 503 }),
    null,
  );
  assert.equal(result.status, "no_results");
  assert.deepEqual(result.evidence, []);
});

test("IIFA lookalikes and non-HTTPS citations are rejected", () => {
  for (const url of [
    "https://iifa-aifi.org.evil.example/ar/1813.html",
    "https://fake-iifa-aifi.org/ar/1813.html",
    "http://iifa-aifi.org/ar/1813.html",
  ]) {
    assert.deepEqual(extractCitation(url), []);
  }
});

test("official-page metadata parser extracts only bounded fields present on the page", () => {
  const metadata = extractIifaResolutionMetadata(VERIFIED_PAGE_HTML);
  assert.equal(metadata.pageTitle, "قرار بشأن السندات");
  assert.equal(metadata.resolutionNumber, "60 (6/11)");
  assert.match(metadata.sessionDate ?? "", /دورة مؤتمره السادسة بجدة/);
  assert.match(metadata.sessionDate ?? "", /17-23 شعبان 1410هـ/);
  assert.equal(metadata.topic, "المعاملات المالية، السندات");
  assert.equal(JSON.stringify(metadata).includes(FULL_RESOLUTION_SENTINEL), false);
});

test("metadata fields are omitted rather than invented when the page lacks them", () => {
  assert.deepEqual(
    extractIifaResolutionMetadata(
      "<html><head><title>صفحة رسمية مختصرة</title></head><body><p>نص عام دون رقم أو دورة أو تصنيف.</p></body></html>",
    ),
    { pageTitle: "صفحة رسمية مختصرة" },
  );
});

test("English official pages expose their own resolution number, session date, and title topic", () => {
  const englishPage = `
    <html>
      <head>
        <meta property="og:title" content="Resolution No. 258 (3/26) Artificial Intelligence: Its Rulings, Guidelines, and Ethics">
      </head>
      <body>
        <p>Resolution No. 258 (3/26) Artificial Intelligence: Its Rulings, Guidelines, and Ethics</p>
        <p>The Council of the International Islamic Fiqh Academy, holding its twenty-sixth session in Doha, State of Qatar, Dhūl-Qi’dah 1446H (4–8 May 2025),</p>
      </body>
    </html>`;
  const metadata = extractIifaResolutionMetadata(englishPage);
  assert.equal(metadata.resolutionNumber, "258 (3/26)");
  assert.match(metadata.sessionDate ?? "", /twenty-sixth session in Doha/);
  assert.match(metadata.sessionDate ?? "", /4–8 May 2025/);
  assert.equal(metadata.topic, "Artificial Intelligence");
});

test("a verified official title and resolution metadata enrich a citation with no annotation title", async () => {
  const fetchedUrls: string[] = [];
  const result = await retrieveCitation(IIFA_URL, async (input) => {
    fetchedUrls.push(String(input));
    return new Response(VERIFIED_PAGE_HTML, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }, null);

  assert.equal(result.status, "available");
  assert.deepEqual(fetchedUrls, [IIFA_URL]);
  assert.equal(result.evidence.length, 1);
  const evidence = result.evidence[0]!;
  assert.equal(evidence.pageTitle, "قرار بشأن السندات");
  assert.equal(evidence.reference, "قرار بشأن السندات");
  assert.equal(evidence.resolutionNumber, "60 (6/11)");
  assert.match(evidence.sessionDate ?? "", /دورة مؤتمره السادسة بجدة/);
  assert.equal(evidence.topic, "المعاملات المالية، السندات");
  assert.equal(evidence.sourceMetadataStatus, "verified");
  assert.equal(evidence.url, IIFA_URL);
  assert.equal(JSON.stringify(evidence).includes(FULL_RESOLUTION_SENTINEL), false);
});

test("metadata fetch failure preserves the citation URL and does not fail retrieval", async () => {
  const result = await retrieveCitation(IIFA_URL, async () =>
    new Response("unavailable", { status: 503 }));

  assert.equal(result.status, "available");
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0]?.url, IIFA_URL);
  assert.equal(result.evidence[0]?.sourceDomain, "iifa-aifi.org");
  assert.equal(result.evidence[0]?.sourceSubtype, "collective_fiqh_resolution");
  assert.equal(result.evidence[0]?.sourceMetadataStatus, "unavailable");
  assert.equal(result.evidence[0]?.pageTitle, undefined);
  assert.equal(result.evidence[0]?.resolutionNumber, undefined);
});

test("an official IIFA title cannot pass when its verified topic conflicts", async () => {
  const claim = "Artificial intelligence ruling";
  const summary =
    "This source discusses the artificial intelligence ruling and its legal implications.";
  const result = await retrieveAuthoritativeWebEvidence({
    claim,
    context: "",
    language: "en",
    provider: directProvider,
    fetcher: async () => new Response(JSON.stringify({
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: summary,
          annotations: [{
            type: "url_citation",
            url: IIFA_URL,
            title: "Artificial intelligence ruling",
            start_index: 0,
            end_index: summary.length,
          }],
        }],
      }],
    }), { headers: { "content-type": "application/json" } }),
    metadataFetcher: async () => new Response(`
      <html>
        <head><title>Artificial intelligence ruling</title></head>
        <body><a class="metaacdtag">Automobiles</a></body>
      </html>
    `, { headers: { "content-type": "text/html" } }),
  });

  assert.equal(result.status, "no_results");
  assert.deepEqual(result.evidence, []);
});

test("metadata fetching follows only revalidated official IIFA redirects", async () => {
  const fetchedUrls: string[] = [];
  const result = await retrieveCitation(IIFA_URL, async (input) => {
    const url = String(input);
    fetchedUrls.push(url);
    if (fetchedUrls.length === 1) {
      return new Response(null, {
        status: 302,
        headers: { location: "https://www.iifa-aifi.org/ar/1813.html" },
      });
    }
    return new Response(VERIFIED_PAGE_HTML, {
      headers: { "content-type": "text/html" },
    });
  });
  assert.equal(result.status, "available");
  assert.deepEqual(fetchedUrls, [
    IIFA_URL,
    "https://www.iifa-aifi.org/ar/1813.html",
  ]);
  assert.equal(result.evidence[0]?.sourceMetadataStatus, "verified");

  const blockedUrls: string[] = [];
  const blockedResult = await retrieveCitation(IIFA_URL, async (input) => {
    blockedUrls.push(String(input));
    return new Response(null, {
      status: 301,
      headers: { location: "https://iifa-aifi.org.evil.example/ar/1813.html" },
    });
  });
  assert.equal(blockedResult.status, "available");
  assert.deepEqual(blockedUrls, [IIFA_URL]);
  assert.equal(blockedResult.evidence[0]?.sourceMetadataStatus, "unavailable");
});

test("non-IIFA citations do not trigger metadata page fetches", async () => {
  let metadataFetchCount = 0;
  const result = await retrieveCitation(
    "https://binbaz.org.sa/evidence/1",
    async () => {
      metadataFetchCount += 1;
      throw new Error("non-IIFA page fetch must not occur");
    },
  );
  assert.equal(result.status, "available");
  assert.equal(metadataFetchCount, 0);
  assert.equal(result.evidence[0]?.sourceSubtype, undefined);
});