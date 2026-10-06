# Coding standards

Last reviewed: 2026-10-06.

The rules code in this repository follows. Where a tool decides, the tool wins; CI runs
the tools on every pull request ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)).
Run them before pushing:

```bash
(cd server && mix format && mix credo --strict && mix compile --warnings-as-errors)
npm run lint        # npm run lint:fix applies the JavaScript layout for you
```

[CONTRIBUTING.md](../CONTRIBUTING.md) has the rules that protect users; they apply to every
language below.

## Elixir (`server/`)

- **Layout** is whatever `mix format` produces ([`server/.formatter.exs`](../server/.formatter.exs)).
  CI fails on unformatted code.
- **Credo in strict mode** ([`server/.credo.exs`](../server/.credo.exs)) decides the rest:
  its default checks, low-priority ones included (for example: a nested module called by
  its full name gets an alias at the top; aliases in alphabetical order). The config sets
  `strict: true`, so a plain `mix credo` reports what CI's `mix credo --strict` reports, and
  CI fails on any issue. A check is switched off in code (`# credo:disable-for-next-line`)
  only with a comment saying why; there are none today.
- **No compiler warnings**: CI compiles with `--warnings-as-errors`, on the oldest and the
  newest Elixir it supports, and runs the tests with `mix test --warnings-as-errors`, so a
  warning in a test file fails too.
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

- **ESLint** ([`eslint.config.js`](../eslint.config.js)) decides, and `npm run lint` must
  pass (CI runs it on every pull request; any finding is an error, there are no
  warnings). It checks four things:
  - **Correctness**: ESLint's recommended rules, plus stricter ones that catch real
    mistakes: `===` everywhere except `x == null` (null or undefined), no shadowed names,
    no unused variables or arguments (an argument a callback must take but doesn't use
    starts with `_`), no assignments to parameters, no `eval`, `new Function` or string
    timers, no expression statements such as `a && b()` or `(a(), b())`, no closures over
    a loop's changing variables. The full list is `STRICTER` in the config. One exception:
    Playwright tests hand values to callbacks that run in the browser
    (`page.evaluate((id) => ..., id)`) under the same name, so shadowing is allowed there.
  - **One idiom**: `const` unless reassigned, never `var`; object shorthand; `?.`, `??=`,
    `||=` and spread instead of their long forms; dot access where possible.
  - **Layout**: `LAYOUT` in the config, with
    [`@stylistic/eslint-plugin`](https://eslint.style) (the formatting rules ESLint itself
    moved out of its core): two-space indent, double quotes (a template literal or single
    quotes only to avoid escaping), semicolons, trailing commas on multi-line lists, a
    multi-line ternary's `?` and `:` at the start of the line, `{ a }` and `[a]` spacing,
    quotes on object keys only where needed, one blank line at most, LF and a final
    newline. `npm run lint:fix` (`eslint . --fix`) applies it. There is no line-length
    limit: a line is as long as reads well, and short lines are not forced because the
    popup has a hard size cap (slice 20 §8). `extension/spec/spec.js` is generated and
    skips the layout rules.
  - **Safety**: `eslint-plugin-no-unsanitized` and the HTML-string ban below.
- **`web-ext lint`** checks the extension package (also part of `npm run lint`).
- **Why not Prettier**: it was measured and not adopted (slice
  [53](../slices/53-openssf-best-practices/SPEC.md), open question 4). At print widths from
  100 to 200 it rewrote 137 to 188 files (9,085 to 31,918 added lines) and grew what the
  popup loads at open by 1.6 to 6.5 KB, past its 128 KB cap. The ESLint layout rules
  describe the code as it was written: adopting them changed 12 files by 22 lines, all
  whitespace or quotes.
- [`.editorconfig`](../.editorconfig) sets two spaces, LF and UTF-8 for every editor.
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
