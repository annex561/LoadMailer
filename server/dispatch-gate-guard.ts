// Dispatch Gate enforcement on the RateCon dispatch path.
//
// WHAT WAS MISSING
//
// server/dispatch-gate-service.ts already grades every truck GREEN / YELLOW / RED on expired
// compliance documents, overdue preventive maintenance and open work orders. Exactly one caller
// consults it: server/ga-loads-router.ts, which is the SQLite-backed GA loads inbox. The primary
// path — dispatchFromIntake() in server/ratecon-dispatch-service.ts, the one that turns a parsed
// rate confirmation into a load and texts the driver — never asked. A truck with an expired
// annual inspection could be dispatched with no warning anywhere.
//
// WHY THIS DEFAULTS TO LOG-ONLY
//
// dispatchFromIntake is a critical workflow under CLAUDE.md's no-regression rule: if a blocking
// check misfires, dispatch stops entirely and the operator loses loads. So enforcement is
// opt-in via DISPATCH_GATE_ENFORCE=true. Unset, this module reports the gate status into the
// dispatch log and blocks nothing — landing it cannot break dispatch. Turn enforcement on once
// the logs show the gate grading trucks the way you expect.
//
// FAIL-OPEN ON UNKNOWN, FAIL-CLOSED ONLY ON RED
//
// Most drivers may not have a truck linked via trucks.assignedDriverId yet. "No truck resolved"
// must never block a dispatch — that would silently break every driver without the link. Only an
// explicit RED grade blocks, and only when enforcement is on and no override is supplied.
//
// The decision itself is pure and pinned by server/__tests__/dispatch-gate-guard.test.ts.

import { eq } from 'drizzle-orm';
import { db } from './db';
import { trucks } from '@shared/schema';
import { dispatchGate, type GateStatus } from './dispatch-gate-service';

export interface GateDecisionInput {
  /** null when no truck could be resolved for the driver. */
  gateStatus: GateStatus | null;
  reasons: string[];
  /** An override recorded on the truck inside the last 24h (see DispatchGateService). */
  hasActiveOverride: boolean;
  /** An override reason supplied by the dispatcher on this specific dispatch. */
  overrideReason?: string | null;
  /** DISPATCH_GATE_ENFORCE — false means observe and log, never block. */
  enforce: boolean;
}

export interface GateDecision {
  allow: boolean;
  /** Present only when allow === false. Surfaced to the dispatcher verbatim. */
  blockReason?: string;
  /** Always set, for the dispatch log, even when allow is true. */
  logLine: string;
}

/**
 * Decide whether a dispatch may proceed.
 *
 * Blocks only when ALL of these hold: enforcement is on, the grade is RED, and no override
 * (standing or supplied) exists. Everything else proceeds, including YELLOW and an unresolvable
 * truck — a warning belongs in the log, not in the operator's way.
 */
export function decideDispatchGate(input: GateDecisionInput): GateDecision {
  const { gateStatus, reasons, hasActiveOverride, overrideReason, enforce } = input;

  if (gateStatus === null) {
    return { allow: true, logLine: 'gate=N/A (no truck linked to this driver)' };
  }

  const detail = reasons.length > 0 ? ` — ${reasons.join('; ')}` : '';

  if (gateStatus !== 'RED') {
    return { allow: true, logLine: `gate=${gateStatus}${detail}` };
  }

  // From here down the truck is RED.
  if (!enforce) {
    return {
      allow: true,
      logLine: `gate=RED (NOT ENFORCED — set DISPATCH_GATE_ENFORCE=true to block)${detail}`,
    };
  }

  const override = (overrideReason ?? '').trim();
  if (override.length > 0) {
    return { allow: true, logLine: `gate=RED OVERRIDDEN by dispatcher: ${override}${detail}` };
  }
  if (hasActiveOverride) {
    return { allow: true, logLine: `gate=RED with a standing 24h override on the truck${detail}` };
  }

  return {
    allow: false,
    blockReason: `Dispatch blocked: truck is RED on the dispatch gate${detail}. Clear the issue, or dispatch again with an override reason.`,
    logLine: `gate=RED BLOCKED${detail}`,
  };
}

/** Is enforcement switched on? Read per call so it takes effect without a restart. */
export function isGateEnforced(): boolean {
  return process.env.DISPATCH_GATE_ENFORCE === 'true';
}

/**
 * Resolve the gate for a driver and decide. Never throws: any failure resolving the truck or
 * grading it degrades to "allow" with the error in the log line, because a gate lookup problem
 * must not become a dispatch outage.
 */
export async function evaluateDispatchGateForDriver(
  driverId: string,
  overrideReason?: string | null,
): Promise<GateDecision> {
  try {
    const [truck] = await db
      .select({
        id: trucks.id,
        unitNumber: trucks.unitNumber,
        overrideReason: trucks.dispatchGateOverrideReason,
        overrideAt: trucks.dispatchGateOverrideAt,
      })
      .from(trucks)
      .where(eq(trucks.assignedDriverId, driverId))
      .limit(1);

    if (!truck) {
      return decideDispatchGate({
        gateStatus: null, reasons: [], hasActiveOverride: false, overrideReason,
        enforce: isGateEnforced(),
      });
    }

    const gate = await dispatchGate.getTruckGateStatus(truck.id);

    const hasActiveOverride = Boolean(
      truck.overrideReason &&
      truck.overrideAt &&
      new Date(truck.overrideAt).getTime() > Date.now() - 24 * 60 * 60 * 1000,
    );

    const decision = decideDispatchGate({
      gateStatus: gate.status,
      reasons: gate.reasons,
      hasActiveOverride,
      overrideReason,
      enforce: isGateEnforced(),
    });

    return { ...decision, logLine: `truck ${truck.unitNumber}: ${decision.logLine}` };
  } catch (err: any) {
    // Fail open, loudly. A broken gate lookup is a bug to fix, not a reason to stop dispatching.
    return {
      allow: true,
      logLine: `gate=ERROR (allowing dispatch): ${err?.message || err}`,
    };
  }
}
