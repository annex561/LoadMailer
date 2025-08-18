import type { Load, Driver, LoadOffer } from '@shared/schema';

export interface PredictionFactors {
  distanceScore: number;
  equipmentCompatibilityScore: number;
  rateAttractivenessScore: number;
  driverHistoryScore: number;
  timeOfDayScore: number;
  routePreferenceScore: number;
  recentActivityScore: number;
}

export interface ConfidencePrediction {
  confidenceScore: number; // 0-100%
  acceptanceProbability: number; // 0-100%
  factors: PredictionFactors;
  reasoning: string[];
  riskLevel: 'low' | 'medium' | 'high';
}

export class PredictionConfidenceService {
  
  /**
   * Calculate prediction confidence for a specific driver-load combination
   */
  async calculatePredictionConfidence(
    driver: Driver,
    load: Load,
    historicalOffers: LoadOffer[] = []
  ): Promise<ConfidencePrediction> {
    
    const factors = await this.calculatePredictionFactors(driver, load, historicalOffers);
    const confidenceScore = this.calculateOverallConfidence(factors);
    const acceptanceProbability = this.calculateAcceptanceProbability(factors);
    const reasoning = this.generateReasoningText(factors);
    const riskLevel = this.determineRiskLevel(confidenceScore);

    return {
      confidenceScore,
      acceptanceProbability,
      factors,
      reasoning,
      riskLevel
    };
  }

  private async calculatePredictionFactors(
    driver: Driver,
    load: Load,
    historicalOffers: LoadOffer[]
  ): Promise<PredictionFactors> {
    
    // Distance factor (closer = higher confidence)
    const distance = this.calculateDistance(driver.city || "", load.pickupAddress || "");
    const distanceScore = Math.max(0, 100 - (distance / 150) * 60); // 150mi = 40% penalty
    
    // Equipment compatibility (exact match = higher confidence)
    const equipmentCompatibilityScore = this.calculateEquipmentCompatibility(
      driver.equipmentType,
      load.equipmentType
    );
    
    // Rate attractiveness (higher rate per mile = higher confidence)
    const ratePerMile = (load.rate || 0) / (load.miles || 1);
    const averageRate = 2.50; // Industry average per mile
    const rateAttractivenessScore = Math.min(100, (ratePerMile / averageRate) * 100);
    
    // Driver history score (based on past acceptance patterns)
    const driverHistoryScore = this.calculateDriverHistoryScore(driver, historicalOffers);
    
    // Time of day factor (drivers more active during business hours)
    const timeOfDayScore = this.calculateTimeOfDayScore();
    
    // Route preference (based on driver's preferred lanes)
    const routePreferenceScore = this.calculateRoutePreferenceScore(
      driver,
      load.pickupAddress || "",
      load.deliveryAddress || ""
    );
    
    // Recent activity (recently active drivers more likely to respond)
    const recentActivityScore = this.calculateRecentActivityScore(driver, historicalOffers);

    return {
      distanceScore,
      equipmentCompatibilityScore,
      rateAttractivenessScore,
      driverHistoryScore,
      timeOfDayScore,
      routePreferenceScore,
      recentActivityScore
    };
  }

  private calculateDistance(driverCity: string, loadPickupCity: string): number {
    // Simple distance calculation - in production would use GPS coordinates
    const cityDistances: Record<string, Record<string, number>> = {
      'Atlanta, GA': {
        'Atlanta, GA': 0,
        'Dallas, TX': 720,
        'Chicago, IL': 589,
        'Miami, FL': 606,
        'Phoenix, AZ': 1589,
        'Los Angeles, CA': 1933,
        'New York, NY': 872,
        'Denver, CO': 1210,
        'Seattle, WA': 2182,
        'Boston, MA': 946,
        'Houston, TX': 789,
        'Jacksonville, FL': 346,
        'Charlotte, NC': 244,
        'Las Vegas, NV': 1747
      }
    };
    
    return cityDistances[driverCity]?.[loadPickupCity] || 999;
  }

