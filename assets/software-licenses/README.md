# Supplemental license texts

The build inventories the modules actually included by esbuild/Vite. It retains package license files and fails if an included package has no notice, unless the exact supplemental mapping in scripts/licenses.mjs resolves it.

- Radix MIT text: upstream root LICENSE at commit3c5e05fab070dfa68212230e85baf0879269c57d, the registry gitHead for @radix-ui/primitive1.1.1. Radix packages declare MIT and share the monorepo notice.
- Fastdom1.0.12: full license section extracted from its published README.md, retaining Wilson Page's copyright.
- react-remove-scroll-bar2.3.8: published package declares MIT but omits the license file; full upstream notice retained from upstream commit8ca9ba5ea52de03308fe8ced94f7b159a44d28ff. Registry gitHead for2.3.8 is not reachable upstream. This notice's provenance is distinct from an exact source-reproducibility claim for2.3.8.

Bundled output includes dist/dependency-inventory.json and dist/THIRD_PARTY_LICENSES.txt. Electron's runtime notices remain in the native distribution.
