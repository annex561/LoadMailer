import { eq, gte, lte, and, sql, desc, asc, count, avg, sum, max, min } from 'drizzle-orm';
import { db } from './db.js';
import {
  loadMessages,
  loadCommunicationThreads,
  drivers,
  communicationLogs,
  communicationInsights,
  aiPerformanceMetrics,
  driverEngagementMetrics,
  type InsertCommunicationInsights,
  type InsertAiPerformanceMetrics,
  type InsertDriverEngagementMetrics,
  type CommunicationInsights,
  type AiPerformanceMetrics,
  type DriverEngagementMetrics,
} from '@shared/schema.js';

export interface AnalyticsDateRange {
  start: Date;
  end: Date;
}

export interface CommunicationMetrics {
  totalMessages: number;
  driverMessages: number;
  dispatchMessages: number;
  aiSuggestions: number;
  aiSuggestionsAccepted: number;
  aiSuggestionsRejected: number;
  aiAutoSent: number;
  avgResponseTimeMs: number;
  medianResponseTimeMs: number;
  activeDrivers: number;
  totalActiveThreads: number;
}

export interface AIPerformanceData {
  totalSuggestions: number;
  acceptedSuggestions: number;
  rejectedSuggestions: number;
  autoSentMessages: number;
  avgConfidence: number;
  avgProcessingTimeMs: number;
  avgTokensUsed: number;
  avgTimeBetweenSuggestionAndResponseMs: number;
  suggestionAcceptanceRate: number; // computed on demand
}

export interface DriverEngagementData {
  driverId: string;
  driverName: string;
  messagesReceived: number;
  messagesSent: number;
  attachmentsSent: number;
  avgResponseTimeMs: number;
  threadsParticipated: number;
  engagementScore: number;
  lastActiveAt: Date | null;
  preferredResponseTime: string | null;
  communicationStyle: string | null;
}

export type AnalyticsPeriod = 'daily' | 'weekly' | 'monthly';

export class CommunicationAnalyticsService {
  /**
   * Generate period boundaries for analytics aggregation
   */
  private generatePeriodBoundaries(date: Date, period: AnalyticsPeriod): { start: Date; end: Date } {
    const start = new Date(date);
    const end = new Date(date);

    switch (period) {
      case 'daily':
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        break;
      case 'weekly':
        // Start of week (Sunday)
        const dayOfWeek = start.getDay();
        start.setDate(start.getDate() - dayOfWeek);
        start.setHours(0, 0, 0, 0);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        break;
      case 'monthly':
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        end.setMonth(start.getMonth() + 1, 0); // Last day of month
        end.setHours(23, 59, 59, 999);
        break;
    }

    return { start, end };
  }

