export type NextActionType = "CALL" | "EMAIL" | "TEXT" | "NONE";
export type TouchKind = "SOFT" | "PAST_DUE" | "FINAL";

export function computeNextActionAfterTouch(kind: TouchKind): {
  nextActionAtISO: string | null;
  nextActionType: NextActionType;
} {
  const now = new Date();
  const d = new Date(now);

  // Default cadence
  // SOFT: follow up in 2 days
  // PAST_DUE: follow up next day
  // FINAL: follow up same day
  if (kind === "SOFT") d.setDate(d.getDate() + 2);
  if (kind === "PAST_DUE") d.setDate(d.getDate() + 1);
  if (kind === "FINAL") d.setDate(d.getDate() + 0);

  return { nextActionAtISO: d.toISOString(), nextActionType: "EMAIL" };
}

export function computeNextActionAfterPromise(promiseToPayISO: string): {
  nextActionAtISO: string | null;
  nextActionType: NextActionType;
} {
  // On promise-to-pay date, follow up with a call
  return { nextActionAtISO: new Date(promiseToPayISO).toISOString(), nextActionType: "CALL" };
}

export function computeNextActionAfterEscalate(): {
  nextActionAtISO: string | null;
  nextActionType: NextActionType;
} {
  const d = new Date();
  // Accounting follow-up next business day; keep simple: +1 day
  d.setDate(d.getDate() + 1);
  return { nextActionAtISO: d.toISOString(), nextActionType: "CALL" };
}
