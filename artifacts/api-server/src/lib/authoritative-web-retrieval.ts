import { randomUUID } from "node:crypto";
import type { AIProviderConfig } from "./ai-provider";
import type { RetrievedEvidence } from "./evidence";
import { extractIifaResolutionMetadata } from "./iifa-resolution-metadata.ts";

export const APPROVED_EXTERNAL_DOMAINS = [
  "dorar.net",
  "binbaz.org.sa",
  "alifta.gov.sa",
  "binothaimeen.net",
  "iifa-aifi.org",
] as const;

const WEB_SEARCH_TIMEOUT_MS = 15_000;
const WEB_SEARCH_MODEL = "gpt-5.4-mini";
const IIFA_DOMAIN = "iifa-aifi.org";
const IIFA_METADATA_MAX_BYTES = 512 * 1024;
const IIFA_METADATA_MAX_REDIRECTS = 3;
const IIFA_METADATA_TIMEOUT_MS = 8_000;
const RELEVANCE_STOP_WORDS = new Set([
  "من", "في", "على", "عن", "الي", "ما", "هل", "كيف", "هو", "هي", "هذا",
  "هذه", "ذلك", "الذي", "التي", "الذين", "ان", "ثم", "كان", "كانت", "لهم",
  "لها", "موقع", "الكتروني", "شيخ", "ابن", "باز", "عثيمين", "درر", "سنيه",
  "موسوعه", "صفحه", "مصدر", "مصادر", "رئاسه", "عامه", "بحوث", "علميه",
  "افتاء", "اسلام", "اسلامي", "اسلاميه", "مسلم", "مسلمين", "دين", "ديني",
  "شرعي", "شريعه", "حكم", "احكام", "فتوي", "فتاوي", "حديث", "صحيح",
  "مجمع", "فقه", "دولي", "قرار", "قرارات", "the", "and", "for", "from",
  "with", "about", "this", "that", "site", "website", "official", "source",
  "sources", "page", "pages", "islam", "islamic", "muslim", "muslims",
  "religion", "religious", "guidance", "ruling", "rulings", "rule", "rules",
  "sharia", "shariah", "fatwa", "fatwas", "hadith", "academy",
  "international", "fiqh", "resolution", "resolutions", "question",
  "questions", "claim", "claims", "answer", "answers", "hadithweb", "dorar",
  "how", "what", "why", "when", "where", "which", "who", "is", "are",
  "was", "were", "on", "in", "of", "to", "at", "by", "as", "do", "does",
  "should", "can",
]);
const ARABIC_RELEVANCE_PREFIXES = [
  "وال", "بال", "كال", "فال", "ولل", "لل", "ال", "و", "ف", "ب", "ك", "ل",
];

type UrlCitation = {
  type?: unknown;
  url?: unknown;
  title?: unknown;
  start_index?: unknown;
  end_index?: unknown;
};

type ExternalRetrievalResponse = {
  output?: Array<{
    type?: unknown;
    content?: Array<{
      type?: unknown;
      text?: unknown;
      annotations?: unknown;
    }>;
  }>;
};

type ExternalCitationCandidate = {
  url: string;
  domain: string;
  pageTitle?: string;
  summary: string;
};

export type ExternalRetrievalStatus =
  | "available"
  | "no_results"
  | "unavailable";

export type ExternalRetrievalResult = {
  status: ExternalRetrievalStatus;
  evidence: RetrievedEvidence[];
  reason?: "direct_provider_missing" | "invalid_provider" | "http_error" |
    "timeout" | "request_failed" | "invalid_response";
  httpStatus?: number;
};

function approvedHostname(value: unknown): { url: string; domain: string } | null {
  if (typeof value !== "string") return null;

  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      (parsed.port !== "" && parsed.port !== "443")
    ) {
      return null;
    }

    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    const isApproved = APPROVED_EXTERNAL_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    );
    return isApproved ? { url: value, domain: hostname } : null;
  } catch {
    return null;
  }
}

function hostnameMatchesSelectedDomains(
  hostname: string,
  selectedDomains: readonly string[],
): boolean {
  return selectedDomains.some((domain) =>
    (APPROVED_EXTERNAL_DOMAINS as readonly string[]).includes(domain) &&
    (hostname === domain || hostname.endsWith(`.${domain}`)),
  );
}

function isIifaDomain(hostname: string): boolean {
  return hostname === IIFA_DOMAIN || hostname.endsWith(`.${IIFA_DOMAIN}`);
}

