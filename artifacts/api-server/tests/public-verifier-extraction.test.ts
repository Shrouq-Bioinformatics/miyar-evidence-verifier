import assert from "node:assert/strict";
import { test } from "node:test";
import { splitCompoundClaimText } from "../src/lib/public-verifier";

const compoundQuranTafsirClaim =
  "ورد في سورة الحجرات، الآية 13 أن الله جعل الناس شعوبًا وقبائل ليتعارفوا، ويفسر المختصر هذه الآية بأنها تثبت أفضلية قبيلة معينة على بقية الناس.";

test("splits a Quran claim from an independent tafsir claim and resolves its ayah reference", () => {
  const claims = splitCompoundClaimText(compoundQuranTafsirClaim, "القرآن");

  assert.equal(claims.length, 2);
  assert.equal(
    claims[0]?.text,
    "ورد في سورة الحجرات، الآية 13 أن الله جعل الناس شعوبًا وقبائل ليتعارفوا",
  );
  assert.match(claims[1]?.text ?? "", /الآية 13 من سورة الحجرات/u);
  assert.doesNotMatch(claims[1]?.text ?? "", /هذه الآية/u);
  assert.equal(claims[0]?.domain, "القرآن");
  assert.equal(claims[1]?.domain, "التفسير");
});

test("keeps one Quran proposition with coordinated details as one claim", () => {
  const text =
    "ورد في سورة النحل، الآية 90 الأمر بالعدل والإحسان والنهي عن الفحشاء والمنكر والبغي.";

  const claims = splitCompoundClaimText(text, "القرآن");

  assert.equal(claims.length, 1);
  assert.equal(claims[0]?.text, text);
});

test("splits the Ibn Hisham attribution from the independent authentication conclusion", () => {
  const claims = splitCompoundClaimText(
    "ذكر ابن هشام خبر الهجرة، ومجرد ذكره للرواية يثبت صحتها حديثيًا.",
    "السيرة",
  );

  assert.equal(claims.length, 2);
  assert.match(claims[0]?.text ?? "", /ابن هشام/u);
  assert.match(claims[1]?.text ?? "", /ذكر ابن هشام للرواية/u);
  assert.equal(claims[0]?.domain, "السيرة");
  assert.equal(claims[1]?.domain, "الحديث");
});

test("retains the hadith text and collection when splitting an explicit number assertion", () => {
  const claims = splitCompoundClaimText(
    "حديث «إنما الأعمال بالنيات» رواه البخاري في صحيحه، ورقمه 999999.",
    "الحديث",
  );

  assert.equal(claims.length, 2);
  assert.doesNotMatch(claims[0]?.text ?? "", /999999/u);
  assert.match(
    claims[1]?.text ?? "",
    /حديث «إنما الأعمال بالنيات» رواه البخاري في صحيحه برقم 999999/u,
  );
  assert.equal(claims[1]?.domain, "الحديث");
});

test("recognizes the requested Arabic independent-clause separators", () => {
  const first = "ورد في سورة الحجرات، الآية 13 ذكرٌ محدد";
  const second = "يفسر المختصر هذه الآية بأنها ذات دلالة مستقلة.";

  for (const separator of ["؛ ", "، كما أن ", " بينما ", " ثم "]) {
    const claims = splitCompoundClaimText(
      `${first}${separator}${second}`,
      "القرآن",
    );
    assert.equal(claims.length, 2, `separator ${separator.trim()}`);
  }
});

test("does not split period-separated claims inside the compound-clause helper", () => {
  const modelClaims = [
    "ورد في سورة الحجرات، الآية 13 ذكرٌ محدد.",
    "حديث «إنما الأعمال بالنيات» رواه البخاري برقم 1.",
  ];

  const claims = modelClaims.flatMap((text, index) =>
    splitCompoundClaimText(text, index === 0 ? "القرآن" : "الحديث"),
  );

  assert.equal(claims.length, 2);
});