  private calculateEquipmentCompatibility(driverEquipment: string, loadEquipment: string): number {
    const compatibilityMatrix: Record<string, string[]> = {
      'dry_van': ['dry_van', 'van', 'moving_van'],
      'straight_box_truck': ['straight_box_truck', 'van', 'moving_van'],
      'van_hotshot': ['van_hotshot', 'flatbed_hotshot', 'van', 'moving_van', 'van_lift_gate', 'sprinter_van'],
      'flatbed_hotshot': ['flatbed_hotshot', 'flatbed', 'van_hotshot'],
    };
    
    const compatibleTypes = compatibilityMatrix[driverEquipment] || [];
    if (driverEquipment === loadEquipment) return 100;
    if (compatibleTypes.includes(loadEquipment)) return 75;
    return 25;
  }

  private calculateDriverHistoryScore(driver: Driver, historicalOffers: LoadOffer[]): number {
    if (historicalOffers.length === 0) return 60; // Neutral for new drivers
    
    const acceptedOffers = historicalOffers.filter(offer => offer.status === 'accepted');
    const acceptanceRate = acceptedOffers.length / historicalOffers.length;
    
    // Bonus points for consistent acceptance patterns
    const consistencyBonus = acceptanceRate > 0.7 ? 20 : acceptanceRate > 0.5 ? 10 : 0;
    
    return Math.min(100, (acceptanceRate * 80) + consistencyBonus);
  }

  private calculateTimeOfDayScore(): number {
    const hour = new Date().getHours();
    
    // Business hours (8 AM - 6 PM) = higher confidence
    if (hour >= 8 && hour <= 18) return 90;
    // Early evening (6 PM - 10 PM) = moderate confidence
    if (hour >= 18 && hour <= 22) return 70;
    // Early morning (6 AM - 8 AM) = moderate confidence
    if (hour >= 6 && hour <= 8) return 75;
    // Night/late hours = lower confidence
    return 40;
  }

  private calculateRoutePreferenceScore(
    driver: Driver,
    pickupCity: string,
    deliveryCity: string
  ): number {
    // For now, return a neutral score since preferredLanes and avoidAreas 
    // are not yet implemented in the driver schema
    // This can be enhanced when route preferences are added to the driver model
    
    // Base score on equipment type and location familiarity
    const driverLocation = driver.city || "";
    
    // Bonus if pickup or delivery is in driver's city/state
    if (pickupCity.includes(driverLocation.split(',')[0]) || 
        deliveryCity.includes(driverLocation.split(',')[0])) {
      return 85; // Familiar route
    }
    
    return 70; // Neutral - no specific preferences available
  }

  private calculateRecentActivityScore(driver: Driver, historicalOffers: LoadOffer[]): number {
    const now = new Date();
    const recentOffers = historicalOffers.filter(offer => {
      const offerDate = new Date(offer.sentAt);
      const daysDiff = (now.getTime() - offerDate.getTime()) / (1000 * 60 * 60 * 24);
      return daysDiff <= 7; // Last 7 days
    });
    
    if (recentOffers.length === 0) return 50; // Neutral if no recent activity
    
    // More recent activity = higher confidence
    const recentAccepted = recentOffers.filter(offer => offer.status === 'accepted').length;
    const activityScore = Math.min(100, (recentAccepted / recentOffers.length) * 100);
    
    return activityScore;
  }

  private calculateOverallConfidence(factors: PredictionFactors): number {
    // Weighted average of all factors
    const weights = {
      distanceScore: 0.25,
      equipmentCompatibilityScore: 0.20,
      rateAttractivenessScore: 0.15,
      driverHistoryScore: 0.15,
      timeOfDayScore: 0.10,
      routePreferenceScore: 0.10,
      recentActivityScore: 0.05
    };
    
    let totalScore = 0;
    let totalWeight = 0;
    
    Object.entries(factors).forEach(([key, value]) => {
      const weight = weights[key as keyof typeof weights] || 0;
      totalScore += value * weight;
      totalWeight += weight;
    });
    
    return Math.round(totalScore / totalWeight);
  }

