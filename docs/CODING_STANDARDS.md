# Coding standards

Last reviewed: 2026-10-05.

The rules code in this repository follows. Where a tool decides, the tool wins; CI runs
the tools on every pull request ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)).
Run them before pushing:

```bash
(cd server && mix format && mix credo && mix compile --warnings-as-errors)
npm run lint
```

[CONTRIBUTING.md](../CONTRIBUTING.md) has the rules that protect users; they apply to every
language below.

## Elixir (`server/`)

- **Layout** is whatever `mix format` produces ([`server/.formatter.exs`](../server/.formatter.exs)).
  CI fails on unformatted code.
- **Credo** ([`server/.credo.exs`](../server/.credo.exs)) decides the rest; CI runs `mix credo`
  and fails on any issue. Strict mode (`mix credo --strict`) is planned in slice
  [02](../slices/02-test-harness-and-ci/SPEC.md)'s addition.
- **No compiler warnings**: CI compiles with `--warnings-as-errors`, on the oldest and the
  newest Elixir it supports.
- Where both are silent, follow the community
  [Elixir Style Guide](https://github.com/christopheradams/elixir_style_guide).
- Project rules:
  - Settings are read only through `Kotiko.Config`; a new setting is added there, to
    [`config/runtime.exs`](../server/config/runtime.exs) and to
    [docs/reference/configuration.md](reference/configuration.md) (a test checks all three).
  - A new route is added to [docs/reference/http-api.md](reference/http-api.md) in the same
    pull request (a test checks it).
  - No user text in logs above debug level: no words, page text, keys or tokens.
  - Code that makes HTTP requests takes `req_options`, so tests can stub it with
    `Req.Test` (`Kotiko.LLM.Client` and `Kotiko.Telegram` do). Tests never reach the
    network.
  - A secret is never echoed in an error message.

## JavaScript (`extension/`, `test/`, `scripts/`, `spec/tools/`)

- **ESLint** ([`eslint.config.js`](../eslint.config.js)) with the recommended rules plus
  `eslint-plugin-no-unsanitized`, and `web-ext lint` for the extension. `npm run lint` must
  pass. There is no JavaScript formatter yet (Prettier is proposed in slice
  [53](../slices/53-openssf-best-practices/SPEC.md), open question 4); until then follow
  [`.editorconfig`](../.editorconfig) (two spaces, LF, UTF-8) and the surrounding code:
  double quotes and semicolons.
- **This section is the JavaScript style guide** for the extension:
  - Classic scripts, no modules and no bundler. Each file attaches one namespace to
    `globalThis` (for example `KotikoI18n`), and pure modules also export themselves when
    `module` exists, so Node tests can load them.
  - No runtime npm code in `extension/`: what is in the folder is what ships, so store
    reviewers can read it.
  - Build DOM with `textContent` and DOM methods only, never HTML strings (`innerHTML`,
    `outerHTML`, `insertAdjacentHTML` are banned by ESLint).
  - Every user-facing string goes through the i18n helper `t()`
    ([`extension/lib/i18n.js`](../extension/lib/i18n.js)) and lives in
    `extension/_locales/en/messages.json`; other locales are optional.
  - Errors travel as codes (slice [25](../slices/25-plain-language-errors/SPEC.md)) and
    become words only in the interface.
- Node scripts (`*.mjs`) are ES modules with no dependencies unless they are dev tools.

## Shell (`server/*.sh`)

- **ShellCheck** clean; CI runs it.
- Start with `set -euo pipefail`; quote every expansion.
- Where ShellCheck is silent, follow the
  [Google Shell Style Guide](https://google.github.io/styleguide/shellguide.html).

## HTML and CSS (`extension/`)

- Colours, spacing and type come from the design system's tokens
  ([`extension/ui/tokens.css`](../extension/ui/tokens.css), slice
  [06](../slices/06-design-system/SPEC.md)), not literal values. `node
  extension/ui/tools/contrast.mjs` checks every text and control colour pair against WCAG
  2.2 AA in both themes.
- No inline scripts and no event-handler attributes (`onclick="..."`); scripts are files,
  wired up with `addEventListener`.
- Layouts use logical properties (`margin-inline-start`), so right-to-left text works.

## Markdown

- Plain language, short sentences, no emojis. Wrap prose at about 90 characters.
- Specs follow [`slices/TEMPLATE.md`](../slices/TEMPLATE.md).
- New files carry an SPDX header, or are covered by [`REUSE.toml`](../REUSE.toml)
  (Markdown is); `pipx run reuse lint` checks it.

## Every language

- Slice [50](../slices/50-ui-localization-and-base-language/SPEC.md) section 7's
  cross-cutting rules: no English-named base concepts in code (`gloss`, `base_lang`, never
  `english`; `scripts/check-base-neutral.mjs` checks it), language names from `Intl`, never
  assuming spaces between words, per-language rules as data in `spec/lang/`, locale-aware
  text handling. Its rule 13 (public text in English and Spanish) is replaced by
  [DECISIONS 2026-10-05](../slices/DECISIONS.md): English is required, other languages are
  optional.
- The project's old names are not used outside history (`scripts/check-old-name.mjs`).

## Commits and pull requests

Conventional Commits, as described in [CONTRIBUTING.md](../CONTRIBUTING.md#commits-and-pull-requests).