  /**
   * Calculate communication metrics for a given date range
   */
  async calculateCommunicationMetrics(dateRange: AnalyticsDateRange): Promise<CommunicationMetrics> {
    console.log(`📊 Calculating communication metrics for ${dateRange.start.toISOString()} to ${dateRange.end.toISOString()}`);

    // Get message counts and AI metrics
    const messageStats = await db
      .select({
        totalMessages: count(),
        driverMessages: sql<number>`COUNT(CASE WHEN sender_role = 'driver' THEN 1 END)`,
        dispatchMessages: sql<number>`COUNT(CASE WHEN sender_role = 'dispatch' THEN 1 END)`,
        aiSuggestions: sql<number>`COUNT(CASE WHEN is_suggested = true THEN 1 END)`,
        aiSuggestionsAccepted: sql<number>`COUNT(CASE WHEN is_suggested = true AND approved_by IS NOT NULL THEN 1 END)`,
        aiSuggestionsRejected: sql<number>`COUNT(CASE WHEN is_suggested = true AND approved_by IS NULL AND is_sent = false THEN 1 END)`,
        aiAutoSent: sql<number>`COUNT(CASE WHEN sender_role = 'assistant' AND is_sent = true THEN 1 END)`,
      })
      .from(loadMessages)
      .where(
        and(
          gte(loadMessages.createdAt, dateRange.start),
          lte(loadMessages.createdAt, dateRange.end)
        )
      );

    // Get response time metrics (driver messages responding to dispatch messages)
    const responseTimeQuery = await db
      .select({
        avgResponseTime: avg(sql<number>`
          EXTRACT(EPOCH FROM (driver_msg.created_at - dispatch_msg.created_at)) * 1000
        `),
        responseTimes: sql<number[]>`
          ARRAY_AGG(EXTRACT(EPOCH FROM (driver_msg.created_at - dispatch_msg.created_at)) * 1000)
        `,
      })
      .from(loadMessages)
      .innerJoin(
        sql`${loadMessages} AS driver_msg`,
        sql`driver_msg.thread_id = ${loadMessages.threadId} AND driver_msg.sender_role = 'driver'`
      )
      .innerJoin(
        sql`${loadMessages} AS dispatch_msg`,
        sql`dispatch_msg.thread_id = ${loadMessages.threadId} AND dispatch_msg.sender_role = 'dispatch' AND dispatch_msg.created_at < driver_msg.created_at`
      )
      .where(
        and(
          gte(sql`driver_msg.created_at`, dateRange.start),
          lte(sql`driver_msg.created_at`, dateRange.end)
        )
      );

    // Get active drivers and threads count
    const activityStats = await db
      .select({
        activeDrivers: sql<number>`COUNT(DISTINCT sender_id)`,
        totalActiveThreads: sql<number>`COUNT(DISTINCT thread_id)`,
      })
      .from(loadMessages)
      .where(
        and(
          gte(loadMessages.createdAt, dateRange.start),
          lte(loadMessages.createdAt, dateRange.end),
          eq(loadMessages.senderRole, 'driver')
        )
      );

    const baseStats = messageStats[0] || {
      totalMessages: 0,
      driverMessages: 0,
      dispatchMessages: 0,
      aiSuggestions: 0,
      aiSuggestionsAccepted: 0,
      aiSuggestionsRejected: 0,
      aiAutoSent: 0,
    };

    const responseStats = responseTimeQuery[0] || { avgResponseTime: 0, responseTimes: [] };
    const activityData = activityStats[0] || { activeDrivers: 0, totalActiveThreads: 0 };

    // Calculate median response time
    const responseTimes = responseStats.responseTimes?.filter(t => t > 0) || [];
    const medianResponseTimeMs = responseTimes.length > 0 
      ? responseTimes.sort((a, b) => a - b)[Math.floor(responseTimes.length / 2)]
      : 0;

    return {
      ...baseStats,
      avgResponseTimeMs: Number(responseStats.avgResponseTime) || 0,
      medianResponseTimeMs,
      activeDrivers: activityData.activeDrivers,
      totalActiveThreads: activityData.totalActiveThreads,
    };
  }

