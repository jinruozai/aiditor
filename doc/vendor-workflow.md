# Vendor workflow

Downstream projects (e.g. MORS Editor) consume Aiditor as a vendored browser
bundle copied from `dist/`.

- `src/` is the single point of change. Never patch a vendored bundle in a
  downstream repo; fix the source here and rebuild.
- Release to a downstream project: `npm run build`, then copy
  `dist/aiditor-full.js` and `dist/aiditor-full.css` into the downstream
  vendor directory and update its recorded SHA-256 hashes.
- `dist/` is committed so downstreams can verify hashes and so the framework
  is consumable without a build step. Every `src/` change must land together
  with its rebuilt `dist/` output.
