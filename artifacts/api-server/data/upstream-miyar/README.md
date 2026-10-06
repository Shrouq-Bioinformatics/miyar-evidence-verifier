# Imported MIYAR provider

The QuranEnc tafsir retrieval implementation and its provider tests were
adapted from
[Shrouq-Bioinformatics/miyar-evidence-verifier](https://github.com/Shrouq-Bioinformatics/miyar-evidence-verifier).
The upstream repository is MIT-licensed; its license is preserved in this
directory.

The imported provider retrieves **المختصر في تفسير القرآن الكريم** from
QuranEnc for a matching Quran verse. It is not جامع البيان للطبري, and the
application identifies it as QuranEnc rather than attributing it to al-Tabari.
