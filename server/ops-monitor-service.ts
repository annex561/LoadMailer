// Ops Monitor Service
// Runs every 5 min and fires SMS alerts to the dispatcher when key systems degrade
// or drivers go silent. Dedupes repeat alerts with a 60-min cooldown per alert key.
//
// Alert phone defaults to DISPATCHER_ALERT_PHONE env var, falling back to the
// number Annex configured (205-861-4115).
//
// Alert keys (for dedupe):
//   dispatch-unack:<loadNumber>
//   gmail-stalled
//   parser-degraded
//   driver-silent:<driverId>:<loadNumber>

import cron from 'node-cron';
import { db } from './db';
import { loads } from '@shared/schema';
import { and, gte, isNotNull, isNull } from 'drizzle-orm';
import { smsLoadService } from './sms-service';

interface OpsMonitorState {
  lastGmailScanAt: Date | null;
  lastParserSuccessAt: Date | null;
  recentParserRuns: Array<{ at: Date; success: boolean }>;
  recentEventLoopLagMs: number[]; // samples from setInterval drift (last hour)
}

class OpsMonitorService {
  private cronJob: any = null;
  private isRunning = false;
  private alertCooldowns = new Map<string, number>(); // key -> sentAtMs
  private readonly COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
  private readonly state: OpsMonitorState = {
    lastGmailScanAt: null,
    lastParserSuccessAt: null,
    recentParserRuns: [],
    recentEventLoopLagMs: [],
  };
  private lagSamplerInterval: NodeJS.Timeout | null = null;

  private get alertPhone(): string {
    return process.env.DISPATCHER_ALERT_PHONE || '+12058614115';
  }

  // Called by gmail scanner each tick so we know the scanner is alive
  noteGmailScan(): void {
    this.state.lastGmailScanAt = new Date();
  }

  // Called by parser on every run (success or fail)
  noteParserRun(success: boolean): void {
    const now = new Date();
    if (success) this.state.lastParserSuccessAt = now;
    this.state.recentParserRuns.push({ at: now, success });
    // Keep last hour only
    const cutoff = Date.now() - 60 * 60 * 1000;
    this.state.recentParserRuns = this.state.recentParserRuns.filter(
      r => r.at.getTime() > cutoff
    );
  }

  getSnapshot() {
    const lag = this.state.recentEventLoopLagMs;
    const p95 = lag.length ? [...lag].sort((a, b) => a - b)[Math.floor(lag.length * 0.95)] : 0;
    const avg = lag.length ? Math.round(lag.reduce((s, n) => s + n, 0) / lag.length) : 0;
    return {
      gmailLastScan: this.state.lastGmailScanAt,
      parserLastSuccess: this.state.lastParserSuccessAt,
      parserRunsLastHour: this.state.recentParserRuns.length,
      parserFailureRatePct: this.computeParserFailureRate(),
      eventLoopLagAvgMs: avg,
      eventLoopLagP95Ms: p95,
      eventLoopSamples: lag.length,
      alertPhone: this.alertPhone,
      activeCooldowns: Array.from(this.alertCooldowns.keys()),
    };
  }

  // Sample event-loop lag: setInterval promises "in 1000ms", so the delta beyond
  // 1000ms is how long the loop was blocked. Healthy: <50ms. Bad: >500ms.
  private startLagSampler(): void {
    if (this.lagSamplerInterval) return;
    const SAMPLE_INTERVAL_MS = 1000;
    let expected = Date.now() + SAMPLE_INTERVAL_MS;
    this.lagSamplerInterval = setInterval(() => {
      const now = Date.now();
      const lag = Math.max(0, now - expected);
      this.state.recentEventLoopLagMs.push(lag);
      // Keep last hour of samples (3600 at 1s cadence)
      if (this.state.recentEventLoopLagMs.length > 3600) {
        this.state.recentEventLoopLagMs.shift();
      }
      expected = now + SAMPLE_INTERVAL_MS;
    }, SAMPLE_INTERVAL_MS);
    // Unref so this interval doesn't block process exit
    (this.lagSamplerInterval as any).unref?.();
  }

  private computeParserFailureRate(): number {
    const runs = this.state.recentParserRuns;
    if (runs.length === 0) return 0;
    const fails = runs.filter(r => !r.success).length;
    return Math.round((fails / runs.length) * 100);
  }

  async initialize(): Promise<void> {
    if (this.isRunning) return;
    console.log('🛰️ Starting Ops Monitor Service...');
    this.startLagSampler();
    this.cronJob = cron.schedule('*/5 * * * *', async () => {
      try {
        await this.runChecks();
      } catch (err) {
        console.error('[ops-monitor] tick error:', err);
      }
    });
    this.isRunning = true;
    console.log(`✅ Ops Monitor running (every 5 min) — alerts to ${this.alertPhone}`);
    // Run first check soon so we get early signal
    setTimeout(() => this.runChecks().catch(() => {}), 15000);
  }

