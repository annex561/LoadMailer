/**
 * Recruiting funnel vendor adapters — MOCK implementations.
 *
 * Each function returns realistic placeholder data with simulated latency.
 * When the user signs up for the real accounts (SambaSafety, FMCSA Clearinghouse,
 * Checkr, Concentra, DocuSign), we'll wire actual API calls behind these signatures.
 *
 * Gated by RECRUITING_LIVE_VENDORS env var — set to "true" to throw on every call
 * so a careless deploy that thinks it's going live without wiring real APIs
 * fails loudly instead of silently returning mock data.
 */

function sleep(ms: number) {
  return new Promise<void>((res) => setTimeout(res, ms));
}

function guardLive(vendor: string): void {
  if (process.env.RECRUITING_LIVE_VENDORS === "true") {
    throw new Error(
      `Vendor "${vendor}" is in mock mode but RECRUITING_LIVE_VENDORS=true. ` +
        `Wire the real API call before flipping live.`
    );
  }
}

export type MvrResult = {
  vendor: string;
  pullDate: string;
  status: "CLEAN" | "VIOLATIONS_FOUND";
  licenseNumber: string;
  licenseState: string;
  violations: Array<{ date: string; code: string; description: string }>;
};

export async function pullMvr(opts: {
  licenseNumber: string;
  licenseState: string;
}): Promise<MvrResult> {
  guardLive("SambaSafety MVR");
  await sleep(400 + Math.random() * 600);
  // 85% return CLEAN, 15% with violations
  const clean = Math.random() < 0.85;
  return {
    vendor: "MOCK_SAMBASAFETY",
    pullDate: new Date().toISOString(),
    status: clean ? "CLEAN" : "VIOLATIONS_FOUND",
    licenseNumber: opts.licenseNumber,
    licenseState: opts.licenseState,
    violations: clean
      ? []
      : [{ date: "2025-04-12", code: "SPEEDING", description: "Speeding 11 over" }],
  };
}

export type ClearinghouseResult = {
  vendor: string;
  pullDate: string;
  status: "NOT_PROHIBITED" | "PROHIBITED";
};

export async function queryClearinghouse(opts: {
  licenseNumber: string;
  licenseState: string;
  ssn: string;
  dob: string;
}): Promise<ClearinghouseResult> {
  guardLive("FMCSA Clearinghouse");
  await sleep(400 + Math.random() * 500);
  // 99% NOT_PROHIBITED
  const prohibited = Math.random() < 0.01;
  return {
    vendor: "MOCK_FMCSA_CLEARINGHOUSE",
    pullDate: new Date().toISOString(),
    status: prohibited ? "PROHIBITED" : "NOT_PROHIBITED",
  };
}

export type CriminalResult = {
  vendor: string;
  pullDate: string;
  status: "CLEAR" | "RECORD_FOUND";
  records: Array<{ jurisdiction: string; charge: string; date: string; disposition: string }>;
};

export async function pullCriminal(opts: {
  firstName: string;
  lastName: string;
  ssn: string;
  dob: string;
}): Promise<CriminalResult> {
  guardLive("Checkr");
  await sleep(800 + Math.random() * 1200);
  // 95% CLEAR
  const clear = Math.random() < 0.95;
  return {
    vendor: "MOCK_CHECKR",
    pullDate: new Date().toISOString(),
    status: clear ? "CLEAR" : "RECORD_FOUND",
    records: [],
  };
}

export type ScheduleDrugTestResult = {
  vendor: string;
  confirmationId: string;
  location: string;
  scheduledFor: string;
  instructions: string;
};

export async function scheduleDrugTest(opts: {
  applicationId: string;
  firstName: string;
  lastName: string;
}): Promise<ScheduleDrugTestResult> {
  guardLive("Concentra Drug Test");
  await sleep(300);
  return {
    vendor: "MOCK_CONCENTRA",
    confirmationId: `MOCK-DT-${opts.applicationId.slice(0, 8)}`,
    location: "Concentra · 2615 Kanasita Dr, Chattanooga, TN 37343",
    scheduledFor: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    instructions: "Bring photo ID. Cost billed to LAMP Logistics. Arrive within 24 hours.",
  };
}

export type ScheduleDotPhysicalResult = {
  vendor: string;
  confirmationId: string;
  examiner: string;
  location: string;
  scheduledFor: string;
};

export async function scheduleDotPhysical(opts: {
  applicationId: string;
  firstName: string;
  lastName: string;
}): Promise<ScheduleDotPhysicalResult> {
  guardLive("Concentra DOT Physical");
  await sleep(300);
  return {
    vendor: "MOCK_CONCENTRA",
    confirmationId: `MOCK-DOT-${opts.applicationId.slice(0, 8)}`,
    examiner: "Dr. Smith, FMCSA Certified Examiner",
    location: "Concentra · 2615 Kanasita Dr, Chattanooga, TN 37343",
    scheduledFor: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
  };
}

export type SignatureRequestResult = {
  vendor: string;
  envelopeId: string;
  signingUrl: string;
  expiresAt: string;
};

export async function createSignatureRequest(opts: {
  applicationId: string;
  documentKey: "OWNER_OPERATOR_LEASE" | "COMPANY_DRIVER_W2";
  signerName: string;
  signerEmail: string;
}): Promise<SignatureRequestResult> {
  guardLive("DocuSign");
  await sleep(500);
  const envelopeId = `mock-env-${opts.applicationId.slice(0, 8)}`;
  return {
    vendor: "MOCK_DOCUSIGN",
    envelopeId,
    signingUrl: `https://traqiq.app/api/recruiting/applications/${opts.applicationId}/mock-sign?envelope=${envelopeId}&doc=${opts.documentKey}`,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
}
