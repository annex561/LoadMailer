/**
 * S13 — Driver load text sequence tests.
 *
 * All Twilio / DB calls are mocked — no real API calls.
 * Covers: golden-file render, ASAP prefix, affirmative variants, ETA parsing,
 * Text 2 rendering, flag-off no-op, no-confirm timeout, source-text guards
 * (broker data never in driver output; Text 1 confirm checked before load-offer).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  renderText1,
  renderText2,
  isAffirmative,
  parseEta,
  _cancelNoConfirmAlert,
  scheduleNoConfirmAlert,
} from "../driver-load-texts";

// ── Module-level mocks (hoisted; cover dynamic imports inside timer callbacks) ─
// These mock the same absolute paths that driver-load-texts.ts imports at runtime.
vi.mock("../sms-service", () => ({
  smsService: {
    sendSMS: vi.fn().mockResolvedValue({ success: true, messageSid: "SM_fake" }),
  },
}));
vi.mock("../db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          // Timer re-check: load found, not yet confirmed → alert fires.
          limit: () => [{ id: "load-abc", driverTextConfirmedAt: null }],
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  },
}));
vi.mock("@shared/schema", () => ({ loads: {}, drivers: {} }));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  isNotNull: vi.fn(),
  isNull: vi.fn(),
  desc: vi.fn(),
}));

// Pull the mocked sendSMS so tests can assert on it.
import { smsService } from "../sms-service";

// ── Fixture / golden file ────────────────────────────────────────────────────

const GOLDEN_PATH = resolve(
  __dirname,
  "fixtures/driver-load-texts-text1-golden.txt",
);
const GOLDEN = readFileSync(GOLDEN_PATH, "utf8");

const EXAMPLE_FIELDS = {
  pickupDate: "6/2",
  pickupApptType: "FCFS",
  pickupWindowStart: "08:00",
  pickupWindowEnd: "12:00",
  pickupCity: "Anderson",
  pickupState: "SC",
  pickupIsAsap: true,
  dropDate: "6/3",
  dropApptType: "Appt",
  dropWindowStart: "08:00",
  dropWindowEnd: "10:00",
  dropCity: "Palm Bay",
  dropState: "FL",
  weightLbs: 850,
  driverRate: 500,
};

// ── Golden-file test ─────────────────────────────────────────────────────────

describe("renderText1 — golden file (14e example, byte-for-byte)", () => {
  it("renders the example exactly matching the fixture", () => {
    const rendered = renderText1(EXAMPLE_FIELDS);
    expect(rendered).toStrictEqual(GOLDEN);
  });
});

// ── ASAP prefix ──────────────────────────────────────────────────────────────

describe("renderText1 — ASAP prefix", () => {
  it("prefixes city line with 'ASAP ' when pickupIsAsap=true", () => {
    const out = renderText1({ ...EXAMPLE_FIELDS, pickupIsAsap: true });
    expect(out).toContain("ASAP Anderson, SC");
  });

  it("no ASAP prefix when pickupIsAsap=false", () => {
    const out = renderText1({ ...EXAMPLE_FIELDS, pickupIsAsap: false });
    expect(out).not.toMatch(/ASAP Anderson/);
    expect(out).toContain("Anderson, SC");
  });

  it("no ASAP prefix when pickupIsAsap omitted", () => {
    const { pickupIsAsap: _, ...rest } = EXAMPLE_FIELDS;
    const out = renderText1(rest);
    expect(out).not.toMatch(/ASAP/);
  });
});

// ── Broker data never in driver output ───────────────────────────────────────

describe("broker data exclusion (spec 14a-1)", () => {
  const BROKER_STRINGS = [
    "TQL",
    "Echo Global",
    "Coyote",
    "555-1234",
    "brokerPhone",
    "broker_name",
    "brokerName",
  ];

  it("renderText1 does not contain any broker-looking field names", () => {
    const out = renderText1(EXAMPLE_FIELDS);
    for (const s of BROKER_STRINGS) {
      expect(out, `renderText1 must not include "${s}"`).not.toContain(s);
    }
  });

  it("renderText2 does not contain any broker-looking field names", () => {
    const out = renderText2({
      fields: EXAMPLE_FIELDS,
      pickupFullAddress: "2407 TEXOMA DR., Denison TX 75020",
      dropFullAddress: "NEWCOLD STORAGE C/O RVALUE INSULATION, McDonough, GA",
    });
    for (const s of BROKER_STRINGS) {
      expect(out, `renderText2 must not include "${s}"`).not.toContain(s);
    }
  });
});

// ── renderText2 ──────────────────────────────────────────────────────────────

describe("renderText2", () => {
  it("replaces city/state lines with full addresses", () => {
    const out = renderText2({
      fields: EXAMPLE_FIELDS,
      pickupFullAddress: "2407 TEXOMA DR., Denison TX 75020",
      dropFullAddress: "NEWCOLD STORAGE C/O RVALUE INSULATION, McDonough, GA",
    });
    expect(out).toContain("2407 TEXOMA DR., Denison TX 75020");
    expect(out).toContain("NEWCOLD STORAGE C/O RVALUE INSULATION, McDonough, GA");
  });

  it("does NOT contain the 'Please confirm' line", () => {
    const out = renderText2({
      fields: EXAMPLE_FIELDS,
      pickupFullAddress: "2407 TEXOMA DR., Denison TX 75020",
      dropFullAddress: "NEWCOLD STORAGE, McDonough, GA",
    });
    expect(out).not.toContain("Please confirm and provide ETA");
  });

  it("still contains the LAMP Logistics header and Rate line", () => {
    const out = renderText2({
      fields: EXAMPLE_FIELDS,
      pickupFullAddress: "123 Main St, Anytown TX",
      dropFullAddress: "456 Oak Ave, Somewhere FL",
    });
    expect(out).toContain("LAMP Logistics");
    expect(out).toContain("Rate $ 500");
  });
});

// ── isAffirmative ────────────────────────────────────────────────────────────

describe("isAffirmative", () => {
  const affirmativeInputs = [
    "YES",
    "Y",
    "yes",
    "confirm",
    "confirmed",
    "ok",
    "okay",
    "👍",
    "be there 9am",
    "ETA 2pm",
    "eta 2:30 pm",
    "arriving at 10",
    "I'll be there in 2 hours",
  ];

  for (const input of affirmativeInputs) {
    it(`"${input}" is affirmative`, () => {
      expect(isAffirmative(input)).toBe(true);
    });
  }

  const negativeInputs = ["NO", "N", "STOP", "cancel", "not sure", "maybe later", ""];

  for (const input of negativeInputs) {
    it(`"${input}" is NOT affirmative`, () => {
      expect(isAffirmative(input)).toBe(false);
    });
  }
});

// ── parseEta ─────────────────────────────────────────────────────────────────

describe("parseEta", () => {
  it('extracts time from "be there 9am"', () => {
    const eta = parseEta("be there 9am");
    expect(eta).not.toBeNull();
    expect(eta!.toLowerCase()).toContain("9");
  });

  it('extracts time from "ETA 2pm"', () => {
    const eta = parseEta("ETA 2pm");
    expect(eta).not.toBeNull();
  });

  it("returns null for plain YES", () => {
    expect(parseEta("YES")).toBeNull();
  });

  it("returns null for thumbs-up", () => {
    expect(parseEta("👍")).toBeNull();
  });
});

// ── Source-text guard: Text 1 confirm checked before load-offer YES ──────────

describe("sms-communication-service — Text 1 confirm routing (source-text)", () => {
  const SRC = readFileSync(
    resolve(__dirname, "../sms-communication-service.ts"),
    "utf8",
  );

  it("Text 1 confirm routing appears BEFORE the YES/NO load-offer block", () => {
    const t1Idx = SRC.indexOf("handleText1ConfirmIfPending");
    const yesIdx = SRC.indexOf("// ---- YES / NO: accept or decline a pending dispatch ----");
    expect(t1Idx).toBeGreaterThan(0);
    expect(yesIdx).toBeGreaterThan(0);
    expect(t1Idx, "handleText1ConfirmIfPending must come before the YES load-offer block").toBeLessThan(yesIdx);
  });

  it("Text 1 routing is gated by DRIVER_LOAD_TEXTS_ENABLED flag", () => {
    const block = SRC.slice(
      SRC.indexOf("handleText1ConfirmIfPending") - 200,
      SRC.indexOf("handleText1ConfirmIfPending") + 100,
    );
    expect(block).toMatch(/DRIVER_LOAD_TEXTS_ENABLED/);
  });
});

// ── Flag OFF → nothing sent ──────────────────────────────────────────────────

describe("sendDriverLoadText1 — flag off", () => {
  beforeEach(() => {
    delete process.env.DRIVER_LOAD_TEXTS_ENABLED;
  });
  afterEach(() => {
    delete process.env.DRIVER_LOAD_TEXTS_ENABLED;
  });

  it("returns ok:false immediately when DRIVER_LOAD_TEXTS_ENABLED is not set", async () => {
    const { sendDriverLoadText1 } = await import("../driver-load-texts");
    const result = await sendDriverLoadText1("some-load-id");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/DRIVER_LOAD_TEXTS_ENABLED/);
  });
});

// ── No-confirm timeout alert (fake timers) ───────────────────────────────────

describe("no-confirm timeout alert", () => {
  // Capture setTimeout callbacks directly so we can await the async callback
  // to completion before asserting. vi.advanceTimersByTimeAsync fires the
  // callback but @sinonjs only yields once per timer, so a multi-await
  // callback (db import → smsService import → sendSMS) would not be done
  // before the assertion ran. Capturing and manually awaiting the callback
  // gives deterministic, race-free results.
  let capturedTimers: Map<unknown, () => void>;

  beforeEach(() => {
    capturedTimers = new Map();
    vi.spyOn(global, "setTimeout").mockImplementation((fn: any, _ms?: any) => {
      const id = Symbol();
      capturedTimers.set(id, fn);
      return id as any;
    });
    vi.spyOn(global, "clearTimeout").mockImplementation((id?: any) => {
      capturedTimers.delete(id);
    });
    process.env.DRIVER_TEXT1_CONFIRM_TIMEOUT_MS = "5000";
    process.env.OWNER_ALERT_PHONE = "+15615551234";
    vi.mocked(smsService.sendSMS).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.DRIVER_TEXT1_CONFIRM_TIMEOUT_MS;
    delete process.env.OWNER_ALERT_PHONE;
  });

  it("fires owner alert with load number and driver name when driver does not confirm", async () => {
    scheduleNoConfirmAlert("load-abc", "LAMP-99", "John Doe");

    // Invoke the captured timer callback — this is what fires after the timeout.
    expect(capturedTimers.size).toBe(1);
    await capturedTimers.values().next().value();

    expect(vi.mocked(smsService.sendSMS)).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "+15615551234",
        body: expect.stringMatching(/LAMP-99/),
      }),
    );
    expect(vi.mocked(smsService.sendSMS)).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringMatching(/John Doe/) }),
    );
  });

  it("does NOT fire owner alert when driver confirms (cancels timer) before timeout", async () => {
    scheduleNoConfirmAlert("load-cancel", "LAMP-99", "John Doe");
    // Simulate driver confirming — clearTimeout removes it from capturedTimers.
    _cancelNoConfirmAlert("load-cancel");

    expect(capturedTimers.size, "timer must be cleared after cancel").toBe(0);
    expect(vi.mocked(smsService.sendSMS)).not.toHaveBeenCalled();
  });

  it("does NOT schedule any timer when DRIVER_LOAD_TEXTS_ENABLED is off", async () => {
    delete process.env.DRIVER_LOAD_TEXTS_ENABLED;
    const { sendDriverLoadText1 } = await import("../driver-load-texts");

    const result = await sendDriverLoadText1("load-flag-off");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/DRIVER_LOAD_TEXTS_ENABLED/);
    expect(capturedTimers.size, "no timer must be scheduled when flag is off").toBe(0);
    expect(vi.mocked(smsService.sendSMS)).not.toHaveBeenCalled();
  });

  it("_cancelNoConfirmAlert is a no-op for unknown loadId", () => {
    expect(() => _cancelNoConfirmAlert("does-not-exist")).not.toThrow();
  });
});

// ── Source-text guard: ratecon-intake-routes uses Text 1 when flag on ────────

describe("ratecon-intake-routes — Text 1 dispatch hook (source-text)", () => {
  const ROUTES_SRC = readFileSync(
    resolve(__dirname, "../ratecon-intake-routes.ts"),
    "utf8",
  );

  it("imports sendDriverLoadText1 when DRIVER_LOAD_TEXTS_ENABLED is true", () => {
    expect(ROUTES_SRC).toMatch(/sendDriverLoadText1/);
  });

  it("checks DRIVER_LOAD_TEXTS_ENABLED before choosing SMS path", () => {
    expect(ROUTES_SRC).toMatch(/DRIVER_LOAD_TEXTS_ENABLED/);
  });
});

// ── Regression: YES must confirm the NEWEST pending Text 1, never an old load ─
// Old code ordered ascending, so a driver with an unanswered Text 1 from an
// earlier load had the OLD load confirmed and got Text 2 with the old addresses.

describe("handleText1ConfirmIfPending — picks newest pending load (source-text)", () => {
  const SRC = readFileSync(resolve(__dirname, "../driver-load-texts.ts"), "utf8");
  const fn = SRC.slice(
    SRC.indexOf("export async function handleText1ConfirmIfPending"),
    SRC.indexOf("export async function sendDriverLoadText2"),
  );

  it("orders pending Text 1 rows newest first", () => {
    expect(fn).toMatch(/orderBy\(desc\(\(loads as any\)\.text1SentAt\)\)/);
  });

  it("never confirms a load that is already delivered", () => {
    expect(fn).toMatch(/isNull\(loads\.deliveredAt\)/);
  });
});
