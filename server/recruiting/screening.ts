// Pre-screening engine for the recruiting funnel.
// Configurable auto-disqualifier rules per 49 CFR 391 minimum standards.

export type ApplicationFacts = {
  yearsExperience: number;
  accidents3yrCount: number;
  violations3yrCount: number;
  licenseSuspensionRevocation: boolean;
  licenseDenialEver: boolean;
  felonyConviction: boolean;
  failedDotDrugTestEver: boolean;
  failedDotAlcoholTestEver: boolean;
  authorizedToWorkInUs: boolean;
};

export type ScreenResult = {
  status: "PASS" | "FAIL" | "MANUAL_REVIEW";
  reasons: string[];
};

export type ScreeningConfig = {
  minYearsExperience: number;
  maxMovingViolations3yr: number;
  maxAccidents3yr: number;
  disqualifyOnLicenseSuspension: boolean;
  disqualifyOnLicenseDenial: boolean;
  disqualifyOnFelony: boolean;
  disqualifyOnFailedDotDrug: boolean;
  disqualifyOnFailedDotAlcohol: boolean;
  requireWorkAuth: boolean;
};

export const DEFAULT_SCREENING_CONFIG: ScreeningConfig = {
  minYearsExperience: 1,
  maxMovingViolations3yr: 2,
  maxAccidents3yr: 1,
  disqualifyOnLicenseSuspension: true,
  disqualifyOnLicenseDenial: true,
  disqualifyOnFelony: false, // route to manual review instead
  disqualifyOnFailedDotDrug: true,
  disqualifyOnFailedDotAlcohol: true,
  requireWorkAuth: true,
};

export function screenApplication(
  facts: ApplicationFacts,
  config: ScreeningConfig = DEFAULT_SCREENING_CONFIG
): ScreenResult {
  const reasons: string[] = [];
  const manual: string[] = [];

  if (facts.yearsExperience < config.minYearsExperience) {
    reasons.push(
      `Less than ${config.minYearsExperience} year(s) of commercial driving experience`
    );
  }
  if (facts.violations3yrCount > config.maxMovingViolations3yr) {
    reasons.push(
      `${facts.violations3yrCount} moving violations in past 3 years (max ${config.maxMovingViolations3yr})`
    );
  }
  if (facts.accidents3yrCount > config.maxAccidents3yr) {
    reasons.push(
      `${facts.accidents3yrCount} accidents in past 3 years (max ${config.maxAccidents3yr})`
    );
  }
  if (config.disqualifyOnLicenseSuspension && facts.licenseSuspensionRevocation) {
    reasons.push("License suspension or revocation history");
  }
  if (config.disqualifyOnLicenseDenial && facts.licenseDenialEver) {
    reasons.push("License has been denied");
  }
  if (facts.felonyConviction) {
    if (config.disqualifyOnFelony) reasons.push("Felony conviction");
    else manual.push("Felony conviction — manual review required");
  }
  if (config.disqualifyOnFailedDotDrug && facts.failedDotDrugTestEver) {
    reasons.push("Previously failed DOT drug test");
  }
  if (config.disqualifyOnFailedDotAlcohol && facts.failedDotAlcoholTestEver) {
    reasons.push("Previously failed DOT alcohol test");
  }
  if (config.requireWorkAuth && !facts.authorizedToWorkInUs) {
    reasons.push("Not authorized to work in the U.S.");
  }

  if (reasons.length > 0) return { status: "FAIL", reasons };
  if (manual.length > 0) return { status: "MANUAL_REVIEW", reasons: manual };
  return { status: "PASS", reasons: [] };
}
