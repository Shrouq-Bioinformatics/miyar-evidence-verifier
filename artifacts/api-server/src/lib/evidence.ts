import { existsSync, readFileSync } from "node:fs";

export type RetrievedEvidence = {
  id: string;
  sourceId: string;
  sourceTitle: string;
  sourceType: string;
  sourceName?: string;
  sourceVersion?: string;
  surahNumber?: number;
  surahName?: string;
  ayahNumber?: number;
  reference: string;
  excerpt?: string;
  tafsirText?: string;
  url: string;
  edition: string;
  retrievedAt: string;
  score?: number;
  sourceDomain?: string;
  sourceProvider?: string;
  pageTitle?: string;
  summary?: string;
  sourceSubtype?: string;
  sourceMetadataStatus?: "verified" | "unavailable";
  resolutionNumber?: string;
  sessionDate?: string;
  topic?: string;
};

type EvidenceRecord = Omit<
  RetrievedEvidence,
  "retrievedAt" | "score" | "excerpt"
> & {
  excerpt: string;
  aliases: string[];
};

const TANZIL_TEXT_VERSION = "1.1";
const TANZIL_METADATA_VERSION = "1.0";
const TANZIL_SOURCE_URL = "https://tanzil.net/";
const EXPECTED_SURAH_COUNT = 114;
const EXPECTED_VERSE_COUNT = 6236;
const MIN_QURAN_MATCHED_TOKENS = 2;
const MIN_QURAN_QUERY_COVERAGE = 0.75;

type IndexedEvidence = {
  normalizedAliases: string[];
  normalizedExcerpt: string;
  excerptTokens: Set<string>;
  quranSearchTokens: Set<string>;
};

function readTanzilFile(relativePath: string): string {
  // Tests load src/lib/evidence.ts; the API loads the bundled dist/index.mjs.
  // These paths point to the same immutable project data in both layouts.
  const candidates = [
    new URL(`../../data/${relativePath}`, import.meta.url),
    new URL(`../data/${relativePath}`, import.meta.url),
  ];
  const sourceUrl = candidates.find((candidate) => existsSync(candidate));
  if (!sourceUrl) {
    throw new Error(`Required Tanzil source file is missing: ${relativePath}`);
  }
  return readFileSync(sourceUrl, "utf8");
}

function parseXmlAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const [, name, value] of source.matchAll(
    /([A-Za-z][A-Za-z0-9_-]*)="([^"]*)"/g,
  )) {
    attributes[name] = value;
  }
  return attributes;
}

function normalizeArabic(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (digit) =>
      String(digit.charCodeAt(0) - "٠".charCodeAt(0)),
    )
    .replace(/[۰-۹]/g, (digit) =>
      String(digit.charCodeAt(0) - "۰".charCodeAt(0)),
    )
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string): string[] {
  return normalizeArabic(value)
    .split(" ")
    .filter((token) => token.length >= 3);
}

const QURAN_COMMON_WORDS = new Set(
  [
    "هو",
    "وهو",
    "هي",
    "وهي",
    "الذي",
    "والذي",
    "التي",
    "والتي",
    "الذين",
    "والذين",
    "إن",
    "أن",
    "الله",
    "لكم",
    "لهم",
    "له",
    "لها",
    "من",
    "في",
    "إلى",
    "عن",
    "على",
    "ما",
    "لا",
    "لم",
    "لن",
    "هذا",
    "هذه",
    "ذلك",
    "تلك",
    "كل",
    "قد",
    "ثم",
    "أو",
    "إذا",
    "يا",
    "كان",
    "كانت",
    "فوق",
  ].map(normalizeArabic),
);

function quranSearchTokens(value: string): string[] {
  return tokens(value).filter((token) => !QURAN_COMMON_WORDS.has(token));
}

