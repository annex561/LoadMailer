import OpenAI from "openai";
import { db } from "./db";
import { 
  drivers, 
  loads, 
  driverLoadHistory, 
  marketRateTrends, 
  backhaulOpportunities, 
  loadRecommendations, 
  aiAnalytics, 
  costCalculations,
  type Driver,
  type Load,
  type InsertDriverLoadHistory,
  type InsertMarketRateTrends,
  type InsertBackhaulOpportunities,
  type InsertLoadRecommendations,
  type InsertAiAnalytics,
  type InsertCostCalculations
} from "../shared/schema";
import { eq, and, desc, gte, lte, avg, count, sql } from "drizzle-orm";
import { canHandleEquipmentType, getEquipmentTypeInfo } from "../shared/equipment-types";

// the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface LoadMatchingContext {
  driver: Driver;
  availableLoads: Load[];
  driverHistory: any[];
  marketData: any[];
  currentLocation?: { lat: number; lng: number };
}

interface ProfitCalculation {
  grossRevenue: number;
  totalCosts: number;
  netProfit: number;
  profitMargin: number;
  fuelCost: number;
  tollCost: number;
  laborCost: number;
  vehicleOperatingCost: number;
}

interface BackhaulMatch {
  primaryLoad: Load;
  backhaulLoad: Load;
  combinedProfit: number;
  deadheadSavings: number;
  timeEfficiency: number;
  matchScore: number;
}

export class SmartLoadMatchingService {
  constructor() {}

  // Main AI-powered load matching function
  async generateLoadRecommendations(driverId: string): Promise<void> {
    try {
      console.log(`🧠 Generating AI load recommendations for driver: ${driverId}`);
      
      const context = await this.buildMatchingContext(driverId);
      if (!context) {
        console.log(`ℹ No context found for driver ${driverId}`);
        return;
      }

      // Generate AI recommendations for each available load
      for (const load of context.availableLoads) {
        const recommendation = await this.analyzeLoadMatch(context, load);
        if (recommendation) {
          await this.saveLoadRecommendation(recommendation);
        }
      }

      // Find backhaul opportunities
      await this.findBackhaulOpportunities(context);

      console.log(`✅ Generated recommendations for ${context.availableLoads.length} loads`);
    } catch (error) {
      console.error("Error generating load recommendations:", error);
    }
  }

  // Build comprehensive context for AI analysis
  private async buildMatchingContext(driverId: string): Promise<LoadMatchingContext | null> {
    try {
      // Get driver details
      const driver = await db.select().from(drivers).where(eq(drivers.id, driverId)).limit(1);
      if (!driver.length) return null;

      // Get available loads (not assigned, not expired)
      const availableLoads = await db.select()
        .from(loads)
        .where(
          and(
            eq(loads.status, "scheduled"),
            sql`${loads.expiresAt} IS NULL OR ${loads.expiresAt} > NOW()`
          )
        )
        .orderBy(desc(loads.createdAt))
        .limit(50);

      // Get driver's historical performance
      const driverHistory = await db.select()
        .from(driverLoadHistory)
        .where(eq(driverLoadHistory.driverId, driverId))
        .orderBy(desc(driverLoadHistory.createdAt))
        .limit(100);

      // Get market rate trends
      const marketData = await db.select()
        .from(marketRateTrends)
        .where(gte(marketRateTrends.weekOf, sql`NOW() - INTERVAL '8 weeks'`))
        .orderBy(desc(marketRateTrends.weekOf));

      return {
        driver: driver[0],
        availableLoads,
        driverHistory,
        marketData
      };
    } catch (error) {
      console.error("Error building matching context:", error);
      return null;
    }
  }

  // AI-powered load analysis
  private async analyzeLoadMatch(context: LoadMatchingContext, load: Load): Promise<InsertLoadRecommendations | null> {
    try {
      const startTime = Date.now();

      // Calculate comprehensive cost analysis
      const costAnalysis = await this.calculateLoadCosts(context.driver, load);
      await this.saveCostCalculation(costAnalysis);

      // Get historical performance on similar routes
      const similarLoads = context.driverHistory.filter(h => 
        h.originState === this.extractState(load.pickupAddress) &&
        h.destinationState === this.extractState(load.deliveryAddress) &&
        h.equipmentType === load.equipmentType
      );

      // Get market conditions for this route
      const marketCondition = context.marketData.find(m =>
        m.originState === this.extractState(load.pickupAddress) &&
        m.destinationState === this.extractState(load.deliveryAddress) &&
        m.equipmentType === load.equipmentType
      );

      // Prepare AI analysis prompt
      const aiPrompt = this.buildAIAnalysisPrompt(context.driver, load, costAnalysis, similarLoads, marketCondition);
      
      // Get AI analysis
      const aiResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are an expert logistics analyst specializing in load matching and profitability analysis for trucking operations. Analyze loads and provide detailed scoring and recommendations in JSON format."
          },
          {
            role: "user",
            content: aiPrompt
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.3
      });