  /**
   * Calculate AI performance metrics for a given date range and optional driver/thread
   */
  async calculateAIPerformanceMetrics(
    dateRange: AnalyticsDateRange,
    driverId?: string,
    threadId?: string
  ): Promise<AIPerformanceData> {
    console.log(`🤖 Calculating AI performance metrics for ${dateRange.start.toISOString()} to ${dateRange.end.toISOString()}`);

    const conditions = [
      gte(loadMessages.createdAt, dateRange.start),
      lte(loadMessages.createdAt, dateRange.end),
    ];

    if (driverId) conditions.push(eq(loadMessages.senderId, driverId));
    if (threadId) conditions.push(eq(loadMessages.threadId, threadId));

    const aiStats = await db
      .select({
        totalSuggestions: sql<number>`COUNT(CASE WHEN is_suggested = true THEN 1 END)`,
        acceptedSuggestions: sql<number>`COUNT(CASE WHEN is_suggested = true AND approved_by IS NOT NULL THEN 1 END)`,
        rejectedSuggestions: sql<number>`COUNT(CASE WHEN is_suggested = true AND approved_by IS NULL AND is_sent = false THEN 1 END)`,
        autoSentMessages: sql<number>`COUNT(CASE WHEN sender_role = 'assistant' AND is_sent = true THEN 1 END)`,
        avgConfidence: avg(sql<number>`CAST(ai_data->>'confidence' AS NUMERIC)`),
        avgProcessingTime: avg(sql<number>`CAST(ai_data->>'latencyMs' AS NUMERIC)`),
        avgTokens: avg(sql<number>`CAST(ai_data->>'promptTokens' AS NUMERIC) + CAST(ai_data->>'completionTokens' AS NUMERIC)`),
        avgSuggestionResponseTime: avg(sql<number>`
          CASE 
            WHEN is_suggested = true AND approved_at IS NOT NULL 
            THEN EXTRACT(EPOCH FROM (approved_at - created_at)) * 1000
            ELSE NULL 
          END
        `),
      })
      .from(loadMessages)
      .where(and(...conditions));

    const stats = aiStats[0] || {
      totalSuggestions: 0,
      acceptedSuggestions: 0,
      rejectedSuggestions: 0,
      autoSentMessages: 0,
      avgConfidence: 0,
      avgProcessingTime: 0,
      avgTokens: 0,
      avgSuggestionResponseTime: 0,
    };

    const suggestionAcceptanceRate = stats.totalSuggestions > 0 
      ? (stats.acceptedSuggestions / stats.totalSuggestions) * 100 
      : 0;

    return {
      totalSuggestions: stats.totalSuggestions,
      acceptedSuggestions: stats.acceptedSuggestions,
      rejectedSuggestions: stats.rejectedSuggestions,
      autoSentMessages: stats.autoSentMessages,
      avgConfidence: Number(stats.avgConfidence) || 0,
      avgProcessingTimeMs: Number(stats.avgProcessingTime) || 0,
      avgTokensUsed: Number(stats.avgTokens) || 0,
      avgTimeBetweenSuggestionAndResponseMs: Number(stats.avgSuggestionResponseTime) || 0,
      suggestionAcceptanceRate,
    };
  }

