// Driver Advances Service
//
// Pure repayment math + DB helpers for the driver_advances table.
// The pure functions (scheduledAdvanceRepayment, applyRepayment) are unit-tested
// in server/__tests__/advances-service.test.ts — do not inline this logic into
// the settlement/paystub flow without updating that test.

import { db } from './db';
import { driverAdvances } from '@shared/schema';
import { and, eq } from 'drizzle-orm';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface AdvanceLike {
  id: string;
  amount: number;
  weeklyRepayment?: number | null;
  balanceRemaining: number;
  status: string;
}

export interface ScheduledRepayment {
  total: number;
  perAdvance: Array<{ id: string; amount: number }>;
}

/**
 * What this week's settlement should recoup from outstanding advances.
 * - weeklyRepayment > 0  → take min(weeklyRepayment, balanceRemaining)
 * - weeklyRepayment == 0 → take the full remaining balance
 * Paid / zero-balance advances are ignored.
 */
export function scheduledAdvanceRepayment(advances: AdvanceLike[]): ScheduledRepayment {
  const perAdvance: Array<{ id: string; amount: number }> = [];
  for (const a of advances) {
    if (a.status !== 'active') continue;
    const bal = a.balanceRemaining || 0;
    if (bal <= 0) continue;
    const weekly = a.weeklyRepayment || 0;
    const take = weekly > 0 ? Math.min(weekly, bal) : bal;
    if (take > 0) perAdvance.push({ id: a.id, amount: round2(take) });
  }
  const total = round2(perAdvance.reduce((s, x) => s + x.amount, 0));
  return { total, perAdvance };
}

/** Apply a repayment to one advance; never drives the balance negative. */
export function applyRepayment(
  advance: AdvanceLike,
  amount: number,
): { balanceRemaining: number; status: string } {
  const newBal = round2(Math.max(0, (advance.balanceRemaining || 0) - amount));
  return { balanceRemaining: newBal, status: newBal <= 0 ? 'paid' : 'active' };
}

// ── DB helpers ──────────────────────────────────────────────────────────────

export async function listActiveAdvances(driverId: string): Promise<AdvanceLike[]> {
  const rows = await db
    .select()
    .from(driverAdvances)
    .where(and(eq(driverAdvances.driverId, driverId), eq(driverAdvances.status, 'active')));
  return rows.map((r: typeof rows[number]) => ({
    id: r.id,
    amount: r.amount,
    weeklyRepayment: r.weeklyRepayment,
    balanceRemaining: r.balanceRemaining,
    status: r.status,
  }));
}

export async function scheduledRepaymentForDriver(driverId: string): Promise<number> {
  const advances = await listActiveAdvances(driverId);
  return scheduledAdvanceRepayment(advances).total;
}

export async function createAdvance(input: {
  driverId: string;
  companyId?: string | null;
  amount: number;
  reason?: string | null;
  weeklyRepayment?: number;
}) {
  const [row] = await db
    .insert(driverAdvances)
    .values({
      driverId: input.driverId,
      companyId: input.companyId ?? null,
      amount: round2(input.amount),
      reason: input.reason ?? null,
      weeklyRepayment: round2(input.weeklyRepayment ?? 0),
      balanceRemaining: round2(input.amount),
      status: 'active',
    })
    .returning();
  return row;
}

/**
 * Decrement outstanding advances by the scheduled repayment, in order.
 * Called when a paystub is finalized so live previews stop counting it.
 * Returns the total actually applied.
 */
export async function settleScheduledRepayments(driverId: string): Promise<number> {
  const advances = await listActiveAdvances(driverId);
  const sched = scheduledAdvanceRepayment(advances);
  let applied = 0;
  for (const p of sched.perAdvance) {
    const a = advances.find((x) => x.id === p.id)!;
    const next = applyRepayment(a, p.amount);
    await db
      .update(driverAdvances)
      .set({ balanceRemaining: next.balanceRemaining, status: next.status })
      .where(eq(driverAdvances.id, p.id));
    applied = round2(applied + p.amount);
  }
  return applied;
}
