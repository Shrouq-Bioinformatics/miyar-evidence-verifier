# Tanzil Quran source data

This directory contains the official Tanzil Project Quran text and metadata
used by Miyar's read-only Quran evidence search.

## Source files

- `text-v1.1/quran-simple-clean.txt` is Tanzil Quran Text **Simple Clean**,
  version **1.1**. Tanzil describes Simple Clean as text without diacritics or
  symbols and suitable for easy search. The numbered text rows use Tanzil's
  `surah|ayah|text` format. The downloaded file is kept byte-for-byte, including
  Tanzil's embedded copyright notice.
- `metadata-v1.0/quran-data.xml` is Tanzil's official Quran Metadata, version
  **1.0**, preserved byte-for-byte. Its Arabic surah names and verse counts are
  combined with the numbered text rows when the API loads its in-memory search
  records.

The text is stored and displayed exactly as supplied by Tanzil. Arabic search
normalization is held only in a separate in-memory matching index; it is never
written back to either source file or returned as verse text.

## Tanzil attribution and license

Text source: [Tanzil Project](https://tanzil.net/)  
Text download: <https://tanzil.net/pub/download/index.php?quranType=simple-clean&outType=txt-2&agree=true>  
Metadata source: <https://tanzil.net/res/text/metadata/quran-data.xml>  
Text version and download details: <https://tanzil.net/download/>  
Metadata documentation: <https://tanzil.net/docs/Quran_Metadata>  
License: <https://tanzil.net/docs/Text_License>

No endorsement by Tanzil of Miyar is stated or implied.

The following copyright and license notice is reproduced from Tanzil's Text
License page:

```text
  Tanzil Quran Text
  Copyright (C) 2007-2021 Tanzil Project
  License: Creative Commons Attribution 3.0

  This copy of the Quran text is carefully produced, highly
  verified and continuously monitored by a group of specialists
  in Tanzil Project.

  TERMS OF USE:

  - Permission is granted to copy and distribute verbatim copies
    of this text, but CHANGING IT IS NOT ALLOWED.

  - This Quran text can be used in any website or application,
    provided that its source (Tanzil Project) is clearly indicated,
    and a link is made to tanzil.net to enable users to keep
    track of changes.

  - This copyright notice shall be included in all verbatim copies
    of the text, and shall be reproduced appropriately in all files
    derived from or containing substantial portion of this text.

  Please check updates at: http://tanzil.net/updates/
```

The metadata XML retains its own Tanzil copyright and `cc-by` license
attributes in the original file header.

## Integrity checks

The source files were downloaded only from `tanzil.net` and copied without
modification. SHA-256:

- Simple Clean text: `228df2a717671aeb9d2ff573002bd28d6b3f973f4bc7153554e3a81663d67610`
- Metadata XML: `8867c1d88191472adec9db694b3cd9f135b1a2ef580574d32cf888dcb22c5c7a`

The API validates the metadata version, 114 surahs, 6,236 sequential verses,
and per-surah verse counts when loading the corpus. A missing or invalid
official source file causes startup to fail rather than silently substituting
another dataset.