/**
 * Phase 1 wrong-load-attachment regression guards (source-text pins).
 *
 * The user caught the wrong-load risk while driving:
 *  - PR #98 pre-created pending_uploads rows at load acceptance, so a
 *    driver on 2 loads would have 2 pending rows and the inbound photo
 *    would bind to whichever was created last. Photo → wrong load →
 *    wrong BOL → factoring rejects → driver payment delayed.
 *  - The legacy SMS handler also auto-attached photos to the most-recent
 *    in-flight load whenever no pending row matched, with the same wrong-
 *    binding outcome.
 *  - factoring-loves.ts treated any populated `loads.bolPath` as ready to
 *    factor, defeating the dispatcher review step entirely.
 *
 * These guards live as source-text pins because the actual guarantees
 * (no DB call here, this file enforces it lives in main code; SMS short-
 * circuit; approval check) are spread across several files and a behavior
 * test would need to spin up Drizzle + Twilio + Cloudinary mocks. Source
 * pins are a cheap, fast tripwire — if any of these strings disappear,
 * the guard has been silently weakened and CI fails loud.
 *
 * If a future refactor changes WHERE the guard lives, update the path AND
 * the pinned string. Do NOT delete a guard without an explicit replacement
 * that's covered by a new test.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("Phase 1 wrong-load-attachment guards (source pins)", () => {
  it("ratecon-dispatch-service.ts does NOT pre-create pending_uploads at load acceptance/pick-up", () => {
    const src = read("ratecon-dispatch-service.ts");
    // The old PR #98 call site has been removed. The function imports
    // isMMSUploadEnabled (still needed for the SMS wording branch) but
    // NOT createPendingUpload (which would re-introduce the wrong-load bug).
    expect(src).not.toMatch(/createPendingUpload/);
    // The Phase 1 comment explaining the removal must be present so a
    // future contributor doesn't re-add it without context.
    expect(src).toContain(
      "Phase 1 of the wrong-load-attachment fix",
    );
  });

  it("sms-communication-service.ts refuses the legacy 'attach to most-recent load' fallback when MMS_UPLOAD_ENABLED=true", () => {
    const src = read("sms-communication-service.ts");
    // Hard gate: the MMS mode check must short-circuit BEFORE the
    // orderBy(desc(loads.createdAt)).limit(1) query that picks the
    // newest load. We pin both the flag check and the driver-facing
    // refusal message.
    expect(src).toContain('process.env.MMS_UPLOAD_ENABLED === "true"');
    expect(src).toContain(
      "Photo received but no active upload request found",
    );
  });

  it("factoring-loves.ts requires an APPROVED load_documents row before including a BOL in a Love's packet", () => {
    const src = read("factoring-loves.ts");
    // Pin the gate query — must look up approved BOL/POD docs.
    expect(src).toContain('eq(loadDocuments.approvalStatus, "approved")');
    // Pin the user-facing warning explaining the refusal so the
    // dispatcher knows what to do.
    expect(src).toContain(
      "no dispatcher-approved load_documents row",
    );
    // Negative pin: the old "any bolPath populated counts" behavior is
    // gone. There must NOT be a code path that sets bolPathToUse = load.bolPath
    // without first checking hasApprovedBolDoc.
    const lines = src.split("\n");
    const bolPathAssignmentLines = lines.filter((l) =>
      /bolPathToUse\s*=\s*load\.bolPath\b/.test(l),
    );
    expect(bolPathAssignmentLines).toHaveLength(0);
  });

  it("factoring-routes.ts queue gates ready=true on an approved BOL load_documents row, not raw bolPath", () => {
    const src = read("routes/factoring-routes.ts");
    expect(src).toContain('eq(loadDocuments.approvalStatus, "approved")');
    expect(src).toContain(
      "BOL/POD on file but awaiting dispatcher approval",
    );
  });
});
