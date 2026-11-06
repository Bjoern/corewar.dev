# Agent notes

## JavaScript runtime: Deno, not Node.js

Node.js is not installed on the development machine; Deno is. Run the project's scripts and
tests with Deno wherever the docs say `node`:

```bash
deno run -A docs/test-evolver.mjs
```

- `node docs/x.mjs` in README.md and elsewhere means `deno run -A docs/x.mjs`.
- Deno runs the plain test scripts as they are (they use `node:` built-ins, which Deno supports),
  for example `test-evolver`, `test-engine`, `test-optimizer`, `test-hill-scores` and `test-benchmarks`.
- Keep new scripts runnable on both: ES modules, `node:` specifiers for built-ins, no CommonJS `require`.
- Don't install Node.js or switch scripts to Node-only APIs to make something run.
- The browser tests that drive Playwright have not been tried under Deno yet. They need Playwright
  installed first; ask before installing it.

The site build and the preview server use Python: `python scripts/build.py`, then the `docs`
entry in `.claude/launch.json`.

## Sitemap

`docs/sitemap.xml` lists every public page of the site. When you add, rename or remove a
top-level `.html` page in `docs/`, update the sitemap in the same change. App modes reached by
`#fragments` (Battle, Tournaments, the reference and about views inside the app) don't need entries,
since search engines treat them as the same page.
