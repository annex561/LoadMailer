/**
 * BOL address ↔ load address fuzzy matcher.
 *
 * Pure function — no DB, no API. Easy to unit-test exhaustively.
 *
 * Phase 2 of the wrong-load-attachment fix: after OCR extracts the SHIP
 * FROM / SHIP TO from a BOL photo, this module decides whether the
 * extracted address is "the same place" as the load's pickup/delivery
 * address. False positives on mismatch frustrate drivers; false
 * negatives ship wrong BOLs to factoring. Tuned conservatively — we
 * prefer "unreadable" (fall back to dispatcher review) over "mismatch"
 * (drag the driver back into the loop) when any field is missing.
 *
 * The match rule (all three must agree for "matched"):
 *   1. zip must match exactly when both sides have one
 *   2. city Levenshtein distance ≤ 2 (typo tolerance)
 *   3. street number must match exactly when both sides have one
 *
 * If any one of {zip, city, street number} is missing from the OCR
 * result, we return MatchResult.unreadable — caller treats this as
 * dispatcher-review, NOT as a mismatch SMS to the driver. Bad OCR
 * paired with a strict matcher would otherwise produce a wall of
 * false-positive mismatch SMS to drivers, which is exactly the
 * driver-frustration outcome the user vetoed in the design call.
 */

export interface ParsedAddress {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

export type MatchOutcome = "matched" | "mismatch" | "unreadable";

export interface MatchResult {
  outcome: MatchOutcome;
  reason: string;
  /** Set on outcome === "matched" or "mismatch"; the extracted address
   *  normalized into a short human-readable label like "Rossville, GA
   *  30741" — used in driver-facing SMS text. */
  normalizedExtracted?: string;
  /** Same shape for the load address — used in the driver-facing SMS
   *  text on mismatch so the driver sees both sides. */
  normalizedExpected?: string;
}

// US street suffix expansions. Keep terse — these are the common ones
// shippers actually print on BOLs. Two-way: we normalize BOTH sides
// through this table so "Rd" and "Road" compare equal regardless of
// which side has which form.
const SUFFIX_MAP: Record<string, string> = {
  st: "street",
  str: "street",
  ave: "avenue",
  av: "avenue",
  rd: "road",
  blvd: "boulevard",
  bvd: "boulevard",
  hwy: "highway",
  hiway: "highway",
  pkwy: "parkway",
  ln: "lane",
  ct: "court",
  dr: "drive",
  cir: "circle",
  ter: "terrace",
  pl: "place",
  sq: "square",
  trl: "trail",
  way: "way",
};

const DIRECTIONAL_MAP: Record<string, string> = {
  n: "north",
  s: "south",
  e: "east",
  w: "west",
  ne: "northeast",
  nw: "northwest",
  se: "southeast",
  sw: "southwest",
};

function normalizeStreet(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((tok) => SUFFIX_MAP[tok] ?? DIRECTIONAL_MAP[tok] ?? tok)
    .join(" ");
}

function normalizeCity(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeZip(s: string | null | undefined): string {
  if (!s) return "";
  const m = s.match(/\d{5}/);
  return m ? m[0] : "";
}

function extractStreetNumber(street: string): string {
  const m = street.match(/^\s*(\d+)/);
  return m ? m[1] : "";
}

// Levenshtein, capped at maxDistance for early-exit on clearly-different strings.
export function levenshtein(a: string, b: string, maxDistance = 5): number {
  if (a === b) return 0;
  if (!a.length) return Math.min(b.length, maxDistance + 1);
  if (!b.length) return Math.min(a.length, maxDistance + 1);
  // Quick reject: length difference alone exceeds cap.
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      curr.push(v);
      if (v < rowMin) rowMin = v;
    }
    // Early exit: even the best cell on this row is already past the cap.
    if (rowMin > maxDistance) return maxDistance + 1;
    prev = curr;
  }
  return prev[b.length];
}