function approvedIifaUrl(value: unknown): { url: string; domain: string } | null {
  const validated = approvedHostname(value);
  return validated && isIifaDomain(validated.domain) ? validated : null;
}

async function readBoundedResponseText(response: Response): Promise<string | null> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > IIFA_METADATA_MAX_BYTES) {
    return null;
  }

  const reader = response.body?.getReader();
  if (!reader) return null;

  const decoder = new TextDecoder("utf-8");
  let byteLength = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > IIFA_METADATA_MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch {
    try {
      await reader.cancel();
    } catch {
      // The response is already unusable; metadata failure must not discard evidence.
    }
    return null;
  }
}

async function fetchIifaResolutionMetadata(
  url: string,
  fetcher: typeof fetch,
) {
  let currentUrl = url;
  const redirectStatuses = new Set([301, 302, 303, 307, 308]);

  try {
    for (let redirectCount = 0; redirectCount <= IIFA_METADATA_MAX_REDIRECTS; redirectCount++) {
      const validated = approvedIifaUrl(currentUrl);
      if (!validated) return null;

      const response = await fetcher(validated.url, {
        method: "GET",
        redirect: "manual",
        headers: { Accept: "text/html" },
        signal: AbortSignal.timeout(IIFA_METADATA_TIMEOUT_MS),
      });

      if (redirectStatuses.has(response.status)) {
        const location = response.headers.get("location");
        if (!location || redirectCount === IIFA_METADATA_MAX_REDIRECTS) return null;
        let redirectUrl: string;
        try {
          redirectUrl = new URL(location, validated.url).toString();
        } catch {
          return null;
        }
        const redirectTarget = approvedIifaUrl(redirectUrl);
        if (!redirectTarget) return null;
        currentUrl = redirectTarget.url;
        continue;
      }

      if (!response.ok) return null;
      const contentType = response.headers.get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (contentType !== "text/html") return null;

      const html = await readBoundedResponseText(response);
      if (html === null) return null;
      const metadata = extractIifaResolutionMetadata(html);
      return Object.keys(metadata).length > 0 ? metadata : null;
    }
  } catch {
    return null;
  }

  return null;
}

function getCitationSummary(
  text: string,
  startValue: unknown,
  endValue: unknown,
): string | undefined {
  if (
    typeof startValue !== "number" ||
    typeof endValue !== "number" ||
    !Number.isInteger(startValue) ||
    !Number.isInteger(endValue) ||
    startValue < 0 ||
    endValue < startValue ||
    startValue > text.length
  ) {
    return undefined;
  }

  const clean = (value: string): string =>
    value
      .replace(/\[[^\]]*\]\(https?:\/\/[^)]*\)/giu, "")
      .replace(/https?:\/\/[^\s<>()]+/giu, "")
      .replace(/【[^】]*】/gu, "")
      .replace(/\s+/g, " ")
      .replace(/^[\s.,;:|()[\]{}–—-]+|[\s.,;:|()[\]{}–—-]+$/gu, "")
      .trim();
  const boundaries = /[.!?؟۔\n]/u;
  let start = startValue;
  while (start > 0 && startValue - start < 360 && !boundaries.test(text[start - 1])) {
    start--;
  }
  if (start > 0 && boundaries.test(text[start - 1])) start--;

  let end = Math.min(endValue, text.length);
  while (end < text.length && end - endValue < 360 && !boundaries.test(text[end])) {
    end++;
  }
  if (end < text.length && boundaries.test(text[end])) end++;

  const directSummary = clean(text.slice(start, end));
  if (directSummary.length >= 16) return directSummary.slice(0, 360);

  // Some Responses outputs place cited links in a source list immediately
  // after the explanation. Recover only adjacent prose, never the link title.
  const preceding = text
    .slice(Math.max(0, startValue - 360), startValue)
    .split(boundaries)
    .map(clean)
    .filter((part) => part.length >= 16);
  const following = text
    .slice(endValue, Math.min(text.length, endValue + 360))
    .split(boundaries)
    .map(clean)
    .filter((part) => part.length >= 16);
  const adjacentSummary = preceding.at(-1) ?? following[0];
  return adjacentSummary?.slice(0, 360);
}

function normalizeRelevanceToken(value: string): string {
  let token = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");

  if (/[\u0600-\u06FF]/u.test(token)) {
    for (let depth = 0; depth < 4; depth++) {
      const prefix = ARABIC_RELEVANCE_PREFIXES.find((candidate) =>
        token.startsWith(candidate) && token.length - candidate.length >= 3,
      );
      if (!prefix) break;
      token = token.slice(prefix.length);
    }
  } else if (token.length >= 5 && token.endsWith("ies")) {
    token = `${token.slice(0, -3)}y`;
  } else if (
    token.length >= 5 &&
    token.endsWith("s") &&
    !/(ss|us|is)$/u.test(token)
  ) {
    token = token.slice(0, -1);
  }

  return token;
}

