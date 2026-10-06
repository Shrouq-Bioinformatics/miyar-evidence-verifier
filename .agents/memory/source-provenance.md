---
name: Source provenance
description: Provider labeling and acceptance rules for MIYAR's religious evidence sources.
---

Label each provider with the exact corpus and edition it actually retrieves. A related tafsir edition must not be presented as another work, such as labeling QuranEnc's Arabic Mokhtasar as al-Tabari's Jami' al-Bayan. Generic web-search summaries are not direct source text and must not be surfaced as source excerpts under the current fixed verification response contract.

**Why:** The project's source specification requires a provider to be genuinely operational before it is shown as live and forbids implying that a different or broken source is connected.

**How to apply:** Before enabling a source card or adding provider evidence, verify the source ID, domain, edition, locator, and whether returned text is source-authored or generated. Keep unsupported named sources pending without changing the public verification envelope.

For Arabic table-of-contents sources, require a specific topical match in the entry title as well as some overlap in the direct passage; broad body-only overlap can cite a neighboring chapter.

**Why:** A live Ibn Hisham lookup initially returned a page sharing general place-name terms instead of the requested migration passage.

**How to apply:** Normalize and stem before stopword removal, score distinct query terms, and prefer a conservative no-result over a plausible but off-topic citation.
