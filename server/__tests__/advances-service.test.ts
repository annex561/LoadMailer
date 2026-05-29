import { describe, it, expect } from "vitest";
import {
  scheduledAdvanceRepayment,
  applyRepayment,
  type AdvanceLike,
} from "../advances-service";

function adv(over: Partial<AdvanceLike> = {}): AdvanceLike {
  return {
    id: over.id || "adv1",
    amount: over.amount ?? 500,
    weeklyRepayment: over.weeklyRepayment ?? 0,
    balanceRemaining: over.balanceRemaining ?? 500,
    status: over.status ?? "active",
  };
}

describe("scheduledAdvanceRepayment — what comes out of this week's settlement", () => {
  it("weeklyRepayment=0 means take the full remaining balance next settlement", () => {
    const r = scheduledAdvanceRepayment([adv({ balanceRemaining: 500, weeklyRepayment: 0 })]);
    expect(r.total).toBe(500);
  });

  it("weeklyRepayment caps the per-week deduction at the scheduled amount", () => {
    const r = scheduledAdvanceRepayment([adv({ balanceRemaining: 500, weeklyRepayment: 100 })]);
    expect(r.total).toBe(100);
  });

  it("never deducts more than the remaining balance even if weeklyRepayment is larger", () => {
    const r = scheduledAdvanceRepayment([adv({ balanceRemaining: 60, weeklyRepayment: 100 })]);
    expect(r.total).toBe(60);
  });

  it("sums across multiple active advances", () => {
    const r = scheduledAdvanceRepayment([
      adv({ id: "a", balanceRemaining: 200, weeklyRepayment: 50 }),
      adv({ id: "b", balanceRemaining: 300, weeklyRepayment: 0 }),
    ]);
    expect(r.total).toBe(350); // 50 + 300
    expect(r.perAdvance).toHaveLength(2);
  });

  it("ignores paid / zero-balance advances", () => {
    const r = scheduledAdvanceRepayment([
      adv({ id: "a", balanceRemaining: 0, status: "paid" }),
      adv({ id: "b", balanceRemaining: 100, weeklyRepayment: 0 }),
    ]);
    expect(r.total).toBe(100);
    expect(r.perAdvance).toHaveLength(1);
  });

  it("empty list → zero, no NaN", () => {
    expect(scheduledAdvanceRepayment([]).total).toBe(0);
  });
});

describe("applyRepayment — decrement on finalize", () => {
  it("decrements balance and stays active when balance remains", () => {
    const r = applyRepayment(adv({ balanceRemaining: 500 }), 100);
    expect(r.balanceRemaining).toBe(400);
    expect(r.status).toBe("active");
  });

  it("marks paid when balance hits zero", () => {
    const r = applyRepayment(adv({ balanceRemaining: 100 }), 100);
    expect(r.balanceRemaining).toBe(0);
    expect(r.status).toBe("paid");
  });

  it("never drives balance negative on over-payment", () => {
    const r = applyRepayment(adv({ balanceRemaining: 50 }), 100);
    expect(r.balanceRemaining).toBe(0);
    expect(r.status).toBe("paid");
  });
});