  private calculateAcceptanceProbability(factors: PredictionFactors): number {
    // Similar to confidence but adjusted for acceptance patterns
    const baseScore = this.calculateOverallConfidence(factors);
    
    // Apply acceptance curve (sigmoid-like transformation)
    // High scores get higher probability, low scores get lower
    const normalized = baseScore / 100;
    const probability = Math.round(
      100 * (1 / (1 + Math.exp(-6 * (normalized - 0.5))))
    );
    
    return Math.max(5, Math.min(95, probability)); // Cap between 5-95%
  }

  private generateReasoningText(factors: PredictionFactors): string[] {
    const reasoning: string[] = [];
    
    if (factors.distanceScore >= 80) {
      reasoning.push("Driver is very close to pickup location");
    } else if (factors.distanceScore <= 40) {
      reasoning.push("Driver is far from pickup location, may reduce acceptance");
    }
    
    if (factors.equipmentCompatibilityScore >= 90) {
      reasoning.push("Perfect equipment match for this load");
    } else if (factors.equipmentCompatibilityScore <= 50) {
      reasoning.push("Equipment compatibility concerns may affect acceptance");
    }
    
    if (factors.rateAttractivenessScore >= 120) {
      reasoning.push("Above-market rate makes this load very attractive");
    } else if (factors.rateAttractivenessScore <= 80) {
      reasoning.push("Below-market rate may reduce driver interest");
    }
    
    if (factors.driverHistoryScore >= 80) {
      reasoning.push("Driver has strong acceptance history");
    } else if (factors.driverHistoryScore <= 40) {
      reasoning.push("Driver has lower historical acceptance rates");
    }
    
    if (factors.timeOfDayScore <= 50) {
      reasoning.push("Off-hours timing may reduce response likelihood");
    }
    
    return reasoning.length > 0 ? reasoning : ["Standard prediction based on available factors"];
  }

  private determineRiskLevel(confidenceScore: number): 'low' | 'medium' | 'high' {
    if (confidenceScore >= 75) return 'low';
    if (confidenceScore >= 50) return 'medium';
    return 'high';
  }

  /**
   * Get predictions for all eligible drivers for a specific load
   */
  async getPredictionsForLoad(load: Load): Promise<Array<ConfidencePrediction & { driverId: string, driverName: string }>> {
    // Import storage service to get drivers
    const { storage } = await import('./storage');
    
    try {
      // Get all available drivers
      const drivers = await storage.getAllDrivers();
      const availableDrivers = drivers.filter((driver: Driver) => 
        driver.status === 'available' && 
        driver.isOnboarded &&
        driver.telegramUsername // Only drivers who can receive offers
      );

      // Generate predictions for each driver
      const predictions = await Promise.all(
        availableDrivers.map(async (driver: Driver) => {
          try {
            // Get historical offers for this driver (if available)
            const loadOffers = await storage.getAllLoadOffers();
            const driverOffers = loadOffers.filter((offer: LoadOffer) => offer.driverId === driver.id);
            
            const prediction = await this.calculatePredictionConfidence(driver, load, driverOffers);
            
            return {
              ...prediction,
              driverId: driver.id,
              driverName: `${driver.firstName} ${driver.lastName}`
            };
          } catch (error) {
            console.error(`Error calculating prediction for driver ${driver.id}:`, error);
            // Return a default prediction in case of error
            return {
              confidenceScore: 50,
              acceptanceProbability: 50,
              factors: {
                distanceScore: 50,
                equipmentCompatibilityScore: 50,
                rateAttractivenessScore: 50,
                driverHistoryScore: 50,
                timeOfDayScore: 50,
                routePreferenceScore: 50,
                recentActivityScore: 50
              },
              reasoning: ['Error calculating prediction - using default values'],
              riskLevel: 'medium' as const,
              driverId: driver.id,
              driverName: `${driver.firstName} ${driver.lastName}`
            };
          }
        })
      );

      // Sort by confidence score (highest first)
      return predictions.sort((a: any, b: any) => b.confidenceScore - a.confidenceScore);
      
    } catch (error) {
      console.error('Error getting predictions for load:', error);
      return [];
    }
  }
}