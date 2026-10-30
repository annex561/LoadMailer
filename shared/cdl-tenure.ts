// Insurers (GEICO) ask how long a CDL driver has held the license.
// "2024-03" -> "Mar 2024 · 2 yrs 7 mo". Returns null for anything that isn't YYYY-MM.
// Regression test: server/__tests__/recruiting-cdl-first-issued.test.ts
export function fmtCdlSince(ym: string | null | undefined, now = new Date()): string | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(ym ?? "");
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const months = Math.max(0, (now.getFullYear() - year) * 12 + (now.getMonth() + 1 - month));
  const label = new Date(year, month - 1, 1).toLocaleString("en-US", { month: "short", year: "numeric" });
  return `${label} · ${Math.floor(months / 12)} yrs ${months % 12} mo`;
}
