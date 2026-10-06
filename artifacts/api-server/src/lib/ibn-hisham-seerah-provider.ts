import type { RetrievedEvidence } from "./evidence";
import type { EvidenceProvider } from "./evidence-provider";
import {
  ALIFTA_ORIGIN,
  ALIFTA_SOURCE_NAME,
  createSourceRequestBudget,
  decodeHtmlEntities,
  getElementContents,
  normalizeArabicForSearch,
  requestAliftaHtml,
  stripHtmlText,
} from "./alifta-source-client";

const PROVIDER_ID = "alifta-hadithweb-ibn-hisham-seerah";
const BOOK_ID = 81;
const MAX_BRANCHES_PER_LEVEL = 3;
const MAX_DEPTH = 4;

type TocNode = {
  id: number;
  isLeaf: boolean;
  text: string;
};

const TOPIC_STOP_WORDS = new Set(
  [
    "ابن",
    "هشام",
    "سيره",
    "نبويه",
    "ذكر",
    "يذكر",
    "قال",
    "خبر",
    "اخبار",
    "هذا",
    "ذلك",
    "وحده",
    "يثبت",
    "ثبت",
    "صحه",
    "الروايه",
    "روايه",
    "حديث",
    "حديثيا",
    "نبي",
    "رسول",
    "محمد",
    "امر",
    "اصحاب",
    "عن",
    "من",
    "في",
    "الى",
    "على",
    "ما",
    "ان",
    "انه",
    "كان",
    "كانت",
    "ثم",
    "صلى",
    "الله",
    "وسلم",
  ].map((word) => normalizeArabicForSearch(word).replace(/ة/g, "ه")),
);

