// Broker score endpoint — READ ONLY.
//
// Surfaces a broker's track record with THIS carrier next to the offered rate, so the person
// approving a RateCon sees the payment history and any FreightGuard filings before they accept.
// It scores; it never blocks. Hey Bubba's founder does this by hand, one phone call per carrier,
// which is his growth ceiling — see server/broker-score-service.ts for why that gap is
// structural rather than a feature he can ship.
//
// Reads nothing but the carrier's own books. Sends nothing. Writes nothing.

import type { Express, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { rateconIntake } from '@shared/schema';
import { resolveBrokerScore } from '../broker-score-service';

export function registerBrokerScoreRoutes(app: Express): void {
  // Score by name, for the review queue and any ad-hoc lookup.
  app.get('/api/brokers/score', async (req: Request, res: Response) => {
    try {
      const name = String(req.query.name || '').trim();
      if (!name) return res.status(400).json({ error: 'name is required' });
      res.json(await resolveBrokerScore(name));
    } catch (err: any) {
      console.error('[broker-score] error:', err?.message || err);
      res.status(500).json({ error: 'Failed to score broker' });
    }
  });

  // Score straight off a pending intake, so the review screen does not have to know how the
  // broker name was parsed out of the rate confirmation.
  app.get('/api/ratecon-intake/:id/broker-score', async (req: Request, res: Response) => {
    try {
      const [intake] = await db
        .select({ parsedJson: rateconIntake.parsedJson })
        .from(rateconIntake)
        .where(eq(rateconIntake.id, String(req.params.id)))
        .limit(1);

      if (!intake) return res.status(404).json({ error: 'Intake not found' });

      const parsed = intake.parsedJson as any;
      const name = String(parsed?.broker?.value || '').trim();
      if (!name) {
        return res.json({
          brokerName: '',
          grade: 'UNKNOWN',
          score: null,
          flags: ['No broker name was parsed from this rate confirmation.'],
          stats: {
            loadsInvoiced: 0, paidInvoices: 0, avgDaysToPay: null, latePayments: 0,
            openPastDueCents: 0, freightGuardFilings: 0, daysSinceLastFiling: null,
          },
        });
      }

      res.json(await resolveBrokerScore(name));
    } catch (err: any) {
      console.error('[broker-score] intake error:', err?.message || err);
      res.status(500).json({ error: 'Failed to score broker' });
    }
  });
}