      const aiAnalysis = JSON.parse(aiResponse.choices[0].message.content || "{}");
      const processingTime = Date.now() - startTime;

      // Save AI analytics
      await this.saveAIAnalytics({
        analysisType: "load_matching",
        entityId: load.id,
        entityType: "load",
        analysis: aiAnalysis,
        predictions: aiAnalysis.predictions || {},
        recommendations: aiAnalysis.recommendations || [],
        modelVersion: "1.0",
        inputData: {
          driverId: context.driver.id,
          loadId: load.id,
          costAnalysis,
          historicalMatches: similarLoads.length
        },
        confidence: aiAnalysis.confidence || 75,
        processingTime
      });

      // Build recommendation record
      const recommendation: InsertLoadRecommendations = {
        driverId: context.driver.id,
        loadId: load.id,
        aiScore: aiAnalysis.aiScore || 0,
        historicalPerformanceScore: aiAnalysis.historicalPerformanceScore || 0,
        marketConditionScore: aiAnalysis.marketConditionScore || 0,
        profitabilityScore: aiAnalysis.profitabilityScore || 0,
        routeOptimizationScore: aiAnalysis.routeOptimizationScore || 0,
        predictedProfit: costAnalysis.netProfit,
        predictedMargin: costAnalysis.profitMargin,
        riskScore: aiAnalysis.riskScore || 0,
        confidenceLevel: aiAnalysis.confidence || 75,
        reasoningFactors: aiAnalysis.reasoningFactors || {},
        similarLoadsPerformed: similarLoads.length,
        averagePerformanceOnRoute: similarLoads.length > 0 ? 
          similarLoads.reduce((sum, l) => sum + l.profitMargin, 0) / similarLoads.length : 0,
        competitiveRatePosition: aiAnalysis.competitiveRatePosition || "at_market",
        demandLevel: aiAnalysis.demandLevel || "medium",
        seasonalAdjustment: aiAnalysis.seasonalAdjustment || 1.0
      };