  /**
   * Calculate driver engagement metrics for a given date range
   */
  async calculateDriverEngagementMetrics(dateRange: AnalyticsDateRange): Promise<DriverEngagementData[]> {
    console.log(`👥 Calculating driver engagement metrics for ${dateRange.start.toISOString()} to ${dateRange.end.toISOString()}`);

    const driverStats = await db
      .select({
        driverId: drivers.id,
        driverName: sql<string>`COALESCE(${drivers.name}, 'Unknown Driver')`,
        messagesReceived: sql<number>`COUNT(CASE WHEN ${loadMessages.senderRole} != 'driver' THEN 1 END)`,
        messagesSent: sql<number>`COUNT(CASE WHEN ${loadMessages.senderRole} = 'driver' THEN 1 END)`,
        attachmentsSent: sql<number>`
          (SELECT COUNT(*) FROM message_attachments 
           WHERE message_id IN (
             SELECT id FROM load_messages 
             WHERE sender_id = ${drivers.id} 
             AND created_at BETWEEN ${dateRange.start} AND ${dateRange.end}
           ))
        `,
        avgResponseTime: avg(sql<number>`
          CASE 
            WHEN ${loadMessages.senderRole} = 'driver' 
            THEN EXTRACT(EPOCH FROM (${loadMessages.createdAt} - LAG(${loadMessages.createdAt}) OVER (
              PARTITION BY ${loadMessages.threadId} 
              ORDER BY ${loadMessages.createdAt}
            ))) * 1000
            ELSE NULL 
          END
        `),
        threadsParticipated: sql<number>`COUNT(DISTINCT ${loadMessages.threadId})`,
        lastActiveAt: max(loadMessages.createdAt),
      })
      .from(drivers)
      .leftJoin(loadMessages, eq(loadMessages.senderId, drivers.id))
      .where(
        and(
          gte(loadMessages.createdAt, dateRange.start),
          lte(loadMessages.createdAt, dateRange.end)
        )
      )
      .groupBy(drivers.id, drivers.name)
      .having(sql`COUNT(${loadMessages.id}) > 0`);

    return driverStats.map(stat => {
      // Calculate engagement score based on multiple factors
      const messageActivity = Math.min((stat.messagesSent + stat.messagesReceived) / 10, 25); // 0-25 points
      const responseSpeed = Math.max(25 - (Number(stat.avgResponseTime) || 0) / 60000, 0); // 0-25 points (faster = better)
      const threadParticipation = Math.min(stat.threadsParticipated * 5, 25); // 0-25 points
      const recencyBonus = stat.lastActiveAt 
        ? Math.max(25 - (Date.now() - new Date(stat.lastActiveAt).getTime()) / (24 * 60 * 60 * 1000), 0) // 0-25 points
        : 0;

      const engagementScore = Math.min(messageActivity + responseSpeed + threadParticipation + recencyBonus, 100);

      // Determine preferred response time and communication style
      const avgResponseHours = (Number(stat.avgResponseTime) || 0) / (1000 * 60 * 60);
      let preferredResponseTime = 'unknown';
      if (avgResponseHours < 1) preferredResponseTime = 'immediate';
      else if (avgResponseHours < 4) preferredResponseTime = 'quick';
      else if (avgResponseHours < 24) preferredResponseTime = 'daily';
      else preferredResponseTime = 'slow';

      return {
        driverId: stat.driverId,
        driverName: stat.driverName,
        messagesReceived: stat.messagesReceived,
        messagesSent: stat.messagesSent,
        attachmentsSent: stat.attachmentsSent,
        avgResponseTimeMs: Number(stat.avgResponseTime) || 0,
        threadsParticipated: stat.threadsParticipated,
        engagementScore: Math.round(engagementScore),
        lastActiveAt: stat.lastActiveAt ? new Date(stat.lastActiveAt) : null,
        preferredResponseTime,
        communicationStyle: stat.messagesSent > 10 ? 'active' : 'passive',
      };
    });
  }

  /**
   * Store aggregated communication insights for a specific period
   */
  async storeCommunicationInsights(
    period: AnalyticsPeriod,
    date: Date,
    insightType: string,
    metrics: CommunicationMetrics
  ): Promise<void> {
    const { start, end } = this.generatePeriodBoundaries(date, period);

    const insightData: InsertCommunicationInsights = {
      period,
      periodStart: start,
      periodEnd: end,
      insightType,
      totalMessages: metrics.totalMessages,
      driverMessages: metrics.driverMessages,
      dispatchMessages: metrics.dispatchMessages,
      aiSuggestions: metrics.aiSuggestions,
      aiSuggestionsAccepted: metrics.aiSuggestionsAccepted,
      aiSuggestionsRejected: metrics.aiSuggestionsRejected,
      aiAutoSent: metrics.aiAutoSent,
      avgResponseTimeMinutes: metrics.avgResponseTimeMs / (1000 * 60),
      medianResponseTimeMinutes: metrics.medianResponseTimeMs / (1000 * 60),
      activeDrivers: metrics.activeDrivers,
      totalActiveThreads: metrics.totalActiveThreads,
      insights: {
        calculatedAt: new Date().toISOString(),
        period,
        dateRange: { start: start.toISOString(), end: end.toISOString() },
      },
    };

    try {
      await db
        .insert(communicationInsights)
        .values(insightData)
        .onConflictDoUpdate({
          target: [communicationInsights.period, communicationInsights.periodStart, communicationInsights.insightType],
          set: {
            ...insightData,
            createdAt: sql`NOW()`,
          },
        });

      console.log(`✅ Stored ${insightType} insights for ${period} period: ${start.toDateString()}`);
    } catch (error) {
      console.error(`❌ Failed to store communication insights:`, error);
      throw error;
    }
  }