  async runChecks(): Promise<void> {
    await Promise.allSettled([
      this.checkDispatchUnacknowledged(),
      this.checkGmailStalled(),
      this.checkParserHealth(),
      this.checkSilentDrivers(),
      this.checkEventLoopLag(),
    ]);
  }

  // 5) Event-loop latency check. If p95 > 500ms over recent samples, the API will
  // feel laggy to users. Alert once per hour so a new heavy scheduler can't silently
  // tank the site again like the 30s auto-matcher + 1-min gmail scan did on 04-22.
  private async checkEventLoopLag(): Promise<void> {
    const lag = this.state.recentEventLoopLagMs;
    if (lag.length < 60) return; // need at least ~1 min of samples
    const sorted = [...lag].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const THRESHOLD_MS = 500;
    if (p95 < THRESHOLD_MS) return;
    await this.maybeAlert(
      'event-loop-lag',
      `🐌 TRAQ: event-loop lag p95 ${p95}ms (threshold ${THRESHOLD_MS}ms). API will feel slow. Check background schedulers.`
    );
  }

  // 1) Dispatch SMS sent but driver hasn't replied YES (initialSms flag in sopProgress) after 30 min
  private async checkDispatchUnacknowledged(): Promise<void> {
    const THIRTY_MIN_AGO = Date.now() - 30 * 60 * 1000;
    const TWO_HR_AGO = new Date(Date.now() - 2 * 60 * 60 * 1000);

    // Candidates: loads with a driver, created in the last 2 hours, not yet delivered
    const pending = await db.query.loads.findMany({
      where: and(
        isNotNull(loads.driverId),
        gte(loads.createdAt, TWO_HR_AGO),
        isNull(loads.deliveredAt),
      ),
      with: { driver: true },
      limit: 30,
    });

    for (const l of pending) {
      const sop = (l.sopProgress as any) || {};
      if (sop.initialSms) continue; // driver confirmed
      const dispatchSentAt = sop.dispatchSentAt ? new Date(sop.dispatchSentAt) : null;
      if (!dispatchSentAt) continue;
      if (dispatchSentAt.getTime() > THIRTY_MIN_AGO) continue; // < 30 min, too early

      const driver = (l as any).driver;
      if (!driver) continue;

      const key = `dispatch-unack:${l.loadNumber}`;
      await this.maybeAlert(
        key,
        `⚠️ TRAQ: ${driver.name || 'Driver'} hasn't confirmed load ${l.loadNumber} (dispatched ${this.ago(dispatchSentAt)}).`
      );
    }
  }

  // 2) Gmail scanner hasn't ticked in 15 min
  private async checkGmailStalled(): Promise<void> {
    const last = this.state.lastGmailScanAt;
    // First 15 min of boot — don't alert before we have a baseline
    if (!last) return;
    const ageMs = Date.now() - last.getTime();
    if (ageMs < 15 * 60 * 1000) return;

    await this.maybeAlert(
      'gmail-stalled',
      `🚨 TRAQ: Gmail scanner silent for ${Math.round(ageMs / 60000)} min. Check Railway logs.`
    );
  }

  // 3) Parser failing > 50% in the last hour (with at least 4 runs so we don't alert on noise)
  private async checkParserHealth(): Promise<void> {
    const runs = this.state.recentParserRuns;
    if (runs.length < 4) return;
    const failRate = this.computeParserFailureRate();
    if (failRate < 50) return;
    await this.maybeAlert(
      'parser-degraded',
      `⚠️ TRAQ: Parser failure rate ${failRate}% over last hour (${runs.length} runs). Check OpenAI quota.`
    );
  }

  // 4) Silent-driver check: requires a lastDriverContactAt signal that isn't on the
  // schema yet. Stub for v2 — wire this up once lifecycle Phase 3 records check-in times.
  private async checkSilentDrivers(): Promise<void> {
    // no-op for v1
    return;
  }

  private async maybeAlert(key: string, body: string): Promise<void> {
    const lastSent = this.alertCooldowns.get(key) || 0;
    if (Date.now() - lastSent < this.COOLDOWN_MS) return;

    try {
      const r = await smsLoadService.sendSMS(this.alertPhone, body);
      if (r.success) {
        this.alertCooldowns.set(key, Date.now());
        console.log(`[ops-monitor] 📣 alert sent: ${key}`);
      } else {
        console.warn(`[ops-monitor] alert send failed: ${key} — ${r.error}`);
      }
    } catch (err: any) {
      console.error(`[ops-monitor] alert exception: ${key}`, err?.message || err);
    }
  }

  private ago(d: Date): string {
    const mins = Math.floor((Date.now() - d.getTime()) / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m ago`;
  }
}

export const opsMonitor = new OpsMonitorService();
