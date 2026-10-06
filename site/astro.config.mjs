// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The docs site at https://kotiko.org (slice 44): Astro Starlight, built to static files
// and served by GitHub Pages behind Cloudflare. Nothing on it loads from another host: no
// analytics, no web fonts, no embeds. `node scripts/check-dist.mjs` checks the build.
//
// English is the only locale today (DECISIONS 2026-10-05). It is the root locale, so its
// pages have no prefix; a translation is added as another key in `locales` (for example
// `es: { label: "Español", lang: "es" }`) with its pages under src/content/docs/es/.
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// Defence in depth (slice 44 §9): every page may load only this site's own files, so a
// mistake can't make a visitor's browser contact another host. Starlight writes small
// inline scripts and style attributes, hence 'unsafe-inline'; search (Pagefind) compiles
// WebAssembly, hence 'wasm-unsafe-eval'. Cloudflare sends the same policy as a header,
// with frame-ancestors, which a <meta> can't set. /connect/ has a stricter one of its own.
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

export default defineConfig({
  site: "https://kotiko.org",
  trailingSlash: "always",
  // No link prefetching: pages load when you open them, and /connect/ ships no script.
  prefetch: false,
  build: { format: "directory" },
  // Text appears exactly as written in its source: the privacy policy here must read the
  // same as the copy inside the extension, straight quotes included.
  markdown: { smartypants: false },
  // Old or short paths that people may type or that other pages linked to.
  redirects: {
    "/troubleshooting/": "/help/",
    "/download/": "/install/",
    "/errors/": "/help/errors/",
  },
  integrations: [
    starlight({
      title: "Kotiko",
      description: "Kotiko swaps words on the pages you read for the words you're learning, in any language.",
      logo: { src: "./src/assets/brand/cat-128.png", alt: "" },
      favicon: "/brand/icon-32.png",
      customCss: ["./src/styles/kotiko.css"],
      locales: {
        root: { label: "English", lang: "en" },
      },
      social: [{ icon: "github", label: "Source code on GitHub", href: "https://github.com/ScriptKittyOS/kotiko" }],
      editLink: { baseUrl: "https://github.com/ScriptKittyOS/kotiko/edit/main/site/" },
      lastUpdated: false,
      credits: false,
      components: {
        Footer: "./src/components/Footer.astro",
      },
      head: [
        { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP } },
        // Links on these pages never tell the next site which page they came from.
        { tag: "meta", attrs: { name: "referrer", content: "no-referrer" } },
      ],
      sidebar: [
        { label: "Home", link: "/" },
        { label: "Install", link: "/install/" },
        { label: "Get started", link: "/start/" },
        {
          label: "Use Kotiko",
          items: [
            { label: "Adding words", link: "/use/adding-words/" },
            { label: "Adding a list of words", link: "/use/bulk-add/" },
            { label: "Choosing languages", link: "/use/languages/" },
            { label: "Sites and pages", link: "/use/sites/" },
            { label: "Your data", link: "/use/your-data/" },
          ],
        },
        {
          label: "Word lookups",
          items: [
            { label: "Choosing a service", link: "/providers/" },
            { label: "OpenRouter", link: "/providers/openrouter/" },
            { label: "OpenAI", link: "/providers/openai/" },
            { label: "Anthropic", link: "/providers/anthropic/" },
            { label: "Google Gemini", link: "/providers/gemini/" },
            { label: "Groq", link: "/providers/groq/" },
            { label: "Ollama", link: "/providers/ollama/" },
            { label: "LM Studio", link: "/providers/lmstudio/" },
            { label: "Another service", link: "/providers/custom/" },
          ],
        },
        {
          label: "Help",
          items: [
            { label: "Troubleshooting", link: "/help/" },
            { label: "Messages and what to do", link: "/help/errors/" },
          ],
        },
        {
          label: "Your own server",
          collapsed: true,
          items: [
            { label: "Why run a server", link: "/server/" },
            { label: "Keep it running", link: "/server/service/" },
            { label: "Telegram bot", link: "/server/telegram/" },
            { label: "Other machines", link: "/server/remote-access/" },
            { label: "Models", link: "/server/models/" },
            { label: "Updates and backups", link: "/server/updates/" },
            { label: "Configuration reference", link: "/server/configuration/" },
            { label: "API reference", link: "/server/api/" },
          ],
        },
        {
          label: "About",
          items: [
            { label: "Privacy policy", link: "/privacy/" },
            { label: "Why Kotiko?", link: "/why/" },
            { label: "What's new", link: "/changelog/" },
          ],
        },
        {
          label: "Contribute",
          collapsed: true,
          items: [
            { label: "Contributing", link: "/contribute/" },
            { label: "Developer setup", link: "/contribute/setup/" },
            { label: "Architecture", link: "/contribute/architecture/" },
            { label: "Coding standards", link: "/contribute/coding-standards/" },
            { label: "Governance", link: "/contribute/governance/" },
            { label: "Roadmap", link: "/contribute/roadmap/" },
            { label: "Security requirements", link: "/contribute/security-requirements/" },
            { label: "Assurance case", link: "/contribute/assurance-case/" },
          ],
        },
      ],
    }),
  ],
});