  /**
   * Store AI performance metrics for a specific period
   */
  async storeAIPerformanceMetrics(
    period: AnalyticsPeriod,
    date: Date,
    aiData: AIPerformanceData,
    driverId?: string,
    threadId?: string
  ): Promise<void> {
    const { start, end } = this.generatePeriodBoundaries(date, period);

    const metricsData: InsertAiPerformanceMetrics = {
      period,
      periodStart: start,
      periodEnd: end,
      driverId: driverId || null,
      threadId: threadId || null,
      totalSuggestions: aiData.totalSuggestions,
      acceptedSuggestions: aiData.acceptedSuggestions,
      rejectedSuggestions: aiData.rejectedSuggestions,
      autoSentMessages: aiData.autoSentMessages,
      avgConfidence: aiData.avgConfidence,
      avgProcessingTimeMs: Math.round(aiData.avgProcessingTimeMs),
      avgTokensUsed: aiData.avgTokensUsed,
      avgTimeBetweenSuggestionAndResponseMs: Math.round(aiData.avgTimeBetweenSuggestionAndResponseMs),
      metrics: {
        calculatedAt: new Date().toISOString(),
        suggestionAcceptanceRate: aiData.suggestionAcceptanceRate,
        period,
        dateRange: { start: start.toISOString(), end: end.toISOString() },
      },
    };

    try {
      await db
        .insert(aiPerformanceMetrics)
        .values(metricsData)
        .onConflictDoUpdate({
          target: [aiPerformanceMetrics.period, aiPerformanceMetrics.periodStart, aiPerformanceMetrics.driverId, aiPerformanceMetrics.threadId],
          set: {
            ...metricsData,
            createdAt: sql`NOW()`,
          },
        });

      console.log(`✅ Stored AI performance metrics for ${period} period: ${start.toDateString()}`);
    } catch (error) {
      console.error(`❌ Failed to store AI performance metrics:`, error);
      throw error;
    }
  }

  /**
   * Store driver engagement metrics for a specific period
   */
  async storeDriverEngagementMetrics(
    period: AnalyticsPeriod,
    date: Date,
    engagementData: DriverEngagementData[]
  ): Promise<void> {
    const { start, end } = this.generatePeriodBoundaries(date, period);

    for (const driverData of engagementData) {
      const metricsData: InsertDriverEngagementMetrics = {
        driverId: driverData.driverId,
        period,
        periodStart: start,
        periodEnd: end,
        messagesReceived: driverData.messagesReceived,
        messagesSent: driverData.messagesSent,
        attachmentsSent: driverData.attachmentsSent,
        avgResponseTimeMs: Math.round(driverData.avgResponseTimeMs),
        totalResponseTimeMs: Math.round(driverData.avgResponseTimeMs * driverData.messagesSent), // Approximation
        responseCount: driverData.messagesSent,
        threadsParticipated: driverData.threadsParticipated,
        lastActiveAt: driverData.lastActiveAt,
        engagementScore: driverData.engagementScore,
        preferredResponseTime: driverData.preferredResponseTime,
        communicationStyle: driverData.communicationStyle,
      };

      try {
        await db
          .insert(driverEngagementMetrics)
          .values(metricsData)
          .onConflictDoUpdate({
            target: [driverEngagementMetrics.driverId, driverEngagementMetrics.period, driverEngagementMetrics.periodStart],
            set: {
              ...metricsData,
              createdAt: sql`NOW()`,
            },
          });
      } catch (error) {
        console.error(`❌ Failed to store driver engagement metrics for ${driverData.driverName}:`, error);
      }
    }

    console.log(`✅ Stored driver engagement metrics for ${engagementData.length} drivers (${period} period: ${start.toDateString()})`);
  }

