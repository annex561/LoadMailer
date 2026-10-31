// Annex's box-truck driver requirements, self-reported on the paid-ad landing page.
// No auto-reject: answers are stored and shown to LAMP, who screens every driver.
// ASCII only, because these strings go into operator SMS (non-GSM characters
// force UCS-2 and shrink a segment from 160 to 70 characters).
// Regression test: server/__tests__/recruiting-apply-gap.test.ts
export const EXPERIENCE_VEHICLES: Record<string, string> = {
  box_truck: "Box truck",
  semi: "Semi",
  other: "Other truck or van",
  none: "None yet",
};

export type ScreenAnswers = {
  anyViolations3yr?: boolean | null;
  anyDuiEver?: boolean | null;
  okAwayWeeks?: boolean | null;
  experienceVehicle?: string | null;
};

// Answers that break one of Annex's requirements. Unanswered (null) is not a flag:
// drivers from the other landing pages never see these questions.
export function screenFlags(a: ScreenAnswers): string[] {
  const flags: string[] = [];
  if (a.anyViolations3yr === true) flags.push("violation in last 3 yrs");
  if (a.anyDuiEver === true) flags.push("DUI");
  if (a.okAwayWeeks === false) flags.push("not OK 2-3 wks out");
  if (a.experienceVehicle === "none") flags.push("no truck experience");
  return flags;
}
