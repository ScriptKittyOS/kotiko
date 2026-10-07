// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Which of the learner's languages a page is written in (slice 16 section 1), so Kotiko
// swaps words only on pages they read: a Spanish reader's Spanish news, never a German
// page. The declared language decides, unless the browser's language detector is sure the
// page is in something else (templates often leave lang="en" on pages in other languages);
// an undeclared page goes by detection, or by its share of common words when the sample is
// too short to detect. Needs KotikoMatcher and KotikoText (lib/matcher.js, lib/text.js).
// No DOM: content.js gathers the inputs.
//
//   KotikoPageLang.decide({ bases, declared, detected, sampleLength, common })
//     -> { base, reason, lang }   base null: leave the page alone (except subtrees whose
//                                 own lang is one of the bases); lang is a canonical
//                                 language tag or null, never the page's own text
//   KotikoPageLang.canonical(tag) -> "pt-BR" | null (not a language tag)
(() => {
  const Matcher = globalThis.KotikoMatcher;
  const Text = globalThis.KotikoText;
  const SURE = 80; // percent, when detection overrides a declared language
  const MOSTLY = 50; // percent, for an undeclared page
  const SHORT = 200; // characters too few to detect reliably
  const COMMON_SHARE = 0.12;
  // RFC 5646 §4.4.1: a tag of at most 35 characters covers every real language.
  const MAX_TAG = 35;

  // The page's declared language as a canonical BCP 47 tag, or null. The page writes its
  // lang attribute, so anything that isn't a short, valid tag (say, a sentence meant for
  // Kotiko's popup, security review A-02) counts as no declaration at all.
  function canonical(tag) {
    if (typeof tag !== "string") return null;
    const t = tag.trim();
    if (!t || t.length > MAX_TAG) return null;
    try {
      return Intl.getCanonicalLocales(t)[0] ?? null;
    } catch {
      return null;
    }
  }

  // `detected`: i18n.detectLanguage's answer, or null when it isn't available.
  // `common`: the best base by share of common words, { base, share }, for short samples.
  function decide({ bases, declared: raw, detected, sampleLength = 0, common = null }) {
    const declared = canonical(raw);
    const top = detected?.languages?.[0] ?? null;
    const topLang = top && top.language !== "und" ? canonical(top.language) : null;
    const topBase = Matcher.baseOf(topLang, bases);
    const sure = !!(detected?.isReliable && topLang && top.percentage >= SURE);
    const declaredBase = Matcher.baseOf(declared, bases);

    if (declaredBase) {
      if (sure && !topBase) return { base: null, reason: "detected_other", lang: topLang };
      if (sure && topBase !== declaredBase) return { base: topBase, reason: "detected", lang: topLang };
      return { base: declaredBase, reason: "declared", lang: declared };
    }
    if (declared) {
      if (sure && topBase) return { base: topBase, reason: "detected", lang: topLang };
      return { base: null, reason: "declared_other", lang: declared };
    }
    if (!detected || sampleLength < SHORT) {
      if (common && common.share >= COMMON_SHARE) return { base: common.base, reason: "common_words", lang: common.base };
      // The common words don't settle it; a detector that is sure still does.
      if (!detected?.isReliable) return { base: null, reason: "unknown", lang: null };
    }
    if (topBase && top.percentage >= MOSTLY) return { base: topBase, reason: "detected", lang: topLang };
    return { base: null, reason: topLang ? "detected_other" : "unknown", lang: topLang };
  }

  // The share of `text`'s words that are common words of `base` (0 to 1).
  function commonShare(text, base, rules, stopwords) {
    if (!stopwords?.size) return 0;
    const tokens = Text.tokenize(text, base, rules);
    if (!tokens.length) return 0;
    let n = 0;
    for (const t of tokens) if (stopwords.has(t.key)) n++;
    return n / tokens.length;
  }

  // The base whose common words make up the most of `text`: { base, share } or null.
  function bestCommon(text, bases, { rules, stopwords }) {
    let best = null;
    for (const base of bases) {
      const share = commonShare(text, base, rules(base), stopwords(base));
      if (share > 0 && (!best || share > best.share)) best = { base, share };
    }
    return best;
  }

  const api = { SHORT, MAX_TAG, canonical, decide, commonShare, bestCommon };
  globalThis.KotikoPageLang = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
