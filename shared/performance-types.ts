// Performance visualization types and calculations for drivers

export interface DriverPerformanceMetrics {
  driverId: string;
  driverName: string;
  
  // Load Performance
  totalLoads: number;
  completedLoads: number;
  completionRate: number; // percentage
  
  // Ratings and Quality
  averageRating: number;
  totalRatings: number;
  
  // Revenue and Distance
  totalRevenue: number;
  totalMiles: number;
  revenuePerMile: number;
  
  // Timeliness
  onTimeDeliveries: number;
  lateDeliveries: number;
  onTimeRate: number; // percentage
  averageDeliveryTime: number; // in hours
  
  // Reliability
  cancelledLoads: number;
  cancellationRate: number; // percentage
  currentStreak: number;
  bestStreak: number;
  
  // Efficiency Scores
  fuelEfficiency: number; // MPG
  maintenanceScore: number; // 0-100
  safetyScore: number; // 0-100
  overallScore: number; // calculated composite score
  
  // Activity
  lastLoadDate?: Date;
  daysSinceLastLoad?: number;
  
  // Trends (for visualization)
  performanceTrend: 'up' | 'down' | 'stable';
  recentActivity: 'high' | 'medium' | 'low';
}

export interface PerformanceChartData {
  period: string; // "Last 7 days", "Last 30 days", etc.
  loads: number;
  revenue: number;
  miles: number;
  rating: number;
}

export interface DriverRanking {
  driverId: string;
  driverName: string;
  rank: number;
  category: 'overall' | 'revenue' | 'efficiency' | 'reliability' | 'safety';
  score: number;
  improvement: number; // change from previous period
}

// Performance calculation utilities
export function calculateOverallScore(metrics: Partial<DriverPerformanceMetrics>): number {
  const weights = {
    completionRate: 0.25,
    onTimeRate: 0.25,
    averageRating: 0.2,
    safetyScore: 0.15,
    maintenanceScore: 0.15
  };
  
  const completionRate = metrics.completedLoads && metrics.totalLoads 
    ? (metrics.completedLoads / metrics.totalLoads) * 100 
    : 0;
  
  const onTimeRate = (metrics.onTimeDeliveries && metrics.completedLoads)
    ? (metrics.onTimeDeliveries / metrics.completedLoads) * 100
    : 0;
  
  const ratingScore = metrics.averageRating ? (metrics.averageRating / 5) * 100 : 0;
  
  return (
    (completionRate * weights.completionRate) +
    (onTimeRate * weights.onTimeRate) +
    (ratingScore * weights.averageRating) +
    ((metrics.safetyScore || 0) * weights.safetyScore) +
    ((metrics.maintenanceScore || 0) * weights.maintenanceScore)
  );
}

export function determinePerformanceTrend(
  currentScore: number, 
  previousScore: number
): 'up' | 'down' | 'stable' {
  const difference = currentScore - previousScore;
  if (Math.abs(difference) < 2) return 'stable';
  return difference > 0 ? 'up' : 'down';
}

export function categorizeActivity(daysSinceLastLoad?: number): 'high' | 'medium' | 'low' {
  if (!daysSinceLastLoad) return 'low';
  if (daysSinceLastLoad <= 3) return 'high';
  if (daysSinceLastLoad <= 7) return 'medium';
  return 'low';
}

// Performance badge configurations
export const PERFORMANCE_BADGES = {
  excellent: { threshold: 90, label: 'Excellent', color: 'green', icon: '🏆' },
  good: { threshold: 75, label: 'Good', color: 'blue', icon: '⭐' },
  average: { threshold: 60, label: 'Average', color: 'yellow', icon: '📊' },
  needs_improvement: { threshold: 0, label: 'Needs Improvement', color: 'red', icon: '📈' }
} as const;

export function getPerformanceBadge(score: number) {
  if (score >= PERFORMANCE_BADGES.excellent.threshold) return PERFORMANCE_BADGES.excellent;
  if (score >= PERFORMANCE_BADGES.good.threshold) return PERFORMANCE_BADGES.good;
  if (score >= PERFORMANCE_BADGES.average.threshold) return PERFORMANCE_BADGES.average;
  return PERFORMANCE_BADGES.needs_improvement;
}