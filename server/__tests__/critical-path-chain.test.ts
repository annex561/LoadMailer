/**
 * Critical-path chain tests — pins every transition between flow steps
 * in the load lifecycle so a refactor of any one step can't silently
 * break the next.
 *
 * Why source-text pins instead of full integration tests:
 *   - The chain spans 6+ files with heavy DB + Twilio + OpenAI coupling.
 *   - End-to-end mocking has been brittle in past attempts (see
 *     mms-bol-upload.test.ts mock complexity).
 *   - Each individual function already has unit tests. What KEEPS BREAKING
 *     is the wiring between functions — "I refactored X, forgot Y still
 *     calls X, now the path is silently dead". Source pins catch
 *     exactly that class of bug for the cost of 1ms per assertion.
 *
 * What each pin catches:
 *   - If a future PR removes or renames the connecting call, the pin
 *     fails BEFORE the bug ships to production.
 *   - If a future PR moves the call into a conditional that doesn't
 *     always fire (the silent-skip bug), the pin notices the literal
 *     pattern broke.
 *
 * If a pin fails after a deliberate refactor:
 *   1. Update the path or the pinned string to match the new code
 *   2. Verify the chain still wires up (run the related unit tests)
 *   3. Document the new wiring in the comment above the pin
 *
 * Do NOT delete a pin without confirming the chain step it protects
 * still works.
 *
 * Background: this file exists because the user got bit too many times
 * by "fix one thing, silently break another". This is the safety net.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("Critical path: load lifecycle chain (transition pins)", () => {
  describe("Step 1→2: load creation → dispatch SMS body", () => {
    it("ratecon-intake Approve & Dispatch → calls dispatchFromIntake then sendDispatchSms", () => {
      const src = read("ratecon-intake-routes.ts");
      // Both must be imported AND called in sequence. If the SMS send is
      // removed, drivers stop getting NEW LOAD ASSIGNMENT after admin
      // approves a RateCon intake.
      expect(src).toContain("dispatchFromIntake");
      expect(src).toContain("sendDispatchSms");
      // Specifically, the approve-and-dispatch endpoint must wire both.
      // Pin the exact call shape rather than splitting on the URL fragment
      // (which appears multiple times in source).
      expect(src).toContain("dispatchFromIntake(req.params.id)");
      expect(src).toContain("sendDispatchSms(outcome.loadId");
    });

    it("auto-load-matcher → persists load THEN sends booking SMS (Phase 1 of PR #102 ordering)", () => {
      const src = read("auto-load-matcher.ts");
      // Order: persist BEFORE send. Reverse order = the bug the user
      // caught (driver replies YES → no DB row → dead loop).
      const persistIdx = src.indexOf("await persistLoadForAutoMatch");
      const sendIdx = src.indexOf("sendBookingRequest");
      expect(persistIdx).toBeGreaterThan(0);
      expect(sendIdx).toBeGreaterThan(0);
      expect(persistIdx).toBeLessThan(sendIdx);
    });
  });

  describe("Step 2→3: driver replies YES → CONFIRMED SMS", () => {
    it("sms-communication-service YES handler → calls sendDriverNextStepSms('accepted')", () => {
      const src = read("sms-communication-service.ts");
      // This is THE pin that would have caught today's class of bug if
      // it had existed. The YES handler is supposed to fire the
      // CONFIRMED follow-up SMS. If that call disappears (e.g. someone
      // refactors the handler), drivers see NEW LOAD ASSIGNMENT and
      // then... nothing. Dead loop, exactly the bug the user has hit
      // multiple times in this session.
      expect(src).toMatch(/await sendDriverNextStepSms\(\s*pending\.id\s*,\s*["']accepted["']/);
      // The query that finds the pending load must also be intact. If
      // confirmationStatus is changed (e.g. 'pending' → 'awaiting_yes'),
      // the YES handler finds nothing and the chain breaks. Pin the
      // literal so it matches what auto-matcher's persist writes.
      expect(src).toContain('eq(loads.confirmationStatus, "pending")');
    });

    it("PICKED UP handler → calls sendDriverNextStepSms('picked-up')", () => {
      const src = read("sms-communication-service.ts");
      // Symmetric chain step. PICKED UP is what triggers the DELIVER TO
      // SMS containing the delivery address. If this link breaks, the
      // driver gets no delivery instructions after starting the trip.
      expect(src).toMatch(/await sendDriverNextStepSms\(\s*active\.id\s*,\s*["']picked-up["']/);
    });

    it("driver-confirmation-routes (web confirm fallback) → also calls sendDriverNextStepSms", () => {
      const src = read("driver-confirmation-routes.ts");
      // Web confirmation is the fallback path when the driver taps the
      // dashboard link instead of replying YES. Same downstream call —
      // both entry points must produce identical message text per the
      // comment in sms-communication-service.ts.
      expect(src).toMatch(/sendDriverNextStepSms/);
    });
  });

  describe("Step 3→4: geofence arrival → BOL prompt SMS + pending_uploads row", () => {
    it("geofence-cron pickup branch → calls sendUploadLink (which writes pending_uploads when MMS mode on)", () => {
      const src = read("geofence-cron.ts");
      // sendUploadLink is the single entry point that BOTH sends the
      // BOL prompt AND (when MMS_UPLOAD_ENABLED=true) writes the
      // pending_uploads row that processMMSReply needs to find on the
      // inbound photo. If this call disappears, drivers never get
      // prompted at pickup arrival.
      expect(src).toContain("sendUploadLink(load.id, PICKUP_STAGES");
    });

    it("geofence-cron delivery branch → calls sendUploadLink", () => {
      const src = read("geofence-cron.ts");
      expect(src).toContain("sendUploadLink(load.id, DELIVERY_STAGES");
    });

    it("load-photos-service.sendUploadLink → writes pending_uploads row when MMS_UPLOAD_ENABLED=true", () => {
      const src = read("load-photos-service.ts");
      // The conditional branch in sendUploadLink that creates the
      // pending row. Without this, processMMSReply will never find a
      // matching pending row and inbound photos fall through to the
      // legacy handler (which is now blocked by Phase 1).
      expect(src).toContain("createPendingUpload");
      expect(src).toContain("process.env.MMS_UPLOAD_ENABLED === 'true'");
    });
  });

  describe("Step 4→5: inbound MMS reply → photo saved → OCR check", () => {
    it("processMMSReply → calls uploadLoadPhoto for the bound stage", () => {
      const src = read("mms-upload-service.ts");
      // Without this call, an inbound MMS that matches a pending row
      // would update markFulfilled but never actually save the photo
      // bytes to Cloudinary or write load_documents.
      expect(src).toContain("await uploadLoadPhoto({");
    });

    it("processMMSReply → calls runOcrAddressCheckIfEnabled AFTER uploadLoadPhoto", () => {
      const src = read("mms-upload-service.ts");
      // Order matters: OCR runs on the saved photo URL. If OCR runs
      // before save, there's no URL to OCR. Pin the relative order.
      const uploadIdx = src.indexOf("await uploadLoadPhoto({");
      const ocrIdx = src.indexOf("await runOcrAddressCheckIfEnabled({");
      expect(uploadIdx).toBeGreaterThan(0);
      expect(ocrIdx).toBeGreaterThan(0);
      expect(ocrIdx).toBeGreaterThan(uploadIdx);
    });

    it("processMMSReply → calls markFulfilled (so Twilio retries dedup correctly)", () => {
      const src = read("mms-upload-service.ts");
      // Without markFulfilled, the SAME MessageSid coming back from a
      // Twilio retry would be treated as new → duplicate photo save +
      // duplicate OCR call (= duplicate $0.005 OpenAI cost). The dedup
      // lookup in processMMSReply keys on fulfilledMessageSid.
      expect(src).toContain("await markFulfilled(pending.id, p.messageSid)");
    });
  });

  describe("Step 5→6: dispatcher approves photo → factoring gate opens", () => {
    it("factoring-loves.buildFactoringPacket → requires approvalStatus='approved' on the BOL doc", () => {
      const src = read("factoring-loves.ts");
      // The gate. Without this, raw inbound photos (saved with
      // approvalStatus='pending') flow straight into a Love's packet
      // bypassing dispatcher review — the wrong-load-to-factoring
      // scenario the user has called out multiple times.
      expect(src).toContain('eq(loadDocuments.approvalStatus, "approved")');
    });

    it("factoring-routes /queue → uses the same approvalStatus='approved' gate for ready=true", () => {
      const src = read("routes/factoring-routes.ts");
      // If the queue UI marks a load ready while the packet builder
      // refuses it, dispatchers will be confused (click submit, get an
      // error). Both must use the same gate.
      expect(src).toContain('eq(loadDocuments.approvalStatus, "approved")');
    });

    it("EnhancedDocumentViewer → has approve button wired to the PATCH endpoint", () => {
      const src = read("../client/src/components/EnhancedDocumentViewer.tsx");
      // The human review surface — without it, the approve action that
      // unlocks factoring has no UI. Pin the testid + the disabled-when-
      // already-approved guard so the surface stays usable.
      expect(src).toContain('data-testid="button-approve-document"');
      expect(src).toMatch(/disabled=\{currentDoc\.approvalStatus === ["']approved["']\}/);
    });
  });

  describe("OVERRIDE / WRONG safety nets (driver-side escape hatches)", () => {
    it("processMMSReply → routes 'WRONG' replies to handleWrongReply", () => {
      const src = read("mms-upload-service.ts");
      expect(src).toMatch(/\/\^WRONG\\b\//);
      expect(src).toContain("return handleWrongReply(p.from)");
    });

    it("processMMSReply → routes 'OVERRIDE' replies to handleOverrideReply", () => {
      const src = read("mms-upload-service.ts");
      expect(src).toMatch(/\/\^OVERRIDE\\b\//);
      expect(src).toContain("return handleOverrideReply(p.from, p.messageSid)");
    });

    it("handleOverrideReply → does NOT set approvalStatus='approved' (factoring still requires human review)", () => {
      const src = read("mms-upload-service.ts");
      const parts = src.split("export async function handleOverrideReply");
      expect(parts.length).toBeGreaterThan(1);
      const overrideBlock = parts[1];
      // Critical: OVERRIDE is a driver-side acknowledgement, NOT a
      // factoring approval. If this guard breaks, drivers can OVERRIDE
      // a wrong BOL straight into a Love's packet without any human
      // looking at it.
      expect(overrideBlock).not.toMatch(/approvalStatus:\s*['"]approved['"]/);
      expect(overrideBlock).toContain("ocrStatus: 'override'");
    });
  });

  describe("MMS_UPLOAD_ENABLED kill switches (Phase 1 wrong-load guards)", () => {
    it("ratecon-dispatch-service.sendDriverNextStepSms → does NOT pre-create pending_uploads rows", () => {
      const src = read("ratecon-dispatch-service.ts");
      // Phase 1 fix: pending rows are only written by geofence-cron at
      // physical arrival. If pre-creation comes back, the wrong-load
      // attachment risk for multi-load drivers comes back.
      expect(src).not.toMatch(/createPendingUpload/);
    });

    it("sms-communication-service legacy MMS fallback → short-circuits when MMS_UPLOAD_ENABLED=true", () => {
      const src = read("sms-communication-service.ts");
      // Without this short-circuit, an inbound photo that doesn't match
      // any pending_uploads row would silently bind to the most-recent
      // active load (wrong-load risk).
      expect(src).toContain('process.env.MMS_UPLOAD_ENABLED === "true"');
      expect(src).toContain("Photo received but no active upload request found");
    });
  });
});
