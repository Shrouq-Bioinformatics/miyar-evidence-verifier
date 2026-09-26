import type { AIProviderConfig } from "./ai-provider.ts";
import {
  APPROVED_EXTERNAL_DOMAINS,
  retrieveAuthoritativeWebEvidence,
  type ExternalRetrievalResult,
} from "./authoritative-web-retrieval.ts";
import type { RetrievedEvidence } from "./evidence.ts";
import { retrieveLocalQuranAndTafsir } from "./quranenc-tafsir.ts";

export const SOURCE_ROUTING_CATEGORIES = [
  "quran",
  "tafsir",
  "hadith",
  "fiqh",
  "contemporary_fiqh",
  "aqidah",
  "family_social",
  "general_islamic",
  "uncertain",
] as const;

export type SourceRoutingCategory = (typeof SOURCE_ROUTING_CATEGORIES)[number];
export type ApprovedSourceDomain = (typeof APPROVED_EXTERNAL_DOMAINS)[number];

export type SourceClassification = {
  categories: SourceRoutingCategory[];
  confidence: number | null;
  fallbackUsed: boolean;
};

export type SourceRouting = SourceClassification & {
  selectedDomains: ApprovedSourceDomain[];
};

const CLASSIFICATION_TIMEOUT_MS = 5_000;
const CLASSIFICATION_MODEL = "gpt-5.4-mini";
const MIN_ROUTING_CONFIDENCE = 0.65;

const ROUTING_INSTRUCTIONS = [
  "Classify the topic of the supplied Islamic claim or question only to choose where a search should be made.",
  "Do not answer the claim, issue a religious ruling, assess truth or authenticity, cite evidence, or provide reasoning.",
  "Classify the meaning even when the input is Arabic, English, or French. More than one category may apply.",
  "Use general_islamic only when none of the more specific categories applies; do not add it merely because the claim is Islamic.",
  "Return only a JSON object with exactly these fields: categories, confidence.",
  "categories must be a non-empty array using only the supplied category IDs. Use uncertain when the topic cannot be identified.",
  "confidence must be a number from 0 to 1 estimating only the category choice; this is not a religious confidence or a calibrated score.",
  "Allowed categories: quran (Quran text or reference), tafsir (Quran interpretation), hadith (hadith text/authenticity/meaning), fiqh (established practical rulings), contemporary_fiqh (modern or emerging rulings), aqidah (creed), family_social (family or social matters), general_islamic (broad Islamic topics), uncertain (ambiguous or insufficiently specified).",
].join(" ");

type LocalRetrievalResult = Awaited<ReturnType<typeof retrieveLocalQuranAndTafsir>>;
type ExternalRetrievalInput = Parameters<typeof retrieveAuthoritativeWebEvidence>[0];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asConfidence(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
    ? value
    : null;
}

function uncertainClassification(confidence: number | null = null): SourceClassification {
  return {
    categories: ["uncertain"],
    confidence,
    fallbackUsed: true,
  };
}

function getResponseText(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  if (typeof payload.output_text === "string") return payload.output_text;
  if (!Array.isArray(payload.output)) return null;

  const text = payload.output.flatMap((item) => {
    if (!isRecord(item) || !Array.isArray(item.content)) return [];
    return item.content.flatMap((part) =>
      isRecord(part) &&
      part.type === "output_text" &&
      typeof part.text === "string"
        ? [part.text]
        : [],
    );
  }).join("");
  return text || null;
}

function isAllowedDirectOpenAIProvider(
  provider: AIProviderConfig | null,
): provider is AIProviderConfig {
  if (!provider || provider.connection !== "direct_openai") return false;
  try {
    const providerUrl = new URL(provider.baseUrl);
    return providerUrl.origin === "https://api.openai.com" &&
      providerUrl.pathname.replace(/\/+$/, "") === "/v1";
  } catch {
    return false;
  }
}

export async function classifySourceTopic(
  claim: string,
  provider: AIProviderConfig | null,
  fetcher: typeof fetch = fetch,
): Promise<SourceClassification> {
  if (!isAllowedDirectOpenAIProvider(provider)) return uncertainClassification();

  try {
    const response = await fetcher("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(CLASSIFICATION_TIMEOUT_MS),
      body: JSON.stringify({
        model: CLASSIFICATION_MODEL,
        store: false,
        max_output_tokens: 180,
        text: { format: { type: "json_object" } },
        input: [
          { role: "system", content: ROUTING_INSTRUCTIONS },
          { role: "user", content: JSON.stringify({ claim }) },
        ],
      }),
    });
    if (!response.ok) return uncertainClassification();

    const payload: unknown = await response.json();
    const content = getResponseText(payload);
    if (!content) return uncertainClassification();

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return uncertainClassification();
    }
    if (!isRecord(parsed)) return uncertainClassification();

    const confidence = asConfidence(parsed.confidence);
    if (
      confidence === null ||
      !Array.isArray(parsed.categories) ||
      parsed.categories.length === 0 ||
      parsed.categories.length > SOURCE_ROUTING_CATEGORIES.length
    ) {
      return uncertainClassification(confidence);
    }

    const allowedCategories = new Set<string>(SOURCE_ROUTING_CATEGORIES);
    if (
      parsed.categories.some(
        (category) =>
          typeof category !== "string" || !allowedCategories.has(category),
      )
    ) {
      return uncertainClassification(confidence);
    }

    const classifiedCategories = SOURCE_ROUTING_CATEGORIES.filter((category) =>
      (parsed.categories as string[]).includes(category),
    );
    if (
      confidence < MIN_ROUTING_CONFIDENCE ||
      classifiedCategories.includes("uncertain")
    ) {
      return uncertainClassification(confidence);
    }

    const specificCategories = classifiedCategories.filter(
      (category) => category !== "general_islamic",
    );
    const categories = specificCategories.length > 0
      ? specificCategories
      : classifiedCategories;
    return { categories, confidence, fallbackUsed: false };
  } catch {
    return uncertainClassification();
  }
}

