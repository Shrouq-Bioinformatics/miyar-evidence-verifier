import type { EvidenceProvider } from "./evidence-provider";
import { aliftaHadithProvider } from "./alifta-hadith-provider";
import { ibnHishamSeerahProvider } from "./ibn-hisham-seerah-provider";
import { quranEncTafsirProvider } from "./quranenc-tafsir-provider";

export const evidenceProviders: readonly EvidenceProvider[] = [
  quranEncTafsirProvider,
  aliftaHadithProvider,
  ibnHishamSeerahProvider,
];
