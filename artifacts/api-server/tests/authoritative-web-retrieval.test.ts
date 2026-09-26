import assert from "node:assert/strict";
import test from "node:test";
import {
  APPROVED_EXTERNAL_DOMAINS,
  extractExternalWebEvidence,
  retrieveAuthoritativeWebEvidence,
} from "../src/lib/authoritative-web-retrieval.ts";
import { retrieveEvidence } from "../src/lib/evidence.ts";
import { normalizeProviderResult } from "../src/lib/verification.ts";

const citationResponse = (
  url: string,
  title = "Calculating zakat on annual savings",
) => ({
  output: [{
    type: "message",
    content: [{
      type: "output_text",
      text: "This page explains how zakat is calculated from annual savings. Further review is needed.",
      annotations: [{
        type: "url_citation",
        start_index: 21,
        end_index: 31,
        url,
        title,
      }],
    }],
  }],
});

const directProvider = {
  apiKey: "test-key",
  baseUrl: "https://api.openai.com/v1",
  connection: "direct_openai" as const,
};

test("only approved exact hosts and legitimate subdomains become external evidence", () => {
  const response = {
    output: [{
      type: "message",
      content: [{
        type: "output_text",
        text: "This page explains how zakat is calculated from annual savings.",
        annotations: [
          {
            type: "url_citation",
            start_index: 0,
            end_index: 5,
            url: "https://binbaz.org.sa/fatwas/1",
            title: "Calculating zakat from annual savings",
          },
          {
            type: "url_citation",
            start_index: 0,
            end_index: 5,
            url: "https://www.dorar.net/hadith/search",
            title: "Zakat calculation for annual savings",
          },
          {
            type: "url_citation",
            start_index: 0,
            end_index: 5,
            url: "https://sunna.alifta.gov.sa/record/1",
            title: "Annual savings and zakat calculation",
          },
          {
            type: "url_citation",
            start_index: 0,
            end_index: 5,
            url: "https://binbaz.org.sa.evil.example/fatwas/1",
            title: "Lookalike",
          },
          {
            type: "url_citation",
            start_index: 0,
            end_index: 5,
            url: "https://fake-binbaz.org/fatwas/1",
            title: "Lookalike",
          },
          {
            type: "url_citation",
            start_index: 0,
            end_index: 5,
            url: "http://dorar.net/hadith/1",
            title: "Unencrypted URL",
          },
          {
            type: "url_citation",
            start_index: 0,
            end_index: 5,
            url: "https://binbaz.org.sa:444/fatwas/1",
            title: "Unexpected port",
          },
        ],
      }],
    }],
  };

  let nextId = 0;
  const evidence = extractExternalWebEvidence(
    response,
    "zakat calculation from annual savings",
    "2026-09-25T00:00:00.000Z",
    () => `fixture-${++nextId}`,
  );

  assert.equal(evidence.length, 3);
  assert.deepEqual(
    evidence.map((item) => item.sourceDomain),
    ["binbaz.org.sa", "www.dorar.net", "sunna.alifta.gov.sa"],
  );
  assert.ok(evidence.every((item) => item.sourceType === "external_web"));
  assert.deepEqual(
    evidence.map((item) => item.id),
    ["external-web-fixture-1", "external-web-fixture-2", "external-web-fixture-3"],
  );
  assert.ok(evidence.every((item) => item.retrievedAt === "2026-09-25T00:00:00.000Z"));
});

test("free-form URLs do not become evidence without a URL citation annotation", () => {
  const evidence = extractExternalWebEvidence({
    output: [{
      type: "message",
      content: [{
        type: "output_text",
        text: "Visit https://binbaz.org.sa/fatwas/1 and https://evil.example/fake.",
        annotations: [],
      }],
    }],
  }, "zakat calculation from annual savings");

  assert.deepEqual(evidence, []);
});

test("a citation without a meaningful relevant summary is not retained", () => {
  const evidence = extractExternalWebEvidence({
    output: [{
      type: "message",
      content: [{
        type: "output_text",
        text: "([dorar.net](https://dorar.net/hadith/1))",
        annotations: [{
          type: "url_citation",
          start_index: 0,
          end_index: 10,
          url: "https://dorar.net/hadith/1",
          title: "Hadith page",
        }],
      }],
    }],
  }, "zakat calculation from annual savings");

  assert.deepEqual(evidence, []);
});

