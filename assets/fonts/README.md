# Agent Sans fallback

`AgentSans-Regular.woff2` is a renamed WOFF2 derivative of the official Liberation Sans 2.1.5 regular font, under the SIL Open Font License 1.1. Full terms and original copyright notices are in [AgentSans-OFL.txt](../font-licenses/AgentSans-OFL.txt).

The build copies it over the SDK's resource path `fonts/Liberation/LiberationSans-Regular.woff2` after copying other font resources. Its internal primary family is Agent Sans. Ensure the SDK's original legacy 1.05 font is absent from both public renderer resources and bundled dependency contents.

[provenance.json](provenance.json) pins the official release, archive and input/output hashes, tools, changes and metric comparison. Reproduce from the repository root in a temporary Python environment with `fonttools==4.68.0` and `brotli==1.2.1`:

```sh
python assets/fonts/prepare-font.py
```

The script validates the official archive and TTF checksums before transformation, preserves original copyright/license metadata, changes internal family/full/unique/PostScript names, compresses to WOFF2 and verifies the expected output checksum. It does not install fonts into the OS.

Printable ASCII advances and vertical `hhea` metrics match the old fallback. Two shared characters, U+00B7 and U+2012, differ in advance. Validate representative SDK fallback drawings and exports before release; this replacement is not claimed to be pixel-identical.
