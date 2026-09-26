import assert from "node:assert/strict";
import { test } from "node:test";
import { extractExternalWebEvidence } from "../src/lib/authoritative-web-retrieval.ts";

const CLAIM = "ما حكم صلاة الوتر؟";
const PAGE_TITLE = "حكم صلاة الوتر ومتى وقتها؟";
const RELEVANCE_SENTENCE =
  "يبين المصدر حكم صلاة الوتر ووقت أدائها.";

function responseWithCitation(url: string): unknown {
  return {
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: RELEVANCE_SENTENCE,
            annotations: [
              {
                type: "url_citation",
                url,
                title: PAGE_TITLE,
                start_index: 0,
                end_index: RELEVANCE_SENTENCE.length,
              },
            ],
          },
        ],
      },
    ],
  };
}

function extracted(url: string) {
  return extractExternalWebEvidence(
    responseWithCitation(url),
    CLAIM,
    "2026-09-25T00:00:00.000Z",
  );
}

test("binothaimeen.net and its legitimate old subdomain pass strict hostname validation", () => {
  for (const url of [
    "https://binothaimeen.net/content/11371",
    "https://old.binothaimeen.net/content/11371",
  ]) {
    const evidence = extracted(url);
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0]?.url, url);
    assert.equal(evidence[0]?.pageTitle, PAGE_TITLE);
    assert.equal(evidence[0]?.sourceType, "external_web");
    assert.equal(evidence[0]?.sourceDomain, new URL(url).hostname);
  }
});

test("lookalike and unrelated hosts are rejected", () => {
  for (const url of [
    "https://binothaimeen.net.evil.example/content/11371",
    "https://fake-binothaimeen.net/content/11371",
    "https://unrelated.example/content/11371",
    "http://binothaimeen.net/content/11371",
  ]) {
    assert.deepEqual(extracted(url), []);
  }
});

test("the existing approved external domains remain accepted", () => {
  for (const domain of ["dorar.net", "binbaz.org.sa", "alifta.gov.sa"]) {
    const url = `https://${domain}/evidence`;
    const evidence = extracted(url);
    assert.equal(evidence.length, 1, domain);
    assert.equal(evidence[0]?.sourceDomain, domain);
  }
});