function loadTanzilQuranEvidence(): EvidenceRecord[] {
  const sourceText = readTanzilFile(
    "tanzil-quran/text-v1.1/quran-simple-clean.txt",
  );
  const metadataXml = readTanzilFile(
    "tanzil-quran/metadata-v1.0/quran-data.xml",
  );

  const rootMatch = metadataXml.match(/<quran\b([^>]*)>/);
  const metadataVersion = rootMatch
    ? parseXmlAttributes(rootMatch[1]).version
    : undefined;
  if (metadataVersion !== TANZIL_METADATA_VERSION) {
    throw new Error(
      `Unexpected Tanzil metadata version: ${metadataVersion ?? "missing"}`,
    );
  }

  const surahs = [...metadataXml.matchAll(/<sura\b([^>]*)\/>/g)].map(
    ([, rawAttributes]) => {
      const attributes = parseXmlAttributes(rawAttributes);
      const number = Number(attributes.index);
      const verseCount = Number(attributes.ayas);
      const name = attributes.name;
      if (
        !Number.isInteger(number) ||
        !Number.isInteger(verseCount) ||
        !name
      ) {
        throw new Error("Invalid surah metadata in the official Tanzil file.");
      }
      return { number, verseCount, name };
    },
  );
  if (
    surahs.length !== EXPECTED_SURAH_COUNT ||
    surahs.some((surah, index) => surah.number !== index + 1) ||
    surahs.reduce((sum, surah) => sum + surah.verseCount, 0) !==
      EXPECTED_VERSE_COUNT
  ) {
    throw new Error("Official Tanzil surah metadata failed corpus validation.");
  }

  const surahByNumber = new Map(surahs.map((surah) => [surah.number, surah]));
  const nextAyahBySurah = new Map(surahs.map((surah) => [surah.number, 1]));
  const evidence: EvidenceRecord[] = [];

  for (const [lineIndex, line] of sourceText.split(/\r?\n/).entries()) {
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(\d+)\|(\d+)\|(.*)$/);
    if (!match) {
      throw new Error(
        `Unexpected row in the official Tanzil text at line ${lineIndex + 1}.`,
      );
    }

    const surahNumber = Number(match[1]);
    const ayahNumber = Number(match[2]);
    // Do not normalize, trim, or otherwise rewrite this source text.
    const verseText = match[3];
    const surah = surahByNumber.get(surahNumber);
    if (
      !surah ||
      !verseText ||
      nextAyahBySurah.get(surahNumber) !== ayahNumber
    ) {
      throw new Error(
        `Invalid or out-of-order Tanzil verse reference at line ${lineIndex + 1}.`,
      );
    }
    nextAyahBySurah.set(surahNumber, ayahNumber + 1);

    const aliases = [
      `${surah.name} ${ayahNumber}`,
      `Quran ${surahNumber} ${ayahNumber}`,
      `${surahNumber}:${ayahNumber}`,
    ];
    if (surahNumber === 16 && ayahNumber === 90) {
      aliases.push("العدل", "الإحسان", "يأمر بالعدل");
    }

    evidence.push({
      id: `quran-${surahNumber}-${ayahNumber}`,
      sourceId: "quran",
      sourceTitle: "Quran / القرآن الكريم",
      sourceType: "quran",
      sourceName: "Tanzil Project",
      sourceVersion: TANZIL_TEXT_VERSION,
      surahNumber,
      surahName: surah.name,
      ayahNumber,
      reference: `سورة ${surah.name} (${surahNumber})، الآية ${ayahNumber}`,
      excerpt: verseText,
      url: TANZIL_SOURCE_URL,
      edition: `Tanzil Project, Simple Clean Quran Text, version ${TANZIL_TEXT_VERSION}`,
      aliases,
    });
  }

  if (
    evidence.length !== EXPECTED_VERSE_COUNT ||
    surahs.some(
      (surah) =>
        nextAyahBySurah.get(surah.number) !== surah.verseCount + 1,
    )
  ) {
    throw new Error("Official Tanzil verse text failed corpus validation.");
  }
  return evidence;
}

const evidenceCorpus: EvidenceRecord[] = [
  ...loadTanzilQuranEvidence(),
  {
    id: "bukhari-hadith-1",
    sourceId: "bukhari",
    sourceTitle: "صحيح البخاري",
    sourceType: "حديث",
    reference: "صحيح البخاري، كتاب بدء الوحي، حديث 1",
    excerpt:
      "إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ، وَإِنَّمَا لِكُلِّ امْرِئٍ مَا نَوَى، فَمَنْ كَانَتْ هِجْرَتُهُ إِلَى اللَّهِ وَرَسُولِهِ فَهِجْرَتُهُ إِلَى اللَّهِ وَرَسُولِهِ، وَمَنْ كَانَتْ هِجْرَتُهُ لِدُنْيَا يُصِيبُهَا أَوْ امْرَأَةٍ يَنْكِحُهَا فَهِجْرَتُهُ إِلَى مَا هَاجَرَ إِلَيْهِ",
    url: "https://sunnah.com/bukhari:1",
    edition: "ترقيم محمد فؤاد عبد الباقي، نسخة الويب المرئية",
    aliases: ["الأعمال بالنيات", "إنما الأعمال", "النيات", "البخاري 1"],
  },
  {
    id: "muslim-faith-55",
    sourceId: "muslim",
    sourceTitle: "صحيح مسلم",
    sourceType: "حديث",
    reference: "صحيح مسلم، كتاب الإيمان، حديث 55",
    excerpt:
      "الدِّينُ النَّصِيحَةُ. قُلْنَا: لِمَنْ؟ قَالَ: لِلَّهِ، وَلِكِتَابِهِ، وَلِرَسُولِهِ، وَلِأَئِمَّةِ الْمُسْلِمِينَ وَعَامَّتِهِمْ",
    url: "https://sunnah.com/muslim:55",
    edition: "ترقيم محمد فؤاد عبد الباقي، نسخة الويب المرئية",
    aliases: ["الدين النصيحة", "النصيحة", "مسلم 55"],
  },
];