// Parses a freeform single-line address (the shape loads.pickupAddress takes
// in practice) into ParsedAddress. Best-effort — we use it as a fallback
// when the caller doesn't already have a structured ParsedAddress for the
// load side. OCR results already come back structured from the vision
// model, so this is only used for the load.pickupAddress / load.deliveryAddress
// strings.
//
// Common shapes we handle:
//   "608 Salem Rd, Rossville, GA 30741"
//   "608 Salem Rd, Rossville GA 30741 US"
//   "Rossville, GA"                       (no street/zip — partial)
//   "608 Salem Rd Rossville GA 30741"     (no commas)
export function parseFreeformAddress(input: string | null | undefined): ParsedAddress {
  if (!input) return {};
  const trimmed = input.replace(/,?\s*(US|USA|United States)\s*$/i, "").trim();
  // Try comma-separated path first.
  if (trimmed.includes(",")) {
    const parts = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 3) {
      const street = parts[0];
      const city = parts[1];
      // Last segment looks like "GA 30741" or just "GA" or "30741".
      const tail = parts[2];
      const tailZip = tail.match(/\d{5}/);
      const tailState = tail.match(/\b[A-Z]{2}\b/);
      return {
        street,
        city,
        state: tailState ? tailState[0] : null,
        zip: tailZip ? tailZip[0] : null,
      };
    }
    if (parts.length === 2) {
      // "Rossville, GA" or "Rossville, GA 30741" — no street.
      const city = parts[0];
      const tail = parts[1];
      const tailZip = tail.match(/\d{5}/);
      const tailState = tail.match(/\b[A-Z]{2}\b/);
      return {
        street: null,
        city,
        state: tailState ? tailState[0] : null,
        zip: tailZip ? tailZip[0] : null,
      };
    }
  }
  // No commas — try positional. Pull zip + state from the end.
  const zipMatch = trimmed.match(/\b(\d{5})\b/);
  const stateMatch = trimmed.match(/\b([A-Z]{2})\b/);
  if (zipMatch && stateMatch) {
    const tailStart = Math.min(zipMatch.index ?? trimmed.length, stateMatch.index ?? trimmed.length);
    const head = trimmed.slice(0, tailStart).trim();
    // Heuristic: split head into street vs city by looking for a number
    // at the start (suggests street). If no leading number, treat all
    // of head as city.
    const leadingNumber = head.match(/^\s*\d+/);
    if (leadingNumber) {
      // Walk tokens; everything after the last suffix-or-directional is city.
      const tokens = head.split(/\s+/);
      let splitIdx = tokens.length;
      for (let i = tokens.length - 1; i >= 1; i--) {
        const t = tokens[i].toLowerCase().replace(/[.,]/g, "");
        if (SUFFIX_MAP[t] || DIRECTIONAL_MAP[t]) {
          splitIdx = i + 1;
          break;
        }
      }
      return {
        street: tokens.slice(0, splitIdx).join(" ").trim() || null,
        city: tokens.slice(splitIdx).join(" ").trim() || null,
        state: stateMatch[1],
        zip: zipMatch[1],
      };
    }
    return {
      street: null,
      city: head || null,
      state: stateMatch[1],
      zip: zipMatch[1],
    };
  }
  return { street: trimmed, city: null, state: null, zip: null };
}

function shortLabel(a: ParsedAddress): string {
  const cityState = [a.city, a.state].filter(Boolean).join(", ");
  return [cityState, a.zip].filter(Boolean).join(" ").trim() || (a.street ?? "(no address)");
}

export function matchAddresses(
  extracted: ParsedAddress,
  expected: ParsedAddress,
): MatchResult {
  const extZip = normalizeZip(extracted.zip);
  const expZip = normalizeZip(expected.zip);
  const extCity = normalizeCity(extracted.city);
  const expCity = normalizeCity(expected.city);
  const extStreet = normalizeStreet(extracted.street);
  const expStreet = normalizeStreet(expected.street);
  const extStreetNum = extractStreetNumber(extStreet);
  const expStreetNum = extractStreetNumber(expStreet);

  // Need all three signals on BOTH sides to make a confident call.
  // Missing a signal → unreadable → dispatcher review (NOT a driver SMS).
  if (!extZip || !extCity || !extStreetNum) {
    return {
      outcome: "unreadable",
      reason: `OCR returned incomplete address (zip=${!!extZip} city=${!!extCity} streetNum=${!!extStreetNum})`,
      normalizedExtracted: shortLabel(extracted),
      normalizedExpected: shortLabel(expected),
    };
  }
  if (!expZip || !expCity || !expStreetNum) {
    return {
      outcome: "unreadable",
      reason: "Load address incomplete on our side — cannot verify",
      normalizedExtracted: shortLabel(extracted),
      normalizedExpected: shortLabel(expected),
    };
  }

  // Zip is the most reliable single field. Differ = hard mismatch.
  if (extZip !== expZip) {
    return {
      outcome: "mismatch",
      reason: `zip mismatch (${extZip} vs ${expZip})`,
      normalizedExtracted: shortLabel(extracted),
      normalizedExpected: shortLabel(expected),
    };
  }

  // City — Levenshtein ≤ 2 absorbs common typos and abbreviation
  // differences (e.g., "Mt Vernon" vs "Mount Vernon" handled separately
  // by normalizeCity not splitting; if both spell out fully, edits are
  // small). Larger differences are a real mismatch.
  const cityDist = levenshtein(extCity, expCity, 5);
  if (cityDist > 2) {
    return {
      outcome: "mismatch",
      reason: `city mismatch (${extCity} vs ${expCity}, distance=${cityDist})`,
      normalizedExtracted: shortLabel(extracted),
      normalizedExpected: shortLabel(expected),
    };
  }

  // Street number must match exactly. Different numbers on the same
  // street = different buildings = wrong BOL.
  if (extStreetNum !== expStreetNum) {
    return {
      outcome: "mismatch",
      reason: `street number mismatch (${extStreetNum} vs ${expStreetNum})`,
      normalizedExtracted: shortLabel(extracted),
      normalizedExpected: shortLabel(expected),
    };
  }

  return {
    outcome: "matched",
    reason: "zip + city + street number all agree",
    normalizedExtracted: shortLabel(extracted),
    normalizedExpected: shortLabel(expected),
  };
}