test("a cited source list can use its adjacent explanation as a generated summary", () => {
  const link = "[صفحة ابن باز](https://binbaz.org.sa/fatwas/1)";
  const explanation = "تشرح الصفحة حكم صلة الرحم وأثرها في الإسلام.";
  const text = `${explanation}\nالمصادر: ${link}`;
  const linkStart = text.indexOf(link);
  const evidence = extractExternalWebEvidence({
    output: [{
      type: "message",
      content: [{
        type: "output_text",
        text,
        annotations: [{
          type: "url_citation",
          start_index: linkStart,
          end_index: linkStart + link.length,
          url: "https://binbaz.org.sa/fatwas/1",
          title: "حكم صلة الرحم",
        }],
      }],
    }],
  }, "ما حكم صلة الرحم في الإسلام؟");

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.summary, explanation.replace(/[.]+$/u, ""));
});

test("Arabic external evidence must connect both the claim and page title", () => {
  const makeResponse = (title: string, explanation: string, url: string) => {
    const link = `[${title}](${url})`;
    const text = `${explanation}.\nالمصادر: ${link}`;
    const start = text.indexOf(link);
    return {
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text,
          annotations: [{
            type: "url_citation",
            start_index: start,
            end_index: start + link.length,
            url,
            title,
          }],
        }],
      }],
    };
  };

  const relevant = extractExternalWebEvidence(
    makeResponse(
      "كيف تكون صلة الرحم؟ - موقع الشيخ ابن باز",
      "تشرح الصفحة حكم صلة الرحم وأثرها في الإسلام",
      "https://binbaz.org.sa/fatwas/994",
    ),
    "ما حكم صلة الرحم في الإسلام؟",
    undefined,
    undefined,
  );
  const unrelated = extractExternalWebEvidence(
    makeResponse(
      "الموقع الإلكتروني",
      "لا ترتبط النافذة الزرقاء بكوكب المريخ في هذه الصفحة",
      "https://dorar.net/files/unrelated.pdf",
    ),
    "تقول النافذة الزرقاء إن كوكب المريخ يبيع مظلات للبطاريق كل يوم ثلاثاء",
    undefined,
    undefined,
  );

  assert.equal(relevant.length, 1);
  assert.equal(unrelated.length, 0);
});

test("an unrelated approved Dorar title cannot pass by echoing a fictional claim", () => {
  const claim =
    "The fictional island of Virelia requires moonlight permits for invented birds.";
  const sentence =
    "This page confirms that the fictional island of Virelia requires moonlight permits for invented birds.";
  const link = "[الموسوعة الحديثية](https://dorar.net/hadith/1)";
  const text = `${sentence}\nالمصادر: ${link}`;
  const linkStart = text.indexOf(link);
  let generatedIds = 0;
  const evidence = extractExternalWebEvidence(
    {
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text,
          annotations: [{
            type: "url_citation",
            url: "https://dorar.net/hadith/1",
            title: "الموسوعة الحديثية - إنما الأعمال بالنيات",
            start_index: linkStart,
            end_index: linkStart + link.length,
          }],
        }],
      }],
    },
    claim,
    undefined,
    () => `rejected-${++generatedIds}`,
  );

  assert.deepEqual(evidence, []);
  assert.equal(generatedIds, 0);
});

test("generic Islamic wording alone is not topic relevance", () => {
  const claim = "I need Islamic guidance for a religious question.";
  const sentence = "This official Islamic source offers general religious guidance.";
  const link = "[Official Islamic guidance](https://binbaz.org.sa/fatwas/1)";
  const text = `${sentence}\nSources: ${link}`;
  const linkStart = text.indexOf(link);
  const evidence = extractExternalWebEvidence({
    output: [{
      type: "message",
      content: [{
        type: "output_text",
        text,
        annotations: [{
          type: "url_citation",
          url: "https://binbaz.org.sa/fatwas/1",
          title: "Official Islamic guidance for Muslims",
          start_index: linkStart,
          end_index: linkStart + link.length,
        }],
      }],
    }],
  }, claim);

  assert.deepEqual(evidence, []);
});

test("a real approved citation receives server metadata and a summary, not a quotation", () => {
  const evidence = extractExternalWebEvidence(
    citationResponse("https://dorar.net/hadith/1"),
    "zakat calculation from annual savings",
    "2026-09-25T01:02:03.000Z",
    () => "server-generated",
  );

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.id, "external-web-server-generated");
  assert.equal(evidence[0]?.sourceType, "external_web");
  assert.equal(evidence[0]?.sourceTitle, "dorar.net");
  assert.equal(evidence[0]?.pageTitle, "Calculating zakat on annual savings");
  assert.equal(evidence[0]?.url, "https://dorar.net/hadith/1");
  assert.equal(evidence[0]?.sourceDomain, "dorar.net");
  assert.equal(evidence[0]?.sourceProvider, "OpenAI Responses API web_search");
  assert.equal(evidence[0]?.retrievedAt, "2026-09-25T01:02:03.000Z");
  assert.ok(evidence[0]?.summary);
  assert.equal(evidence[0]?.excerpt, undefined);
});

