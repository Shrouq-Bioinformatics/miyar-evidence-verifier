// Adapted from the tested provider suite in:
// https://github.com/Shrouq-Bioinformatics/miyar-evidence-verifier
// MIT-licensed; see ../data/upstream-miyar/LICENSE.
import assert from "node:assert/strict";
import { test } from "node:test";
import { retrieveEvidence } from "../src/lib/evidence";
import {
  QURANENC_TAFSIR_EDITION,
  retrieveLocalQuranAndTafsir,
  retrieveQuranEncTafsirEvidence,
} from "../src/lib/quranenc-tafsir";

const QURAN_255_TEXT = "اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ";
const TAFSIR_255_TEXT =
  "الله سبحانه هو المعبود بحق، الحي الذي لا يموت، القائم على شؤون خلقه.";

function apiPayload(
  sura: string | number = "2",
  aya: string | number = "255",
  translation = TAFSIR_255_TEXT,
) {
  return {
    result: {
      id: "262",
      sura,
      aya,
      arabic_text: QURAN_255_TEXT,
      translation,
      footnotes: [],
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("QuranEnc tafsir is separate evidence with exact edition and verse reference", async () => {
  const quran = retrieveEvidence("2:255").find(
    (item) => item.id === "quran-2-255",
  );
  assert.ok(quran);
  let requestedUrl = "";
  const fetcher: typeof fetch = async (input) => {
    requestedUrl = String(input);
    return jsonResponse(apiPayload());
  };

  const result = await retrieveQuranEncTafsirEvidence([quran], {
    retrievedAt: "2026-09-25T00:00:00.000Z",
    fetcher,
  });
  assert.equal(result.status, "available");
  assert.equal(result.evidence.length, 1);
  const tafsir = result.evidence[0];
  assert.ok(tafsir);
  assert.equal(
    requestedUrl,
    "https://quranenc.com/api/v1/translation/aya/arabic_mokhtasar/2/255",
  );
  assert.equal(tafsir.sourceType, "tafsir");
  assert.notEqual(tafsir.sourceType, "quran");
  assert.equal(tafsir.sourceName, "QuranEnc");
  assert.equal(tafsir.sourceProvider, "QuranEnc");
  assert.equal(tafsir.sourceDomain, "quranenc.com");
  assert.equal(tafsir.edition, "المختصر في تفسير القرآن الكريم");
  assert.equal(tafsir.edition, QURANENC_TAFSIR_EDITION);
  assert.equal(tafsir.surahNumber, 2);
  assert.equal(tafsir.surahName, "البقرة");
  assert.equal(tafsir.ayahNumber, 255);
  assert.equal(tafsir.tafsirText, TAFSIR_255_TEXT);
  assert.equal(
    tafsir.url,
    "https://quranenc.com/ar/browse/arabic_mokhtasar/2/255",
  );
  assert.equal(tafsir.retrievedAt, "2026-09-25T00:00:00.000Z");
  assert.match(tafsir.id, /^tafsir-[0-9a-f-]{36}$/u);
  assert.equal("sourceVersion" in tafsir, false);
  assert.equal(quran.sourceType, "quran");
  assert.ok(quran.excerpt);
  assert.notEqual(quran.excerpt, tafsir.tafsirText);
});

test("an explicit named Arabic verse reference retrieves local Quran and matching tafsir", async () => {
  let requests = 0;
  const result = await retrieveLocalQuranAndTafsir(
    "تفسير سورة البقرة آية 255",
    {
      fetcher: async () => {
        requests += 1;
        return jsonResponse(apiPayload());
      },
    },
  );

  assert.equal(requests, 1);
  assert.ok(result.localEvidence.some((item) => item.id === "quran-2-255"));
  assert.equal(result.tafsir.status, "available");
  assert.equal(result.tafsir.evidence[0]?.surahNumber, 2);
  assert.equal(result.tafsir.evidence[0]?.ayahNumber, 255);
});

test("Ayat al-Kursi meaning requests resolve to local Quran and matching tafsir", async () => {
  for (const claim of [
    "ما معنى آية الكرسي؟",
    "What is the meaning of Ayat al-Kursi?",
  ]) {
    const result = await retrieveLocalQuranAndTafsir(claim, {
      fetcher: async () => jsonResponse(apiPayload()),
    });

    assert.ok(result.localEvidence.some((item) => item.id === "quran-2-255"));
    assert.equal(result.tafsir.status, "available");
    assert.equal(result.tafsir.evidence[0]?.surahNumber, 2);
    assert.equal(result.tafsir.evidence[0]?.ayahNumber, 255);
  }
});

test("QuranEnc failure leaves local Quran evidence available and does not throw", async () => {
  const result = await retrieveLocalQuranAndTafsir("ما معنى 2:255؟", {
    fetcher: async () => {
      throw new TypeError("network unavailable");
    },
  });

  assert.ok(result.localEvidence.some((item) => item.id === "quran-2-255"));
  assert.equal(result.tafsir.status, "unavailable");
  assert.deepEqual(result.tafsir.evidence, []);
});

test("unrelated claims do not trigger QuranEnc and malformed or mismatched records are rejected", async () => {
  let requests = 0;
  const unrelated = await retrieveLocalQuranAndTafsir(
    "The Eiffel Tower is in Paris.",
    {
      fetcher: async () => {
        requests += 1;
        return jsonResponse(apiPayload());
      },
    },
  );
  assert.equal(requests, 0);
  assert.equal(unrelated.tafsir.status, "no_results");
  assert.equal(
    unrelated.localEvidence.some((item) => item.sourceType === "quran"),
    false,
  );

  const quran = retrieveEvidence("2:255").find(
    (item) => item.id === "quran-2-255",
  );
  assert.ok(quran);
  const mismatched = await retrieveQuranEncTafsirEvidence([quran], {
    fetcher: async () => jsonResponse(apiPayload("2", "256")),
  });
  assert.equal(mismatched.status, "unavailable");
  assert.deepEqual(mismatched.evidence, []);
});