const quranEvidenceByReference = new Map<string, EvidenceRecord>();
const quranSurahNumberByNormalizedName = new Map<string, number>();
for (const record of evidenceCorpus) {
  if (
    record.sourceType !== "quran" ||
    typeof record.surahNumber !== "number" ||
    typeof record.ayahNumber !== "number"
  ) {
    continue;
  }
  quranEvidenceByReference.set(
    `${record.surahNumber}:${record.ayahNumber}`,
    record,
  );
  if (record.surahName) {
    quranSurahNumberByNormalizedName.set(
      normalizeArabic(record.surahName),
      record.surahNumber,
    );
  }
}

export function retrieveQuranEvidenceByReference(
  surahReference: number | string,
  ayahNumber: number,
  retrievedAt = new Date().toISOString(),
): RetrievedEvidence | null {
  const numericSurah =
    typeof surahReference === "number"
      ? surahReference
      : Number(surahReference.trim());
  const surahNumber = Number.isSafeInteger(numericSurah) && numericSurah > 0
    ? numericSurah
    : typeof surahReference === "string"
      ? quranSurahNumberByNormalizedName.get(normalizeArabic(surahReference))
      : undefined;

  if (
    surahNumber === undefined ||
    surahNumber > EXPECTED_SURAH_COUNT ||
    !Number.isSafeInteger(ayahNumber) ||
    ayahNumber < 1
  ) {
    return null;
  }

  const record = quranEvidenceByReference.get(`${surahNumber}:${ayahNumber}`);
  if (!record) return null;
  const { aliases: _aliases, ...publicRecord } = record;
  return { ...publicRecord, retrievedAt };
}

const searchIndex = new WeakMap<EvidenceRecord, IndexedEvidence>();
for (const record of evidenceCorpus) {
  searchIndex.set(record, {
    normalizedAliases: record.aliases.map(normalizeArabic).filter(Boolean),
    normalizedExcerpt: normalizeArabic(record.excerpt),
    excerptTokens: new Set(tokens(record.excerpt)),
    quranSearchTokens: new Set(quranSearchTokens(record.excerpt)),
  });
}

export function retrieveEvidence(
  claim: string,
  retrievedAt = new Date().toISOString(),
): RetrievedEvidence[] {
  const claimText = normalizeArabic(claim);
  const claimTokens = new Set(tokens(claim));
  const quranClaimTokens = new Set(quranSearchTokens(claim));
  return evidenceCorpus
    .map((record) => {
      const indexed = searchIndex.get(record);
      if (!indexed) {
        throw new Error(`Missing search index for evidence record ${record.id}.`);
      }
      const aliasMatches = indexed.normalizedAliases.filter((alias) =>
        claimText.includes(alias),
      ).length;
      const tokenMatches = [...claimTokens].filter((token) =>
        indexed.excerptTokens.has(token),
      ).length;
      const quranTokenMatches = [...quranClaimTokens].filter((token) =>
        indexed.quranSearchTokens.has(token),
      ).length;
      const quranQueryCoverage =
        quranClaimTokens.size > 0
          ? quranTokenMatches / quranClaimTokens.size
          : 0;
      const legacyScore =
        Math.min(aliasMatches, 1) * 0.7 +
        Math.min(tokenMatches / 5, 1) * 0.3;
      const exactQuranPhrase =
        record.sourceType === "quran" &&
        quranClaimTokens.size >= MIN_QURAN_MATCHED_TOKENS &&
        claimText.length >= 8 &&
        indexed.normalizedExcerpt.includes(claimText)
          ? 1
          : 0;
      const quranOverlapScore =
        record.sourceType === "quran" &&
        quranClaimTokens.size >= MIN_QURAN_MATCHED_TOKENS &&
        quranTokenMatches >= MIN_QURAN_MATCHED_TOKENS &&
        quranQueryCoverage >= MIN_QURAN_QUERY_COVERAGE
          ? 0.75 * quranQueryCoverage +
            (0.25 * quranTokenMatches) /
              Math.max(indexed.quranSearchTokens.size, 1)
          : 0;
      const score =
        record.sourceType === "quran"
          ? Math.max(
              Math.min(aliasMatches, 1) * 0.7,
              exactQuranPhrase,
              quranOverlapScore,
            )
          : legacyScore;
      return { record, score: Number(score.toFixed(3)) };
    })
    .filter((item) => item.score >= 0.35)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map(({ record, score }) => {
      const { aliases: _aliases, ...publicRecord } = record;
      return { ...publicRecord, retrievedAt, score };
    });
}

export function evidenceCatalog(): Omit<EvidenceRecord, "aliases">[] {
  return evidenceCorpus.map(({ aliases: _aliases, ...record }) => record);
}