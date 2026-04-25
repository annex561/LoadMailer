export interface DriverCandidate {
  id: string;
  name: string;
}

export interface MatchResult {
  driverId: string;
  confidence: number;
  driverName: string;
}

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .trim();

function tokenSet(s: string): Set<string> {
  return new Set(normalize(s).split(/\s+/).filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const inter = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

export function matchDriverByName(
  raw: string | null | undefined,
  drivers: DriverCandidate[],
): MatchResult | null {
  if (!raw || raw.trim().length === 0) return null;
  const needle = normalize(raw);
  const needleTokens = tokenSet(raw);

  let best: MatchResult | null = null;
  for (const d of drivers) {
    const hay = normalize(d.name);
    let conf = 0;

    if (needle === hay) {
      conf = 1;
    } else if (hay.includes(needle) || needle.includes(hay)) {
      conf = 0.95;
    } else {
      conf = jaccard(needleTokens, tokenSet(d.name));
      // Bonus if last name matches uniquely
      const needleLast = needle.split(" ").pop() ?? "";
      const hayLast = hay.split(" ").pop() ?? "";
      if (needleLast && needleLast === hayLast) conf = Math.max(conf, 0.88);
    }

    if (!best || conf > best.confidence) {
      best = { driverId: d.id, confidence: conf, driverName: d.name };
    }
  }

  if (!best || best.confidence < 0.6) return null;
  return best;
}