const ALL_DOMAINS: readonly ApprovedSourceDomain[] = APPROVED_EXTERNAL_DOMAINS;
const FIQH_DOMAINS: readonly ApprovedSourceDomain[] = [
  "binbaz.org.sa",
  "binothaimeen.net",
  "alifta.gov.sa",
];

const DOMAINS_BY_CATEGORY: Record<
  SourceRoutingCategory,
  readonly ApprovedSourceDomain[]
> = {
  quran: [],
  tafsir: [],
  hadith: ["dorar.net"],
  fiqh: FIQH_DOMAINS,
  contemporary_fiqh: ["iifa-aifi.org", ...FIQH_DOMAINS],
  aqidah: ["binbaz.org.sa", "binothaimeen.net", "dorar.net"],
  // IIFA joins family/social searches when the classifier also identifies a
  // contemporary-fiqh aspect.
  family_social: FIQH_DOMAINS,
  general_islamic: ALL_DOMAINS,
  uncertain: ALL_DOMAINS,
};

export function routeSourceCategories(
  classification: SourceClassification,
): SourceRouting {
  const confidence = asConfidence(classification.confidence);
  const categoryValues: unknown = classification.categories;
  const categoryArray = Array.isArray(categoryValues) ? categoryValues : [];
  const validCategories = categoryArray.length > 0 &&
    categoryArray.every(
      (category) =>
        typeof category === "string" &&
        (SOURCE_ROUTING_CATEGORIES as readonly string[]).includes(category),
    );
  const fallback = !validCategories ||
    classification.fallbackUsed ||
    confidence === null ||
    confidence < MIN_ROUTING_CONFIDENCE ||
    (validCategories && categoryArray.includes("uncertain"));
  const classifiedCategories = SOURCE_ROUTING_CATEGORIES.filter((category) =>
    categoryArray.includes(category),
  );
  const specificCategories = classifiedCategories.filter(
    (category) => category !== "general_islamic",
  );
  const categories = fallback
    ? ["uncertain" as const]
    : specificCategories.length > 0
      ? specificCategories
      : classifiedCategories;
  const selected = new Set<ApprovedSourceDomain>();
  for (const category of categories) {
    for (const domain of DOMAINS_BY_CATEGORY[category]) selected.add(domain);
  }

  return {
    categories,
    confidence,
    fallbackUsed: fallback,
    selectedDomains: APPROVED_EXTERNAL_DOMAINS.filter((domain) =>
      selected.has(domain),
    ),
  };
}

export async function retrieveEvidenceWithSourceRouting(
  {
    claim,
    retrievalQuery,
    context,
    language,
    provider,
  }: {
    claim: string;
    retrievalQuery?: string;
    context: string;
    language: string;
    provider: AIProviderConfig | null;
  },
  dependencies: {
    localRetriever?: (claim: string) => Promise<LocalRetrievalResult>;
    classifier?: (
      claim: string,
      provider: AIProviderConfig | null,
    ) => Promise<SourceClassification>;
    externalRetriever?: (
      input: ExternalRetrievalInput,
    ) => Promise<ExternalRetrievalResult>;
  } = {},
): Promise<{
  local: LocalRetrievalResult;
  routing: SourceRouting;
  external: ExternalRetrievalResult;
  retrievedEvidence: RetrievedEvidence[];
}> {
  const localRetriever = dependencies.localRetriever ?? retrieveLocalQuranAndTafsir;
  const classifier = dependencies.classifier ?? classifySourceTopic;
  const externalRetriever =
    dependencies.externalRetriever ?? retrieveAuthoritativeWebEvidence;
  const query = retrievalQuery ?? claim;

  // Local Quran retrieval always precedes classification and external search.
  const local = await localRetriever(query);
  let classification: SourceClassification;
  try {
    classification = await classifier(claim, provider);
  } catch {
    classification = uncertainClassification();
  }
  const routing = routeSourceCategories(classification);
  const external = routing.selectedDomains.length === 0
    ? { status: "no_results" as const, evidence: [] }
    : await externalRetriever({
        claim,
        retrievalQuery: query,
        context,
        language,
        provider,
        allowedDomains: routing.selectedDomains,
      });

  return {
    local,
    routing,
    external,
    retrievedEvidence: [
      ...local.localEvidence,
      ...local.tafsir.evidence,
      ...external.evidence,
    ],
  };
}