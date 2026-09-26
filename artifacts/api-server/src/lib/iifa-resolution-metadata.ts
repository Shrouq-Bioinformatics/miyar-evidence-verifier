export type IifaResolutionMetadata = {
  pageTitle?: string;
  resolutionNumber?: string;
  sessionDate?: string;
  topic?: string;
};

const invisibleCharacters = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const maxMetadataFieldLength = 280;

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (entity, decimal: string) => {
      const codePoint = Number(decimal);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
    })
    .replace(/&#x([0-9a-f]+);/gi, (entity, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
    .replace(/&rsquo;/gi, "’")
    .replace(/&lsquo;/gi, "‘")
    .replace(/&rdquo;/gi, "”")
    .replace(/&ldquo;/gi, "“");
}

function cleanHtmlText(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(invisibleCharacters, "")
    .replace(/\s+/g, " ")
    .trim();
}

function boundedText(value: string | undefined, maxLength = maxMetadataFieldLength) {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maxLength) : undefined;
}

function readAttribute(tag: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(
    new RegExp(`\\b${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  const rawValue = match?.[1] ?? match?.[2] ?? match?.[3];
  return rawValue ? decodeHtmlEntities(rawValue).trim() : undefined;
}

function readMetaContent(
  html: string,
  key: string,
): string | undefined {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const name = readAttribute(tag, "name")?.toLowerCase();
    const property = readAttribute(tag, "property")?.toLowerCase();
    if (name !== key.toLowerCase() && property !== key.toLowerCase()) continue;
    const content = readAttribute(tag, "content");
    if (content) return content;
  }
  return undefined;
}

function elementTexts(html: string, tagName: string): string[] {
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(
    `<${escapedTag}\\b[^>]*>([\\s\\S]*?)<\\/${escapedTag}\\s*>`,
    "gi",
  );
  return Array.from(html.matchAll(expression), (match) => cleanHtmlText(match[1] ?? ""))
    .filter(Boolean);
}

function classElementText(
  html: string,
  tagName: string,
  className: string,
): string | undefined {
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(
    `<${escapedTag}\\b([^>]*)>([\\s\\S]*?)<\\/${escapedTag}\\s*>`,
    "gi",
  );
  for (const match of html.matchAll(expression)) {
    const classes = readAttribute(match[1] ?? "", "class")?.split(/\s+/) ?? [];
    if (!classes.includes(className)) continue;
    const text = cleanHtmlText(match[2] ?? "");
    if (text) return text;
  }
  return undefined;
}

function extractPageTitle(html: string): string | undefined {
  const fromOpenGraph = readMetaContent(html, "og:title");
  const fromHeading = classElementText(html, "div", "ctitle")
    ?? elementTexts(html, "h1")[0];
  const fromTitleTag = elementTexts(html, "title")[0]?.replace(
    /\s*[|–—-]\s*مجمع الفقه الإسلامي الدولي\s*$/u,
    "",
  );
  return boundedText(fromOpenGraph ? cleanHtmlText(fromOpenGraph) : fromHeading ?? fromTitleTag, 220);
}

function extractResolutionNumber(html: string, pageTitle?: string): string | undefined {
  const headingTexts = Array.from(
    html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi),
    (match) => cleanHtmlText(match[2] ?? ""),
  );
  const leadParagraphs = elementTexts(html, "p").filter((text) =>
    /^(?:resolution|decision)\s+(?:no\.?\s+|number\s*)|^قرار\s*(?:رقم)?/iu.test(text),
  );
  const candidates = [...headingTexts, pageTitle ?? "", ...leadParagraphs];
  const numberPatterns = [
    /قرار\s*(?:رقم)?\s*[:：]?\s*([0-9٠-٩]{1,4}\s*[（(]\s*[0-9٠-٩]{1,2}\s*\/\s*[0-9٠-٩]{1,2}\s*[）)])/u,
    /\b(?:resolution|decision)\s+(?:no\.?|number)\s*[:：#]?\s*([0-9]{1,4}\s*\(\s*[0-9]{1,2}\s*\/\s*[0-9]{1,2}\s*\))/iu,
  ];
  for (const candidate of candidates) {
    for (const numberPattern of numberPatterns) {
      const match = candidate.match(numberPattern);
      if (match?.[1]) return boundedText(match[1], 60);
    }
  }
  return undefined;
}

function extractSessionDate(html: string): string | undefined {
  for (const paragraph of elementTexts(html, "p")) {
    if (paragraph.includes("المنعقد")) {
      const sessionMarker = /(?:دورة مؤتمره|دورة مؤتمرها|دورته|دورتها)/u.exec(paragraph);
      if (sessionMarker?.index !== undefined) {
        let session = paragraph.slice(sessionMarker.index);
        const endMarker = /(?:؛|;|،\s*(?:وبعد|بعد|ثم)|\.\s)/u.exec(session);
        if (endMarker?.index !== undefined) session = session.slice(0, endMarker.index);
        if (/[0-9٠-٩]{3,4}\s*(?:هـ|ه|م)/u.test(session)) {
          return boundedText(session, maxMetadataFieldLength);
        }
      }
    }

    const englishMarker = /\b(?:holding|held)\s+(?:its|the)\s+/iu.exec(paragraph);
    if (englishMarker?.index !== undefined) {
      const session = paragraph.slice(englishMarker.index);
      const datedSession = session.match(
        /^.{0,260}?\b(?:[0-9]{3,4}\s*[Hh]\b|(?:19|20)[0-9]{2}\b)(?:\s*\([^)]{0,90}\))?/iu,
      )?.[0];
      if (datedSession && /\bsession\b/iu.test(datedSession)) {
        return boundedText(datedSession, maxMetadataFieldLength);
      }
    }
  }
  return undefined;
}

function extractTaggedTopic(html: string): string | undefined {
  const topics: string[] = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const classes = readAttribute(match[1] ?? "", "class")?.split(/\s+/) ?? [];
    if (!classes.includes("metaacdtag")) continue;
    const topic = boundedText(cleanHtmlText(match[2] ?? ""), 100);
    if (topic && !topics.includes(topic)) topics.push(topic);
    if (topics.length === 3) break;
  }
  return boundedText(topics.join("، "), 180);
}

function extractTitleTopic(pageTitle?: string): string | undefined {
  if (!pageTitle) return undefined;
  const englishResolution = pageTitle.match(
    /^(?:resolution|decision)\s+(?:no\.?|number)\s*[:：#]?\s*[0-9]{1,4}\s*\([0-9]{1,2}\s*\/\s*[0-9]{1,2}\)\s+(.+)$/iu,
  );
  const arabicDecision = pageTitle.match(
    /^قرار\s*(?:(?:رقم)?\s*[:：]?\s*[0-9٠-٩]{1,4}\s*[（(][0-9٠-٩]{1,2}\s*\/\s*[0-9٠-٩]{1,2}[）)]\s*)?(?:بشأن|حول)\s+(.+)$/u,
  );
  const topic = (englishResolution?.[1] ?? arabicDecision?.[1])
    ?.split(/[:：]/u, 1)[0]
    .trim();
  return boundedText(topic, 180);
}

/**
 * Extract a small set of visible, source-authored fields only.
 * The returned object never includes page body text or HTML.
 */
export function extractIifaResolutionMetadata(html: string): IifaResolutionMetadata {
  const pageTitle = extractPageTitle(html);
  const topic = extractTaggedTopic(html) ?? extractTitleTopic(pageTitle);
  const metadata: IifaResolutionMetadata = {
    pageTitle,
    resolutionNumber: extractResolutionNumber(html, pageTitle),
    sessionDate: extractSessionDate(html),
    topic,
  };
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => typeof value === "string" && value.length > 0),
  ) as IifaResolutionMetadata;
}