function normalizeSeerahText(value: string): string {
  return normalizeArabicForSearch(value)
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stemArabicToken(value: string): string {
  let token = normalizeSeerahText(value).replace(/\s/g, "");
  if (token.startsWith("ال") && token.length > 4) token = token.slice(2);
  for (const suffix of [
    "هما",
    "هن",
    "كما",
    "كم",
    "هم",
    "ها",
    "ته",
    "ه",
    "نا",
    "ون",
    "ين",
    "ان",
    "ات",
    "ي",
  ]) {
    if (token.length > suffix.length + 2 && token.endsWith(suffix)) {
      token = token.slice(0, -suffix.length);
      break;
    }
  }
  return token;
}

function topicTokens(text: string): string[] {
  const tokens = normalizeSeerahText(text)
    .split(" ")
    .map(stemArabicToken)
    .filter((word) => word.length >= 3 && !TOPIC_STOP_WORDS.has(word));
  return [...new Set(tokens)];
}

function nodeScore(node: TocNode, tokens: readonly string[]): number {
  const words = normalizeSeerahText(node.text)
    .split(" ")
    .map(stemArabicToken)
    .filter(Boolean);
  return tokens.reduce(
    (score, token) =>
      score + (words.some((word) => word === token || word.startsWith(token)) ? 1 : 0),
    0,
  );
}

function rankedNodes(
  nodes: readonly TocNode[],
  tokens: readonly string[],
): TocNode[] {
  return nodes
    .map((node) => ({ node, score: nodeScore(node, tokens) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_BRANCHES_PER_LEVEL)
    .map(({ node }) => node);
}

function parseTocChildren(html: string, currentId: number): TocNode[] {
  const decoded = decodeHtmlEntities(html);
  const nodes: TocNode[] = [];
  const seen = new Set<number>();

  for (const match of decoded.matchAll(
    /<a\b[^>]*href=["']([^"']*BookToc\/ViewBookTocLevel\?[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    try {
      const href = match[1].replace(/\\/g, "/");
      const url = new URL(href, ALIFTA_ORIGIN);
      if (
        url.origin !== ALIFTA_ORIGIN ||
        url.pathname !== "/BookToc/ViewBookTocLevel"
      ) {
        continue;
      }
      const bookId = Number(
        url.searchParams.get("BookId") ?? url.searchParams.get("bookId"),
      );
      const id = Number(
        url.searchParams.get("ParentId") ?? url.searchParams.get("parentId"),
      );
      const isLeaf =
        (url.searchParams.get("IsLeaf") ?? url.searchParams.get("isLeaf"))
          ?.toLowerCase() === "true";
      const text = stripHtmlText(match[2]);
      if (
        bookId !== BOOK_ID ||
        !Number.isSafeInteger(id) ||
        id <= 0 ||
        id === currentId ||
        !text ||
        seen.has(id)
      ) {
        continue;
      }
      seen.add(id);
      nodes.push({ id, isLeaf, text });
    } catch {
      // Ignore malformed or non-source table-of-contents links.
    }
  }

  return nodes;
}

function metadataConfirmsIbnHisham(html: string): boolean {
  const text = normalizeSeerahText(stripHtmlText(html));
  return (
    text.includes(normalizeSeerahText("سيرة ابن هشام")) &&
    text.includes(normalizeSeerahText("عبد الملك بن هشام"))
  );
}

function parseSeerahRecord(
  html: string,
  parentId: number,
  url: string,
): RetrievedEvidence | null {
  const decoded = decodeHtmlEntities(html);
  const pageTitle = stripHtmlText(
    decoded.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "",
  );
  if (!normalizeSeerahText(pageTitle).includes(normalizeSeerahText("السيرة النبوية"))) {
    return null;
  }

  const excerpt = getElementContents(decoded, "divMainContent")
    .map(stripHtmlText)
    .sort((left, right) => right.length - left.length)[0];
  if (!excerpt || excerpt.length < 40) return null;

  const volumeAndPage = excerpt.match(/\[(\d+)\s*\/\s*(\d+)\]/u);
  const heading = excerpt.match(/^\s*\[([^\]]{3,220})\]/u)?.[1]?.trim();
  const locatorParts = ["السيرة النبوية لابن هشام"];
  if (heading) locatorParts.push(`باب: ${heading}`);
  if (volumeAndPage) {
    locatorParts.push(`المجلد ${volumeAndPage[1]}، الصفحة ${volumeAndPage[2]}`);
  }

  return {
    id: `alifta-seerah-${BOOK_ID}-${parentId}`,
    sourceId: "alifta-ibn-hisham-seerah",
    sourceTitle: "السيرة النبوية لابن هشام",
    sourceType: "seerah",
    sourceName: ALIFTA_SOURCE_NAME,
    sourceVersion: "HadithWeb online record",
    reference: locatorParts.join("، "),
    excerpt: excerpt.slice(0, 8_000),
    url,
    edition: "النص المعروض في HadithWeb",
    retrievedAt: new Date().toISOString(),
    sourceDomain: "sunna.alifta.gov.sa",
    sourceProvider: PROVIDER_ID,
    pageTitle,
    sourceMetadataStatus: "verified",
  };
}

function sourceUnavailable(reason: string) {
  return { status: "unavailable" as const, evidence: [], reason };
}

function sourceNoResults() {
  return { status: "no_results" as const, evidence: [], reason: "no_results" };
}

export function createIbnHishamSeerahProvider(
  fetcher: typeof fetch = fetch,
): EvidenceProvider {
  return {
    id: PROVIDER_ID,
    supports: (claim) => claim.domain === "السيرة",
    async retrieve(claim) {
      const tokens = topicTokens(claim.text);
      if (tokens.length === 0) return sourceNoResults();

      try {
        const budget = createSourceRequestBudget(18_000, 16);
        const details = await requestAliftaHtml(
          fetcher,
          `${ALIFTA_ORIGIN}/Book/Details?bookId=${BOOK_ID}`,
          budget,
        );
        if (!metadataConfirmsIbnHisham(details.html)) {
          return sourceUnavailable("book_identity_unverified");
        }

        const root = await requestAliftaHtml(
          fetcher,
          `${ALIFTA_ORIGIN}/BookToc/ViewBookTocLevel?BookId=${BOOK_ID}&ParentId=0&IsLeaf=False`,
          budget,
        );
        const rootNodes = parseTocChildren(root.html, 0);
        const evidence: RetrievedEvidence[] = [];

        const walk = async (
          nodes: readonly TocNode[],
          depth: number,
        ): Promise<void> => {
          if (depth > MAX_DEPTH || evidence.length > 0) return;
          for (const node of rankedNodes(nodes, tokens)) {
            if (budget.requests >= budget.maxRequests || Date.now() >= budget.deadlineAt) {
              return;
            }

            if (node.isLeaf) {
              const leafUrl = new URL(
                `/BookToc/ViewBookTocLevel?BookId=${BOOK_ID}&ParentId=${node.id}&IsLeaf=True`,
                ALIFTA_ORIGIN,
              );
              const page = await requestAliftaHtml(fetcher, leafUrl, budget);
              const record = parseSeerahRecord(
                page.html,
                node.id,
                leafUrl.toString(),
              );
              const minimumTitleMatches = Math.min(2, tokens.length);
              if (
                record &&
                nodeScore(node, tokens) >= minimumTitleMatches &&
                nodeScore({ ...node, text: record.excerpt ?? "" }, tokens) > 0
              ) {
                evidence.push(record);
                return;
              }
              continue;
            }

            const sectionUrl = new URL(
              `/BookToc/ViewBookTocLevel?BookId=${BOOK_ID}&ParentId=${node.id}&IsLeaf=False`,
              ALIFTA_ORIGIN,
            );
            const section = await requestAliftaHtml(fetcher, sectionUrl, budget);
            const children = parseTocChildren(section.html, node.id);
            await walk(children, depth + 1);
            if (evidence.length > 0) return;
          }
        };

        await walk(rootNodes, 1);
        return evidence.length
          ? { status: "available", evidence }
          : sourceNoResults();
      } catch {
        return sourceUnavailable("provider_error");
      }
    },
  };
}

export const ibnHishamSeerahProvider = createIbnHishamSeerahProvider();