  /**
   * Process and store all analytics for a given date and period
   */
  async processAnalyticsForPeriod(date: Date, period: AnalyticsPeriod): Promise<void> {
    console.log(`🔄 Processing ${period} analytics for ${date.toDateString()}`);
    
    const { start, end } = this.generatePeriodBoundaries(date, period);
    const dateRange = { start, end };

    try {
      // Calculate and store communication insights
      const communicationMetrics = await this.calculateCommunicationMetrics(dateRange);
      await this.storeCommunicationInsights(period, date, `${period}_summary`, communicationMetrics);

      // Calculate and store AI performance metrics
      const aiMetrics = await this.calculateAIPerformanceMetrics(dateRange);
      await this.storeAIPerformanceMetrics(period, date, aiMetrics);

      // Calculate and store driver engagement metrics
      const driverEngagement = await this.calculateDriverEngagementMetrics(dateRange);
      await this.storeDriverEngagementMetrics(period, date, driverEngagement);

      console.log(`✅ Completed ${period} analytics processing for ${date.toDateString()}`);
    } catch (error) {
      console.error(`❌ Failed to process ${period} analytics for ${date.toDateString()}:`, error);
      throw error;
    }
  }

  /**
   * Get stored communication insights for a date range
   */
  async getCommunicationInsights(
    dateRange: AnalyticsDateRange,
    insightType?: string
  ): Promise<CommunicationInsights[]> {
    const conditions = [
      gte(communicationInsights.periodStart, dateRange.start),
      lte(communicationInsights.periodEnd, dateRange.end),
    ];

    if (insightType) {
      conditions.push(eq(communicationInsights.insightType, insightType));
    }

    return await db
      .select()
      .from(communicationInsights)
      .where(and(...conditions))
      .orderBy(desc(communicationInsights.periodStart));
  }

  /**
   * Get stored AI performance metrics for a date range
   */
  async getAIPerformanceMetrics(
    dateRange: AnalyticsDateRange,
    driverId?: string,
    threadId?: string
  ): Promise<AiPerformanceMetrics[]> {
    const conditions = [
      gte(aiPerformanceMetrics.periodStart, dateRange.start),
      lte(aiPerformanceMetrics.periodEnd, dateRange.end),
    ];

    if (driverId) conditions.push(eq(aiPerformanceMetrics.driverId, driverId));
    if (threadId) conditions.push(eq(aiPerformanceMetrics.threadId, threadId));

    return await db
      .select()
      .from(aiPerformanceMetrics)
      .where(and(...conditions))
      .orderBy(desc(aiPerformanceMetrics.periodStart));
  }

  /**
   * Get stored driver engagement metrics for a date range
   */
  async getDriverEngagementMetrics(
    dateRange: AnalyticsDateRange,
    driverId?: string
  ): Promise<DriverEngagementMetrics[]> {
    const conditions = [
      gte(driverEngagementMetrics.periodStart, dateRange.start),
      lte(driverEngagementMetrics.periodEnd, dateRange.end),
    ];

    if (driverId) conditions.push(eq(driverEngagementMetrics.driverId, driverId));

    return await db
      .select()
      .from(driverEngagementMetrics)
      .where(and(...conditions))
      .orderBy(desc(driverEngagementMetrics.periodStart));
  }

  /**
   * Run daily analytics processing job
   */
  async processDailyAnalytics(date: Date = new Date()): Promise<void> {
    console.log(`📊 Running daily analytics processing for ${date.toDateString()}`);
    await this.processAnalyticsForPeriod(date, 'daily');
  }

  /**
   * Run weekly analytics processing job
   */
  async processWeeklyAnalytics(date: Date = new Date()): Promise<void> {
    console.log(`📊 Running weekly analytics processing for ${date.toDateString()}`);
    await this.processAnalyticsForPeriod(date, 'weekly');
  }

  /**
   * Run monthly analytics processing job
   */
  async processMonthlyAnalytics(date: Date = new Date()): Promise<void> {
    console.log(`📊 Running monthly analytics processing for ${date.toDateString()}`);
    await this.processAnalyticsForPeriod(date, 'monthly');
  }
}

// Export singleton instance
export const communicationAnalyticsService = new CommunicationAnalyticsService();