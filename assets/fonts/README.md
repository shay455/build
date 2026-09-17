# Fonts

`DejaVuSans.ttf` and `DejaVuSans-Bold.ttf` are vendored here so the property
report renders identically on any machine, rather than depending on whichever
fonts the host happens to have installed.

DejaVu was chosen because it carries, in one file, everything the report needs:
the full Hebrew block including final forms and geresh/gershayim, Latin digits,
and the shekel sign (U+20AA). A subsetted webfont splits Hebrew and Latin into
separate files, which would leave the digits missing from a Hebrew document.

DejaVu Fonts are released under a permissive licence derived from the Bitstream
Vera Fonts Copyright and the Arev Fonts Copyright. See `LICENSE`.
