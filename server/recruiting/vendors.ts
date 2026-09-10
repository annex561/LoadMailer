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

/**
 * DocuSeal template-configuration guards.
 *
 * Both driver types once pointed at DocuSeal's sample template (id 8, "Independent
 * Contractor Agreement (DEMO)"), so Stage 7 would have sent a real driver a three-field
 * demo document that looks plausible enough to sign. These predicates make that failure
 * loud instead of silent. They only ever BLOCK a send — they never originate one.
 *
 * Regression guard: server/__tests__/docuseal-template-guard.test.ts
 * Background: docs/FIX-LEDGER.md, "Recruiting Stage 7 points both driver types at a
 * DocuSeal demo template".
 */
export function isDemoTemplateName(name: string | null | undefined): boolean {
  return /\bdemo\b|\bsample\b|\btest template\b/i.test(String(name ?? ""));
}

export function assertTemplateConfigSafe(opts: {
  companyDriverTemplateId?: string | null;
  ownerOpTemplateId?: string | null;
  templateId: string;
  templateName?: string | null;
}): void {
  const company = (opts.companyDriverTemplateId ?? "").trim();
  const ownerOp = (opts.ownerOpTemplateId ?? "").trim();

  if (company && ownerOp && company === ownerOp) {
    throw new Error(
      `DocuSeal misconfigured: company-driver and owner-operator templates are both ` +
        `id ${company}. The two driver types must use different packets — an ` +
        `owner-operator needs the 49 CFR Part 376 lease, not the 1099 contractor agreement.`
    );
  }

  if (isDemoTemplateName(opts.templateName)) {
    throw new Error(
      `DocuSeal misconfigured: template ${opts.templateId} is named ` +
        `"${opts.templateName}", which looks like a sample template. Refusing to send it ` +
        `to a driver. Point the env var at the real packet.`
    );
  }
}

/** Cache of template id -> name, so the guard costs one read per template per boot. */
const templateNameCache = new Map<string, string | null>();

async function lookupTemplateName(
  docusealUrl: string,
  apiKey: string,
  templateId: string
): Promise<string | null> {
  if (templateNameCache.has(templateId)) return templateNameCache.get(templateId) ?? null;
  let name: string | null = null;
  try {
    const resp = await fetch(`${docusealUrl}/api/templates/${templateId}`, {
      headers: { "X-Auth-Token": apiKey },
    });
    if (resp.ok) {
      name = ((await resp.json()) as { name?: string }).name ?? null;
    }
  } catch {
    // A lookup failure must not block a legitimate send; the id-collision check still runs.
    name = null;
  }
  templateNameCache.set(templateId, name);
  return name;
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
  documentKey: "OWNER_OPERATOR_LEASE" | "COMPANY_DRIVER_1099";
  signerName: string;
  signerEmail: string;
}): Promise<SignatureRequestResult> {
  // Live DocuSeal integration — requires DOCUSEAL_URL + DOCUSEAL_API_KEY + template ID for the doc.
  const docusealUrl = (process.env.DOCUSEAL_URL || "").replace(/\/+$/, "");
  const apiKey = process.env.DOCUSEAL_API_KEY || "";
  const templateId =
    opts.documentKey === "OWNER_OPERATOR_LEASE"
      ? process.env.DOCUSEAL_OWNER_OP_TEMPLATE_ID
      : process.env.DOCUSEAL_COMPANY_DRIVER_TEMPLATE_ID;

  if (docusealUrl && apiKey && templateId) {
    // Deliberately OUTSIDE the try below: that catch falls through to the mock vendor, so
    // a guard failure swallowed there would hand back a fake signing URL and look like it
    // worked. A misconfigured template must fail loudly, not degrade quietly.
    assertTemplateConfigSafe({
      companyDriverTemplateId: process.env.DOCUSEAL_COMPANY_DRIVER_TEMPLATE_ID,
      ownerOpTemplateId: process.env.DOCUSEAL_OWNER_OP_TEMPLATE_ID,
      templateId,
      templateName: await lookupTemplateName(docusealUrl, apiKey, templateId),
    });

    try {
      const resp = await fetch(`${docusealUrl}/api/submissions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": apiKey,
        },
        body: JSON.stringify({
          template_id: Number(templateId),
          send_email: false,
          send_sms: false,
          submitters: [
            {
              role: "Driver",
              name: opts.signerName,
              email: opts.signerEmail,
              external_id: opts.applicationId,
              metadata: { application_id: opts.applicationId, document_key: opts.documentKey },
            },
          ],
        }),
      });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`DocuSeal create submission failed: ${resp.status} ${txt}`);
      }
      const submitters = (await resp.json()) as Array<{
        id: number;
        submission_id: number;
        slug: string;
        embed_src?: string;
      }>;
      const submitter = submitters?.[0];
      if (!submitter?.slug) {
        throw new Error("DocuSeal returned submission without signing slug");
      }
      return {
        vendor: "DOCUSEAL",
        envelopeId: String(submitter.submission_id),
        signingUrl: submitter.embed_src || `${docusealUrl}/s/${submitter.slug}`,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      };
    } catch (err) {
      console.error("[vendors/createSignatureRequest] DocuSeal failed, falling back:", err);
      // Fall through to mock so dev/test environments without DocuSeal still work.
    }
  }

  guardLive("DocuSeal");
  await sleep(500);
  const envelopeId = `mock-env-${opts.applicationId.slice(0, 8)}`;
  return {
    vendor: "MOCK_DOCUSEAL",
    envelopeId,
    signingUrl: `https://traqiq.app/api/recruiting/applications/${opts.applicationId}/mock-sign?envelope=${envelopeId}&doc=${opts.documentKey}`,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
}