function relevanceTokens(value: string): Set<string> {
  return new Set(
    value
      .normalize("NFKD")
      .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/u)
      .map(normalizeRelevanceToken)
      .filter((token) =>
        token.length >= 3 && !RELEVANCE_STOP_WORDS.has(token),
      ),
  );
}

function overlapCount(left: Set<string>, right: Set<string>): number {
  return [...left].filter((token) => right.has(token)).length;
}

function explanationMatchesClaim(claim: string, summary: string): boolean {
  const claimTokens = relevanceTokens(claim);
  if (claimTokens.size < 2) return false;
  const requiredClaimTerms = Math.min(2, claimTokens.size);
  return overlapCount(claimTokens, relevanceTokens(summary)) >= requiredClaimTerms;
}

function explanationMatchesClaimAndPage(
  claim: string,
  summary: string,
  pageTitle: string,
  verifiedTopic?: string,
): boolean {
  const claimTokens = relevanceTokens(claim);
  const summaryTokens = relevanceTokens(summary);
  const titleTokens = relevanceTokens(pageTitle);
  if (
    claimTokens.size < 2 ||
    titleTokens.size === 0 ||
    overlapCount(claimTokens, titleTokens) < 1 ||
    overlapCount(claimTokens, summaryTokens) < Math.min(2, claimTokens.size) ||
    overlapCount(titleTokens, summaryTokens) < 1
  ) {
    return false;
  }

  if (verifiedTopic !== undefined) {
    const topicTokens = relevanceTokens(verifiedTopic);
    if (
      topicTokens.size === 0 ||
      overlapCount(claimTokens, topicTokens) < 1 ||
      overlapCount(summaryTokens, topicTokens) < 1
    ) {
      return false;
    }
  }

  return true;
}

function extractExternalCitationCandidates(
  response: unknown,
  selectedDomains: readonly string[],
): ExternalCitationCandidate[] {
  if (!response || typeof response !== "object") return [];
  const output = (response as ExternalRetrievalResponse).output;
  if (!Array.isArray(output)) return [];

  const candidates: ExternalCitationCandidate[] = [];
  for (const item of output) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;

    for (const content of item.content) {
      if (
        content?.type !== "output_text" ||
        typeof content.text !== "string" ||
        !Array.isArray(content.annotations)
      ) {
        continue;
      }

      for (const rawAnnotation of content.annotations) {
        if (!rawAnnotation || typeof rawAnnotation !== "object") continue;
        const annotation = rawAnnotation as UrlCitation;
        if (annotation.type !== "url_citation") continue;

        const validated = approvedHostname(annotation.url);
        if (
          !validated ||
          !hostnameMatchesSelectedDomains(validated.domain, selectedDomains)
        ) {
          continue;
        }

        const summary = getCitationSummary(
          content.text,
          annotation.start_index,
          annotation.end_index,
        );
        if (!summary) continue;
        const pageTitle =
          typeof annotation.title === "string" && annotation.title.trim()
            ? annotation.title.trim()
            : undefined;
        candidates.push({
          url: validated.url,
          domain: validated.domain,
          pageTitle,
          summary,
        });
      }
    }
  }

  return candidates;
}

function candidateMatchesClaim(
  claim: string,
  candidate: ExternalCitationCandidate,
  verifiedPageTitle?: string,
  verifiedTopic?: string,
): boolean {
  const pageTitle = verifiedPageTitle ?? candidate.pageTitle;
  if (!pageTitle) return false;
  if (!explanationMatchesClaimAndPage(
    claim,
    candidate.summary,
    pageTitle,
    verifiedTopic,
  )) {
    return false;
  }

  if (
    candidate.pageTitle &&
    verifiedPageTitle &&
    candidate.pageTitle !== verifiedPageTitle &&
    !explanationMatchesClaimAndPage(
      claim,
      candidate.summary,
      candidate.pageTitle,
    )
  ) {
    return false;
  }
  return true;
}

