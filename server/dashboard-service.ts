import { db } from "./db";
import { loads, trucks, arInvoices, collectionsItems, activityLog } from "@shared/schema";
import { eq, and, sql, count, sum, ne } from "drizzle-orm";
import { collectionsService } from "./collections-service";
import { startOfWeek, startOfMonth } from "date-fns";

export class DashboardService {
  async getExecutiveSummary(companyId: string) {
    const today = new Date();
    const monthStart = startOfMonth(today);
    const weekStart = startOfWeek(today);

    const loadStats = await db.select({
      status: loads.lifecycleStatus,
      count: count(loads.id),
      totalValue: sum(loads.rate)
    }).from(loads)
      .where(eq(loads.companyId, companyId))
      .groupBy(loads.lifecycleStatus);

    const agingBuckets = await collectionsService.getAgingSummary(companyId);
    
    const [arTotals] = await db.select({
      totalOutstandingCents: sum(arInvoices.balanceDueCents),
      invoiceCount: count(arInvoices.id)
    }).from(arInvoices)
      .where(and(
        eq(arInvoices.companyId, companyId), 
        ne(arInvoices.status, "paid"),
        ne(arInvoices.status, "void")
      ));

    const fleetStats = await db.select({
      gateStatus: trucks.dispatchGateStatus,
      count: count(trucks.id)
    }).from(trucks)
      .where(eq(trucks.companyId, companyId))
      .groupBy(trucks.dispatchGateStatus);

    const overdueCollections = await db.select({ count: count() })
      .from(collectionsItems)
      .where(and(
        eq(collectionsItems.companyId, companyId),
        ne(collectionsItems.status, "closed"),
        sql`next_action_at < CURRENT_TIMESTAMP`
      ));

    const bookedLoads = loadStats.find(s => s.status === 'booked');
    const deliveredLoads = loadStats.find(s => s.status === 'delivered');

    return {
      pipeline: {
        stats: loadStats,
        bookedMTD: bookedLoads?.totalValue || 0,
        bookedCount: bookedLoads?.count || 0,
        deliveredMTD: deliveredLoads?.totalValue || 0,
        deliveredCount: deliveredLoads?.count || 0,
      },
      finance: {
        outstandingARCents: arTotals?.totalOutstandingCents || 0,
        invoiceCount: arTotals?.invoiceCount || 0,
        agingBuckets,
        overdueActions: overdueCollections[0]?.count || 0
      },
      fleet: {
        gateDistribution: fleetStats,
        greenCount: fleetStats.find(s => s.gateStatus === 'GREEN')?.count || 0,
        yellowCount: fleetStats.find(s => s.gateStatus === 'YELLOW')?.count || 0,
        redCount: fleetStats.find(s => s.gateStatus === 'RED')?.count || 0,
        avgRiskScore: await this.getAverageFleetRisk(companyId)
      },
      timestamp: new Date()
    };
  }

  private async getAverageFleetRisk(companyId: string) {
    const [result] = await db.select({
      avg: sql<number>`AVG(risk_score)`
    }).from(trucks).where(eq(trucks.companyId, companyId));
    return Math.round(result?.avg || 0);
  }

  async getRecentActivity(companyId: string, limit: number = 20) {
    return await db.select()
      .from(activityLog)
      .where(eq(activityLog.companyId, companyId))
      .orderBy(sql`created_at DESC`)
      .limit(limit);
  }

  async getPipelineConversion(companyId: string) {
    const pipeline = await db.select({
      status: loads.lifecycleStatus,
      count: count(loads.id),
    }).from(loads)
      .where(eq(loads.companyId, companyId))
      .groupBy(loads.lifecycleStatus);

    const statusMap = Object.fromEntries(pipeline.map(p => [p.status, p.count]));
    
    const newCount = statusMap['new'] || 0;
    const offeredCount = statusMap['offered'] || 0;
    const bookedCount = statusMap['booked'] || 0;
    const deliveredCount = statusMap['delivered'] || 0;
    const totalActive = newCount + offeredCount + bookedCount + deliveredCount;

    return {
      funnel: [
        { stage: 'new', count: newCount, label: 'New Loads' },
        { stage: 'offered', count: offeredCount, label: 'Offered' },
        { stage: 'booked', count: bookedCount, label: 'Booked' },
        { stage: 'delivered', count: deliveredCount, label: 'Delivered' },
      ],
      conversionRates: {
        offerRate: totalActive > 0 ? ((offeredCount + bookedCount + deliveredCount) / totalActive * 100).toFixed(1) : '0',
        bookRate: (offeredCount + bookedCount + deliveredCount) > 0 
          ? ((bookedCount + deliveredCount) / (offeredCount + bookedCount + deliveredCount) * 100).toFixed(1) : '0',
        deliveryRate: (bookedCount + deliveredCount) > 0 
          ? (deliveredCount / (bookedCount + deliveredCount) * 100).toFixed(1) : '0',
      }
    };
  }
}

export const dashboardService = new DashboardService();