test("external search uses only the direct provider and the exact allowlist", async () => {
  let requestUrl = "";
  let requestBody: Record<string, unknown> | undefined;
  let authorization = "";
  const result = await retrieveAuthoritativeWebEvidence({
    claim: "zakat calculation from annual savings",
    context: "context",
    language: "العربية",
    provider: directProvider,
    fetcher: async (input, init) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return new Response(JSON.stringify(citationResponse(
        "https://binbaz.org.sa/fatwas/1",
        "Calculating zakat from annual savings",
      )), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });

  assert.equal(requestUrl, "https://api.openai.com/v1/responses");
  assert.equal(authorization, "Bearer test-key");
  assert.equal(requestBody?.store, false);
  assert.equal(requestBody?.tool_choice, "required");
  assert.deepEqual(requestBody?.tools, [{
    type: "web_search",
    filters: { allowed_domains: [...APPROVED_EXTERNAL_DOMAINS] },
  }]);
  assert.deepEqual(requestBody?.include, ["web_search_call.action.sources"]);
  assert.ok(JSON.stringify(requestBody?.input).includes("Do not return a bare title"));
  assert.ok(JSON.stringify(requestBody?.input).includes("specific hadith record"));
  assert.equal(result.status, "available");
  assert.equal(result.evidence[0]?.sourceDomain, "binbaz.org.sa");
});

test("Arabic retrieval query drives Arabic source search without replacing the original claim", async () => {
  const claim = "The hadith Actions are judged by intentions is authentic.";
  const retrievalQuery = "حديث إنما الأعمال بالنيات صحة الحديث";
  let requestBody: any;
  const explanation =
    "تشرح الصفحة حديث إنما الأعمال بالنيات وتذكر موضعه في صحيح البخاري.";
  const link = "[صحيح البخاري](https://dorar.net/hadith/1)";
  const text = `${explanation}\nالمصادر: ${link}`;
  const linkStart = text.indexOf(link);
  const result = await retrieveAuthoritativeWebEvidence({
    claim,
    retrievalQuery,
    context: "academic",
    language: "English",
    provider: directProvider,
    allowedDomains: ["dorar.net"],
    fetcher: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return Response.json({
        output: [{
          type: "message",
          content: [{
            type: "output_text",
            text,
            annotations: [{
              type: "url_citation",
              start_index: linkStart,
              end_index: linkStart + link.length,
              url: "https://dorar.net/hadith/1",
              title: "حديث إنما الأعمال بالنيات - صحيح البخاري",
            }],
          }],
        }],
      });
    },
  });

  const userInput = requestBody.input.find((item: any) => item.role === "user");
  const sentInput = JSON.parse(userInput.content);
  assert.equal(sentInput.claim, claim);
  assert.equal(sentInput.retrievalQuery, retrievalQuery);
  assert.equal(result.status, "available");
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0]?.url, "https://dorar.net/hadith/1");
  assert.match(result.evidence[0]?.summary ?? "", /حديث إنما الأعمال بالنيات/u);
  assert.equal(result.evidence[0]?.excerpt, undefined);
});

test("external search and accepted citations stay within the selected route domains", async () => {
  let requestedDomains: unknown;
  const result = await retrieveAuthoritativeWebEvidence({
    claim: "zakat calculation from annual savings",
    context: "context",
    language: "العربية",
    provider: directProvider,
    allowedDomains: ["dorar.net", "evil.example"],
    fetcher: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        tools?: Array<{ filters?: { allowed_domains?: unknown } }>;
      };
      requestedDomains = body.tools?.[0]?.filters?.allowed_domains;
      return new Response(JSON.stringify(citationResponse(
        "https://binbaz.org.sa/fatwas/1",
        "Calculating zakat from annual savings",
      )), { status: 200 });
    },
  });

  assert.deepEqual(requestedDomains, ["dorar.net"]);
  assert.equal(result.status, "no_results");
  assert.deepEqual(result.evidence, []);
});

test("an empty source route skips external search instead of broadening it", async () => {
  let called = false;
  const result = await retrieveAuthoritativeWebEvidence({
    claim: "Quran verse",
    context: "",
    language: "العربية",
    provider: directProvider,
    allowedDomains: [],
    fetcher: async () => {
      called = true;
      return new Response(null, { status: 200 });
    },
  });

  assert.equal(called, false);
  assert.equal(result.status, "no_results");
  assert.deepEqual(result.evidence, []);
});

