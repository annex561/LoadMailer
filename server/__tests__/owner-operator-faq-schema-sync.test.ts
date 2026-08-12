import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// Tripwire for the /owner-operator-jobs objection-handling FAQ.
//
// The answers live in two places on purpose:
//   1. client/src/pages/recruiting/landing.tsx  -> `faqs` on the "/owner-operator-jobs" variant
//      (what a human visitor reads)
//   2. server/seo-prerender.ts                  -> the FAQPage JSON-LD for that same path
//      (what Google and AI search read)
//
// Google demotes — and can penalise — FAQPage markup whose text is not visible on the
// rendered page. So if someone edits the copy in one file and forgets the other, this
// test fails loudly instead of the page quietly losing its rich result months later.
//
// Text comparison is deliberate: the two files can't share an import (one is a client
// .tsx bundled by Vite, the other runs in the Node server bundle), so the guard reads
// both as source text.

const ROOT = resolve(__dirname, "../..");
const LANDING = readFileSync(resolve(ROOT, "client/src/pages/recruiting/landing.tsx"), "utf8");
const PRERENDER = readFileSync(resolve(ROOT, "server/seo-prerender.ts"), "utf8");

// The owner-operator slice of the prerender config: from its path entry up to the next one.
function ownerOperatorPrerenderSlice(): string {
  const start = PRERENDER.indexOf('path: "/owner-operator-jobs"');
  expect(start, 'prerender config no longer has a "/owner-operator-jobs" entry').toBeGreaterThan(-1);
  const next = PRERENDER.indexOf('path: "/box-truck-careers-tennessee"', start);
  return PRERENDER.slice(start, next > -1 ? next : undefined);
}

// Pull the `name:` values out of the FAQPage Question entries in that slice.
function schemaQuestions(): string[] {
  const slice = ownerOperatorPrerenderSlice();
  const faqStart = slice.indexOf('"@type": "FAQPage"');
  if (faqStart === -1) return [];
  return [...slice.slice(faqStart).matchAll(/name:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) =>
    m[1].replace(/\\"/g, '"'),
  );
}

describe("/owner-operator-jobs objection FAQ stays in sync with its JSON-LD", () => {
  it("emits FAQPage markup for the owner-operator page", () => {
    expect(ownerOperatorPrerenderSlice()).toContain('"@type": "FAQPage"');
  });

  it("has the expected number of objection questions", () => {
    expect(schemaQuestions().length).toBeGreaterThanOrEqual(6);
  });

  it("every schema question is also rendered on the landing page", () => {
    const missing = schemaQuestions().filter((q) => !LANDING.includes(q));
    expect(
      missing,
      "these questions exist in the FAQPage JSON-LD but not in landing.tsx — " +
        "invisible FAQ markup gets demoted by Google",
    ).toEqual([]);
  });

  it("the objection copy is scoped to the owner-operator variant only", () => {
    // The shared driver FAQ must not pick up owner-operator objections, or the
    // company-driver and non-CDL landing pages start answering questions their
    // visitors never asked.
    const variantStart = LANDING.indexOf('"/owner-operator-jobs": {');
    const variantEnd = LANDING.indexOf('"/box-truck-careers-tennessee": {');
    expect(variantStart).toBeGreaterThan(-1);
    expect(variantEnd).toBeGreaterThan(variantStart);
    const variantBlock = LANDING.slice(variantStart, variantEnd);
    for (const q of schemaQuestions()) {
      expect(variantBlock, `"${q}" leaked out of the owner-operator variant`).toContain(q);
    }
  });
});
