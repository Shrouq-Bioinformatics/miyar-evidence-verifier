import type { EvidenceProvider } from "./evidence-provider";
import { retrieveLocalQuranAndTafsir } from "./quranenc-tafsir";

export function createQuranEncTafsirProvider(
  fetcher: typeof fetch = fetch,
): EvidenceProvider {
  return {
    id: "quranenc-arabic-mokhtasar-tafsir",
    supports: (claim) => claim.domain === "التفسير",
    async retrieve(claim) {
      try {
        const result = await retrieveLocalQuranAndTafsir(claim.text, {
          fetcher,
        });
        return {
          status: result.tafsir.status,
          evidence: result.tafsir.evidence,
          reason: result.tafsir.reason,
        };
      } catch {
        return {
          status: "unavailable",
          evidence: [],
          reason: "provider_error",
        };
      }
    },
  };
}

export const quranEncTafsirProvider = createQuranEncTafsirProvider();