test("a partial result from one approved site survives other sites returning nothing", async () => {
  let requestedDomains: unknown;
  const result = await retrieveAuthoritativeWebEvidence({
    claim: "zakat calculation from annual savings",
    context: "context",
    language: "العربية",
    provider: directProvider,
    fetcher: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        tools?: Array<{ filters?: { allowed_domains?: unknown } }>;
      };
      requestedDomains = body.tools?.[0]?.filters?.allowed_domains;
      return new Response(JSON.stringify(citationResponse(
        "https://binbaz.org.sa/fatwas/1",
        "Calculating zakat from annual savings",
      )), { status: 200 });
    },
  });

  assert.deepEqual(requestedDomains, [...APPROVED_EXTERNAL_DOMAINS]);
  assert.equal(result.status, "available");
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0]?.sourceDomain, "binbaz.org.sa");
});

test("no returned citations is a no-results outcome", async () => {
  const result = await retrieveAuthoritativeWebEvidence({
    claim: "unrelated claim",
    context: "",
    language: "العربية",
    provider: directProvider,
    fetcher: async () => new Response(JSON.stringify({
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: "No relevant approved source was found.",
          annotations: [],
        }],
      }],
    }), { status: 200 }),
  });

  assert.equal(result.status, "no_results");
  assert.deepEqual(result.evidence, []);
});

test("rejected approved-domain results return no evidence without a database write", async () => {
  const claim =
    "The fictional island of Virelia requires moonlight permits for invented birds.";
  const sentence =
    "This page confirms that the fictional island of Virelia requires moonlight permits for invented birds.";
  const link = "[الموسوعة الحديثية](https://dorar.net/hadith/1)";
  const text = `${sentence}\nSources: ${link}`;
  const linkStart = text.indexOf(link);
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
          text,
          annotations: [{
            type: "url_citation",
            url: "https://dorar.net/hadith/1",
            title: "الموسوعة الحديثية - إنما الأعمال بالنيات",
            start_index: linkStart,
            end_index: linkStart + link.length,
          }],
        }],
      }],
    }), { headers: { "content-type": "application/json" } }),
  });

  assert.equal(result.status, "no_results");
  assert.deepEqual(result.evidence, []);
});

test("a failed web search does not throw or manufacture evidence", async () => {
  const result = await retrieveAuthoritativeWebEvidence({
    claim: "claim",
    context: "",
    language: "العربية",
    provider: directProvider,
    fetcher: async () => new Response("unavailable", { status: 503 }),
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, "http_error");
  assert.equal(result.httpStatus, 503);
  assert.deepEqual(result.evidence, []);
});

test("managed OpenAI credentials are never used for external web search", async () => {
  let called = false;
  const result = await retrieveAuthoritativeWebEvidence({
    claim: "claim",
    context: "",
    language: "العربية",
    provider: {
      apiKey: "managed-test-key",
      baseUrl: "https://managed.example/v1",
      connection: "replit_managed_openai",
    },
    fetcher: async () => {
      called = true;
      return new Response(null, { status: 200 });
    },
  });

  assert.equal(called, false);
  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, "direct_provider_missing");
  assert.deepEqual(result.evidence, []);
});

test("the analyzer can accept only the external IDs actually retrieved", () => {
  const evidence = extractExternalWebEvidence(
    citationResponse("https://dorar.net/hadith/1"),
    "zakat calculation from annual savings",
    "2026-09-25T01:02:03.000Z",
    () => "retrieved",
  );
  const fakeCitation = normalizeProviderResult({
    status: "supported",
    confidence: 99,
    sourceIds: ["external-web-not-retrieved"],
  }, evidence);
  const actualCitation = normalizeProviderResult({
    status: "needs_review",
    sourceIds: ["external-web-retrieved"],
  }, evidence);

  assert.equal(fakeCitation.status, "needs_review");
  assert.equal(fakeCitation.confidence, 0);
  assert.deepEqual(fakeCitation.evidence, []);
  assert.equal(actualCitation.evidence[0]?.id, "external-web-retrieved");
  assert.equal(actualCitation.evidence[0]?.sourceType, "external_web");
});

test("local Quran and external web records retain distinct provenance", () => {
  const localEvidence = retrieveEvidence(
    "يا أيها الذين آمنوا أوفوا بالعقود",
  ).filter((record) => record.sourceType === "quran");
  const externalEvidence = extractExternalWebEvidence(
    citationResponse("https://binbaz.org.sa/fatwas/1"),
    "zakat calculation from annual savings",
    "2026-09-25T01:02:03.000Z",
    () => "external",
  );
  const merged = [...localEvidence, ...externalEvidence];

  assert.deepEqual(
    merged.map((item) => item.sourceType),
    ["quran", "external_web"],
  );
  assert.equal(merged[0]?.id, "quran-5-1");
  assert.equal(merged[0]?.sourceId, "quran");
  assert.equal(merged[1]?.sourceId, "external_web:binbaz.org.sa");
});