      return recommendation;
    } catch (error) {
      console.error("Error analyzing load match:", error);
      return null;
    }
  }

  // Comprehensive cost calculation
  private async calculateLoadCosts(driver: Driver, load: Load): Promise<InsertCostCalculations> {
    const totalMiles = load.miles || 500; // Default if not provided
    const deadheadMiles = Math.floor(Math.random() * 50); // Simplified for demo
    const estimatedDrivingTime = Math.floor(totalMiles / 55 * 60); // 55 mph average

    // Current fuel prices (would integrate with real API)
    const fuelPrice = 3.50; // per gallon
    const vehicleMpg = 7.5; // typical for box trucks
    const estimatedFuelCost = (totalMiles + deadheadMiles) / vehicleMpg * fuelPrice;

    // Toll calculations (simplified)
    const estimatedTolls = totalMiles > 300 ? totalMiles * 0.15 : 0;

    // Labor costs
    const hourlyDriverRate = 25;
    const estimatedLaborCost = (estimatedDrivingTime / 60) * hourlyDriverRate;

    // Vehicle operating costs
    const vehicleOperatingCost = 0.58; // per mile
    const maintenanceCost = totalMiles * 0.10;
    const depreciationCost = totalMiles * 0.08;

    const totalEstimatedCosts = estimatedFuelCost + estimatedTolls + estimatedLaborCost + 
                               (totalMiles * vehicleOperatingCost) + maintenanceCost + depreciationCost;

    const grossRevenue = load.rate || 2000; // Default if not provided
    const netProfit = grossRevenue - totalEstimatedCosts;
    const profitMargin = (netProfit / grossRevenue) * 100;
    const ratePerMile = grossRevenue / totalMiles;

    return {
      loadId: load.id,
      driverId: driver.id,
      totalMiles,
      deadheadMiles,
      estimatedDrivingTime,
      fuelPrice,
      vehicleMpg,
      estimatedFuelCost,
      estimatedTolls,
      hourlyDriverRate,
      estimatedLaborCost,
      vehicleOperatingCost,
      maintenanceCost,
      depreciationCost,
      totalEstimatedCosts,
      grossRevenue,
      netProfit,
      profitMargin,
      ratePerMile,
      marketAverageRate: ratePerMile * 0.95, // Simplified market comparison
      rateCompetitiveness: ratePerMile > 2.0 ? "above_market" : ratePerMile > 1.5 ? "competitive" : "below_market"
    };
  }

  // Find profitable backhaul opportunities
  private async findBackhaulOpportunities(context: LoadMatchingContext): Promise<void> {
    try {
      console.log("🔄 Analyzing backhaul opportunities...");

      for (const primaryLoad of context.availableLoads) {
        // Find potential backhaul loads from delivery location
        const deliveryState = this.extractState(primaryLoad.deliveryAddress);
        const potentialBackhauls = context.availableLoads.filter(load => 
          load.id !== primaryLoad.id &&
          this.extractState(load.pickupAddress) === deliveryState &&
          new Date(load.pickupDate) > new Date(primaryLoad.deliveryDate)
        );

        for (const backhaulLoad of potentialBackhauls) {
          const opportunity = await this.analyzeBackhaulOpportunity(primaryLoad, backhaulLoad, context.driver);
          if (opportunity && opportunity.matchScore > 70) {
            await this.saveBackhaulOpportunity(opportunity);
          }
        }
      }
    } catch (error) {
      console.error("Error finding backhaul opportunities:", error);
    }
  }

  // Analyze specific backhaul opportunity
  private async analyzeBackhaulOpportunity(primaryLoad: Load, backhaulLoad: Load, driver: Driver): Promise<InsertBackhaulOpportunities | null> {
    try {
      const deadheadToBackhaul = Math.floor(Math.random() * 30); // Simplified calculation
      const totalRoundTripMiles = (primaryLoad.miles || 500) + (backhaulLoad.miles || 500) + deadheadToBackhaul;
      
      const primaryRate = primaryLoad.rate || 2000;
      const backhaulRate = backhaulLoad.rate || 1500;
      const combinedRate = primaryRate + backhaulRate;

      // Calculate deadhead savings vs returning empty
      const deadheadSavings = (backhaulLoad.miles || 500) * 1.5; // $1.50 per mile saved
      const totalProfit = combinedRate - deadheadSavings;
      
      // Single load comparison
      const singleLoadProfit = primaryRate - ((primaryLoad.miles || 500) * 1.5);
      const profitImprovement = totalProfit - singleLoadProfit;

      // Calculate layover time
      const deliveryTime = new Date(primaryLoad.deliveryDate);
      const backhaulPickupTime = new Date(backhaulLoad.pickupDate);
      const layoverTime = Math.floor((backhaulPickupTime.getTime() - deliveryTime.getTime()) / (1000 * 60 * 60));

      // Scoring
      const matchScore = this.calculateBackhaulScore(deadheadToBackhaul, layoverTime, profitImprovement);
      const timeEfficiency = Math.max(0, 100 - (layoverTime / 24 * 20)); // Penalty for long layovers
      const profitScore = Math.min(100, profitImprovement / 500 * 100); // Scale based on $500 improvement

      return {
        primaryLoadId: primaryLoad.id,
        backhaulLoadId: backhaulLoad.id,
        driverId: driver.id,
        deliveryLocation: primaryLoad.deliveryAddress,
        backhaulOrigin: backhaulLoad.pickupAddress,
        deadheadToBackhaul,
        totalRoundTripMiles,
        primaryLoadRate: primaryRate,
        backhaulRate,
        combinedRate,
        deadheadSavings,
        totalProfit,
        profitImprovement,
        deliveryTime: deliveryTime,
        backhaulPickupTime: backhaulPickupTime,
        layoverTime,
        matchScore,
        timeEfficiency,
        profitScore,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
      };
    } catch (error) {
      console.error("Error analyzing backhaul opportunity:", error);
      return null;
    }
  }

  // Market rate trend analysis
  async analyzeMarketTrends(loads: Load[]): Promise<void> {
    try {
      console.log("📈 Analyzing market rate trends...");

      const routeGroups = this.groupLoadsByRoute(loads);

      for (const [routeKey, routeLoads] of Object.entries(routeGroups)) {
        const [originState, destinationState, equipmentType] = routeKey.split('|');
        
        if (routeLoads.length < 3) continue; // Need minimum sample size

        const rates = routeLoads.map(l => l.rate || 0).filter(r => r > 0);
        if (rates.length === 0) continue;

        const averageRate = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
        const sortedRates = rates.sort((a, b) => a - b);
        const medianRate = sortedRates[Math.floor(sortedRates.length / 2)];
        const highRate = Math.max(...rates);
        const lowRate = Math.min(...rates);
        
        const totalMiles = routeLoads.reduce((sum, l) => sum + (l.miles || 0), 0) / routeLoads.length;
        const ratePerMile = totalMiles > 0 ? averageRate / totalMiles : 0;

        const trendData: InsertMarketRateTrends = {
          originState,
          destinationState,
          equipmentType,
          averageRate,
          medianRate,
          highRate,
          lowRate,
          ratePerMile,
          loadVolume: routeLoads.length,
          truckDemand: this.calculateTruckDemand(routeLoads.length),
          seasonalFactor: this.calculateSeasonalFactor(),
          weekOf: this.getWeekStart(new Date()),
          sampleSize: routeLoads.length,
          dataSource: "scraped"
        };

        await this.saveMarketTrend(trendData);
      }
    } catch (error) {
      console.error("Error analyzing market trends:", error);
    }
  }

  // Rate prediction using AI
  async predictOptimalRates(originState: string, destinationState: string, equipmentType: string): Promise<number> {
    try {
      const historicalData = await db.select()
        .from(marketRateTrends)
        .where(
          and(
            eq(marketRateTrends.originState, originState),
            eq(marketRateTrends.destinationState, destinationState),
            eq(marketRateTrends.equipmentType, equipmentType)
          )
        )
        .orderBy(desc(marketRateTrends.weekOf))
        .limit(12); // Last 12 weeks

      if (historicalData.length < 3) {
        return 2.0; // Default rate per mile
      }

      const aiPrompt = `Analyze the following trucking rate trends and predict the optimal rate per mile for next week:

Historical Data (last ${historicalData.length} weeks):
${historicalData.map(d => `Week ${d.weekOf}: $${d.ratePerMile}/mile, Volume: ${d.loadVolume}, Demand: ${d.truckDemand}`).join('\n')}

Route: ${originState} to ${destinationState}
Equipment: ${equipmentType}

Consider:
- Seasonal patterns
- Market demand trends
- Rate volatility
- Load volume changes

Respond with JSON containing:
{
  "predictedRate": number,
  "confidence": number (0-100),
  "reasoning": "explanation",
  "trend": "increasing|decreasing|stable"
}`;

      const aiResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are a freight market analyst specializing in rate predictions and market trends."
          },
          {
            role: "user",
            content: aiPrompt
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.2
      });

      const prediction = JSON.parse(aiResponse.choices[0].message.content || "{}");
      return prediction.predictedRate || 2.0;
    } catch (error) {
      console.error("Error predicting optimal rates:", error);
      return 2.0;
    }
  }

  // Helper methods
  private buildAIAnalysisPrompt(driver: Driver, load: Load, costAnalysis: InsertCostCalculations, similarLoads: any[], marketCondition: any): string {
    return `Analyze this load opportunity for driver optimization:

DRIVER PROFILE:
- Equipment: ${driver.equipmentType}
- Experience on route: ${similarLoads.length} similar loads
- Average performance: ${similarLoads.length > 0 ? (similarLoads.reduce((sum, l) => sum + l.profitMargin, 0) / similarLoads.length).toFixed(1) : 'N/A'}%

LOAD DETAILS:
- Route: ${load.pickupAddress} → ${load.deliveryAddress}
- Rate: $${load.rate}
- Miles: ${load.miles}
- Equipment: ${load.equipmentType}

COST ANALYSIS:
- Gross Revenue: $${costAnalysis.grossRevenue}
- Total Costs: $${costAnalysis.totalEstimatedCosts}
- Net Profit: $${costAnalysis.netProfit}
- Profit Margin: ${costAnalysis.profitMargin}%
- Rate/Mile: $${costAnalysis.ratePerMile}

MARKET CONDITIONS:
${marketCondition ? `
- Market Average: $${marketCondition.averageRate}
- Rate Range: $${marketCondition.lowRate} - $${marketCondition.highRate}
- Load Volume: ${marketCondition.loadVolume}
- Demand Level: ${marketCondition.truckDemand}
` : 'No market data available'}

Provide detailed scoring (0-100) and analysis in JSON format:
{
  "aiScore": overall_recommendation_score,
  "historicalPerformanceScore": based_on_past_performance,
  "marketConditionScore": market_favorability,
  "profitabilityScore": profit_potential,
  "routeOptimizationScore": route_efficiency,
  "riskScore": risk_assessment,
  "confidence": confidence_level,
  "competitiveRatePosition": "below_market|at_market|above_market",
  "demandLevel": "low|medium|high",
  "seasonalAdjustment": seasonal_factor,
  "reasoningFactors": {
    "strengths": ["factor1", "factor2"],
    "concerns": ["concern1", "concern2"],
    "recommendations": ["action1", "action2"]
  },
  "predictions": {
    "successProbability": percentage,
    "onTimeDeliveryLikelihood": percentage
  }
}`;
  }

  private extractState(address: string): string {
    const stateMatch = address.match(/\b([A-Z]{2})\b/);
    return stateMatch ? stateMatch[1] : "Unknown";
  }

  private calculateBackhaulScore(deadheadMiles: number, layoverHours: number, profitImprovement: number): number {
    let score = 100;
    score -= deadheadMiles * 2; // Penalty for deadhead
    score -= Math.max(0, layoverHours - 4) * 5; // Penalty for long layovers
    score += Math.min(50, profitImprovement / 10); // Bonus for profit improvement
    return Math.max(0, Math.min(100, score));
  }

  private groupLoadsByRoute(loads: Load[]): Record<string, Load[]> {
    const groups: Record<string, Load[]> = {};
    
    for (const load of loads) {
      const originState = this.extractState(load.pickupAddress);
      const destinationState = this.extractState(load.deliveryAddress);
      const key = `${originState}|${destinationState}|${load.equipmentType}`;
      
      if (!groups[key]) groups[key] = [];
      groups[key].push(load);
    }
    
    return groups;
  }

  private calculateTruckDemand(loadVolume: number): number {
    // Simplified truck demand calculation
    return Math.min(5.0, loadVolume / 10);
  }

  private calculateSeasonalFactor(): number {
    const month = new Date().getMonth();
    // Simplified seasonal factors
    const factors = [0.9, 0.9, 1.0, 1.1, 1.1, 1.2, 1.2, 1.1, 1.0, 1.0, 0.9, 0.8];
    return factors[month];
  }

  private getWeekStart(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day;
    return new Date(d.setDate(diff));
  }

  // Database save methods
  private async saveLoadRecommendation(recommendation: InsertLoadRecommendations): Promise<void> {
    try {
      await db.insert(loadRecommendations).values(recommendation);
    } catch (error) {
      console.error("Error saving load recommendation:", error);
    }
  }

  private async saveBackhaulOpportunity(opportunity: InsertBackhaulOpportunities): Promise<void> {
    try {
      await db.insert(backhaulOpportunities).values(opportunity);
    } catch (error) {
      console.error("Error saving backhaul opportunity:", error);
    }
  }

  private async saveMarketTrend(trend: InsertMarketRateTrends): Promise<void> {
    try {
      await db.insert(marketRateTrends).values(trend);
    } catch (error) {
      console.error("Error saving market trend:", error);
    }
  }

  private async saveCostCalculation(calculation: InsertCostCalculations): Promise<void> {
    try {
      await db.insert(costCalculations).values(calculation);
    } catch (error) {
      console.error("Error saving cost calculation:", error);
    }
  }

  private async saveAIAnalytics(analytics: InsertAiAnalytics): Promise<void> {
    try {
      await db.insert(aiAnalytics).values(analytics);
    } catch (error) {
      console.error("Error saving AI analytics:", error);
    }
  }

  // Track driver performance for learning
  async recordLoadOutcome(driverId: string, loadId: string, outcome: Partial<InsertDriverLoadHistory>): Promise<void> {
    try {
      const load = await db.select().from(loads).where(eq(loads.id, loadId)).limit(1);
      if (!load.length) return;

      const loadData = load[0];
      const historyRecord: InsertDriverLoadHistory = {
        driverId,
        loadId,
        originState: this.extractState(loadData.pickupAddress),
        destinationState: this.extractState(loadData.deliveryAddress),
        originCity: loadData.pickupAddress.split(',')[0] || "Unknown",
        destinationCity: loadData.deliveryAddress.split(',')[0] || "Unknown",
        equipmentType: loadData.equipmentType,
        loadType: loadData.loadType || "full",
        acceptedRate: loadData.rate || 0,
        ratePerMile: (loadData.rate || 0) / (loadData.miles || 1),
        totalMiles: loadData.miles || 0,
        acceptedAt: new Date(),
        ...outcome
      };

      await db.insert(driverLoadHistory).values(historyRecord);
      console.log(`📊 Recorded load outcome for driver ${driverId}, load ${loadId}`);
    } catch (error) {
      console.error("Error recording load outcome:", error);
    }
  }
}

export const smartLoadMatchingService = new SmartLoadMatchingService();