function createExternalEvidence(
  candidate: ExternalCitationCandidate,
  retrievedAt: string,
  createId: () => string,
  metadata?: Awaited<ReturnType<typeof fetchIifaResolutionMetadata>>,
): RetrievedEvidence {
  const isIifaCitation = isIifaDomain(candidate.domain);
  const pageTitle = isIifaCitation
    ? metadata?.pageTitle
    : candidate.pageTitle;
  return {
    id: `external-web-${createId()}`,
    sourceId: `external_web:${candidate.domain}`,
    sourceTitle: candidate.domain,
    sourceType: "external_web",
    sourceName: isIifaCitation
      ? "مجمع الفقه الإسلامي الدولي"
      : candidate.domain,
    sourceDomain: candidate.domain,
    sourceProvider: isIifaCitation
      ? "International Islamic Fiqh Academy"
      : "OpenAI Responses API web_search",
    sourceSubtype: isIifaCitation ? "collective_fiqh_resolution" : undefined,
    pageTitle,
    reference: pageTitle ?? candidate.domain,
    url: candidate.url,
    edition: "OpenAI Responses API web_search",
    retrievedAt,
    summary: candidate.summary,
    ...(isIifaCitation
      ? {
          sourceMetadataStatus: metadata ? "verified" as const : "unavailable" as const,
          resolutionNumber: metadata?.resolutionNumber,
          sessionDate: metadata?.sessionDate,
          topic: metadata?.topic,
        }
      : {}),
  };
}

/**
 * Only URL citation annotations returned by Responses are eligible for external
 * evidence. Free-form URLs in generated text are deliberately ignored.
 */
export function extractExternalWebEvidence(
  response: unknown,
  claim: string,
  retrievedAt = new Date().toISOString(),
  createId: () => string = randomUUID,
  selectedDomains: readonly string[] = APPROVED_EXTERNAL_DOMAINS,
  retrievalQuery = claim,
): RetrievedEvidence[] {
  if (!response || typeof response !== "object") return [];
  const output = (response as ExternalRetrievalResponse).output;
  if (!Array.isArray(output)) return [];

  const evidence: RetrievedEvidence[] = [];
  const seenUrls = new Set<string>();

  for (const item of output) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;

    for (const content of item.content) {
      if (
        content?.type !== "output_text" ||
        typeof content.text !== "string" ||
        !Array.isArray(content.annotations)
      ) {
        continue;
      }

      for (const rawAnnotation of content.annotations) {
        if (!rawAnnotation || typeof rawAnnotation !== "object") continue;
        const annotation = rawAnnotation as UrlCitation;
        if (annotation.type !== "url_citation") continue;

        const validated = approvedHostname(annotation.url);
        if (
          !validated ||
          !hostnameMatchesSelectedDomains(validated.domain, selectedDomains) ||
          seenUrls.has(validated.url)
        ) {
          continue;
        }
        const summary = getCitationSummary(
          content.text,
          annotation.start_index,
          annotation.end_index,
        );
        if (!summary) continue;
        const pageTitle =
          typeof annotation.title === "string" && annotation.title.trim()
            ? annotation.title.trim()
            : undefined;
        if (
          pageTitle === undefined ||
          !explanationMatchesClaimAndPage(retrievalQuery, summary, pageTitle)
        ) {
          continue;
        }
        seenUrls.add(validated.url);

        const isIifaCitation = isIifaDomain(validated.domain);
        evidence.push({
          id: `external-web-${createId()}`,
          sourceId: `external_web:${validated.domain}`,
          sourceTitle: validated.domain,
          sourceType: "external_web",
          sourceName: isIifaDomain(validated.domain)
            ? "مجمع الفقه الإسلامي الدولي"
            : validated.domain,
          sourceDomain: validated.domain,
          sourceProvider: isIifaDomain(validated.domain)
            ? "International Islamic Fiqh Academy"
            : "OpenAI Responses API web_search",
          sourceSubtype: isIifaDomain(validated.domain)
            ? "collective_fiqh_resolution"
            : undefined,
          pageTitle,
          reference: pageTitle ?? validated.domain,
          url: validated.url,
          edition: "OpenAI Responses API web_search",
          retrievedAt,
          summary,
        });
      }
    }
  }

  return evidence;
}

export async function retrieveAuthoritativeWebEvidence({
  claim,
  retrievalQuery,
  context,
  language,
  provider,
  allowedDomains,
  fetcher = fetch,
  metadataFetcher = fetch,
}: {
  claim: string;
  retrievalQuery?: string;
  context: string;
  language: string;
  provider: AIProviderConfig | null;
  allowedDomains?: readonly string[];
  fetcher?: typeof fetch;
  metadataFetcher?: typeof fetch;
}): Promise<ExternalRetrievalResult> {
  const searchQuery = retrievalQuery ?? claim;
  const selectedDomains = allowedDomains === undefined
    ? [...APPROVED_EXTERNAL_DOMAINS]
    : APPROVED_EXTERNAL_DOMAINS.filter((domain) =>
        allowedDomains.includes(domain),
      );
  if (selectedDomains.length === 0) {
    return { status: "no_results", evidence: [] };
  }

  if (!provider || provider.connection !== "direct_openai") {
    return {
      status: "unavailable",
      evidence: [],
      reason: "direct_provider_missing",
    };
  }

  let providerUrl: URL;
  try {
    providerUrl = new URL(provider.baseUrl);
  } catch {
    return {
      status: "unavailable",
      evidence: [],
      reason: "invalid_provider",
    };
  }
  if (
    providerUrl.origin !== "https://api.openai.com" ||
    providerUrl.pathname.replace(/\/+$/, "") !== "/v1"
  ) {
    return {
      status: "unavailable",
      evidence: [],
      reason: "invalid_provider",
    };
  }

  const instructions = [
    "Search for candidate evidence using only the supplied web_search tool and the Arabic retrievalQuery.",
    "The retrievalQuery is an internal search aid, not evidence, a source, or a quotation. Do not present it as a source or claim that it proves anything.",
    "Use the original claim to judge relevance, but never replace it with the retrievalQuery when explaining the user's claim.",
    "For each source you cite, write one concise sentence in Arabic explaining exactly how that Arabic source directly relates to the original claim.",
    "Put the web_search citation on that same sentence. Do not return a bare title, bare link, or source list without a relevance explanation.",
    "Cite a page only when its retrieved search result supports that specific explanation; an approved domain alone is not evidence.",
    "For hadith claims, search the distinctive hadith wording and a specific hadith record; do not substitute a general fatwa for the hadith source.",
    "If no approved source directly relates to the claim, or you cannot explain the relevance from retrieved results, say no relevant approved source was found and return no citations.",
    "Do not invent source names, hadith numbers, page titles, quotations, URLs, or citations.",
    "Do not present generated summaries as quotations from the source.",
    "Treat nonsensical, fictional, or unrelated claims as having no relevant source, even if the approved domains contain unrelated pages.",
  ].join(" ");

  try {
    const response = await fetcher(`${providerUrl.origin}/v1/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(WEB_SEARCH_TIMEOUT_MS),
      body: JSON.stringify({
        model: WEB_SEARCH_MODEL,
        store: false,
        max_output_tokens: 700,
        tool_choice: "required",
        tools: [{
          type: "web_search",
          filters: { allowed_domains: selectedDomains },
        }],
        include: ["web_search_call.action.sources"],
        input: [
          { role: "system", content: instructions },
          {
            role: "user",
            content: JSON.stringify({
              claim,
              retrievalQuery: searchQuery,
              context,
              language,
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      return {
        status: "unavailable",
        evidence: [],
        reason: "http_error",
        httpStatus: response.status,
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return {
        status: "unavailable",
        evidence: [],
        reason: "invalid_response",
      };
    }

    const candidates = extractExternalCitationCandidates(payload, selectedDomains);
    const checkedCandidates = await Promise.all(candidates.map(async (candidate) => {
      const isIifaCitation = isIifaDomain(candidate.domain);
      if (!explanationMatchesClaim(searchQuery, candidate.summary)) return null;

      const metadata = isIifaCitation
        ? await fetchIifaResolutionMetadata(candidate.url, metadataFetcher)
        : undefined;
      if (
        isIifaCitation &&
        !candidate.pageTitle &&
        !metadata?.pageTitle
      ) {
        return null;
      }
      if (!candidateMatchesClaim(
        searchQuery,
        candidate,
        metadata?.pageTitle,
        metadata?.topic,
      )) {
        return null;
      }
      return { candidate, metadata };
    }));

    const seenUrls = new Set<string>();
    const evidence: RetrievedEvidence[] = [];
    for (const checked of checkedCandidates) {
      if (!checked || seenUrls.has(checked.candidate.url)) continue;
      seenUrls.add(checked.candidate.url);
      evidence.push(createExternalEvidence(
        checked.candidate,
        new Date().toISOString(),
        randomUUID,
        checked.metadata,
      ));
    }
    return {
      status: evidence.length > 0 ? "available" : "no_results",
      evidence,
    };
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "";
    return {
      status: "unavailable",
      evidence: [],
      reason:
        errorName === "TimeoutError" || errorName === "AbortError"
          ? "timeout"
          : "request_failed",
    };
  }
}