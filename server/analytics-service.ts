import { storage } from "./storage";
import type { 
  Driver, 
  Customer, 
  Load, 
  LoadWithRelations,
  DriverPerformanceMetrics,
  CustomerAnalytics,
  BusinessMetrics,
  ReportTemplate
} from "@shared/schema";

interface AnalyticsFilters {
  period?: string;
  startDate?: string;
  endDate?: string;
  driverId?: string;
  customerId?: string;
  metricType?: string;
}

interface DashboardMetrics {
  totalRevenue: number;
  totalLoads: number;
  activeDrivers: number;
  averageDeliveryTime: number;
  onTimeDeliveryRate: number;
  topPerformingDriver: string;
  monthlyGrowth: number;
  recentTrends: Array<{
    date: string;
    loads: number;
    revenue: number;
  }>;
}

interface DriverPerformanceData {
  driverId: string;
  driverName: string;
  loadsCompleted: number;
  onTimeDeliveries: number;
  totalRevenue: number;
  efficiency: number;
  rating: number;
  trends: Array<{
    period: string;
    loads: number;
    onTimeRate: number;
  }>;
}

interface CustomerInsight {
  customerId: string;
  customerName: string;
  totalLoads: number;
  totalRevenue: number;
  averageOrderValue: number;
  lastOrderDate: string;
  loyaltyScore: number;
  growthRate: number;
}

interface RevenueMetrics {
  totalRevenue: number;
  monthOverMonthGrowth: number;
  revenueByPeriod: Array<{
    period: string;
    revenue: number;
    loads: number;
    averageValue: number;
  }>;
  topCustomers: Array<{
    customer: string;
    revenue: number;
    percentage: number;
  }>;
}

class AnalyticsService {
  // Dashboard Analytics - High-level overview
  async getDashboardAnalytics(): Promise<DashboardMetrics> {
    try {
      const [loads, drivers, customers] = await Promise.all([
        storage.getAllLoads(),
        storage.getAllDrivers(),
        storage.getAllCustomers()
      ]);

      const deliveredLoads = loads.filter(load => load.status === 'delivered');
      const activeDrivers = drivers.filter(driver => driver.status !== 'unavailable');
      
      const totalRevenue = this.calculateTotalRevenue(deliveredLoads);
      const onTimeRate = this.calculateOnTimeDeliveryRate(deliveredLoads);
      const topDriver = this.findTopPerformingDriver(deliveredLoads, drivers);
      const monthlyGrowth = await this.calculateMonthlyGrowth(loads);
      const recentTrends = this.calculateRecentTrends(loads);

      return {
        totalRevenue,
        totalLoads: deliveredLoads.length,
        activeDrivers: activeDrivers.length,
        averageDeliveryTime: this.calculateAverageDeliveryTime(deliveredLoads),
        onTimeDeliveryRate: onTimeRate,
        topPerformingDriver: topDriver,
        monthlyGrowth,
        recentTrends
      };
    } catch (error) {
      console.error('Dashboard analytics error:', error);
      throw error;
    }
  }

  // Driver Performance Analytics
  async getDriverPerformance(filters: AnalyticsFilters): Promise<DriverPerformanceData[]> {
    try {
      const [loads, drivers] = await Promise.all([
        storage.getAllLoads(),
        storage.getAllDrivers()
      ]);

      const filteredLoads = this.filterLoadsByDate(loads, filters.startDate, filters.endDate);
      
      return drivers.map(driver => {
        const driverLoads = filteredLoads.filter(load => load.driverId === driver.id);
        const deliveredLoads = driverLoads.filter(load => load.status === 'delivered');
        const onTimeDeliveries = deliveredLoads.filter(load => 
          this.isDeliveredOnTime(load)
        );

        return {
          driverId: driver.id,
          driverName: driver.name,
          loadsCompleted: deliveredLoads.length,
          onTimeDeliveries: onTimeDeliveries.length,
          totalRevenue: this.calculateTotalRevenue(deliveredLoads),
          efficiency: this.calculateDriverEfficiency(driverLoads),
          rating: this.calculateDriverRating(deliveredLoads),
          trends: this.calculateDriverTrends(driverLoads, filters.period || 'monthly')
        };
      }).filter(performance => performance.loadsCompleted > 0)
        .sort((a, b) => b.efficiency - a.efficiency);
    } catch (error) {
      console.error('Driver performance error:', error);
      throw error;
    }
  }

  // Customer Insights Analytics  
  async getCustomerInsights(filters: AnalyticsFilters): Promise<CustomerInsight[]> {
    try {
      const [loads, customers] = await Promise.all([
        storage.getAllLoads(),
        storage.getAllCustomers()
      ]);

      const filteredLoads = this.filterLoadsByDate(loads, filters.startDate, filters.endDate);
      
      return customers.map(customer => {
        const customerLoads = filteredLoads.filter(load => load.customerId === customer.id);
        const deliveredLoads = customerLoads.filter(load => load.status === 'delivered');
        const totalRevenue = this.calculateTotalRevenue(deliveredLoads);
        
        return {
          customerId: customer.id,
          customerName: customer.name,
          totalLoads: deliveredLoads.length,
          totalRevenue,
          averageOrderValue: deliveredLoads.length > 0 ? totalRevenue / deliveredLoads.length : 0,
          lastOrderDate: this.getLastOrderDate(customerLoads),
          loyaltyScore: this.calculateLoyaltyScore(customerLoads),
          growthRate: this.calculateCustomerGrowthRate(customerLoads, filters.period || 'monthly')
        };
      }).filter(insight => insight.totalLoads > 0)
        .sort((a, b) => b.totalRevenue - a.totalRevenue);
    } catch (error) {
      console.error('Customer insights error:', error);
      throw error;
    }
  }

  // Business Metrics Analytics
  async getBusinessMetrics(filters: AnalyticsFilters): Promise<any> {
    try {
      const loads = await storage.getAllLoads();
      const filteredLoads = this.filterLoadsByDate(loads, filters.startDate, filters.endDate);
      
      const metrics = {
        revenue: this.calculateRevenueMetrics(filteredLoads),
        efficiency: this.calculateEfficiencyMetrics(filteredLoads),
        growth: this.calculateGrowthMetrics(filteredLoads),
        operational: this.calculateOperationalMetrics(filteredLoads)
      };

      return filters.metricType ? metrics[filters.metricType as keyof typeof metrics] : metrics;
    } catch (error) {
      console.error('Business metrics error:', error);
      throw error;
    }
  }

  // Load Trends Analytics
  async getLoadTrends(days: number): Promise<any> {
    try {
      const loads = await storage.getAllLoads();
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - (days * 24 * 60 * 60 * 1000));
      
      const trends = this.generateDateRange(startDate, endDate).map(date => {
        const dateLoads = loads.filter(load => 
          this.isSameDay(new Date(load.createdAt), date)
        );
        
        return {
          date: date.toISOString().split('T')[0],
          totalLoads: dateLoads.length,
          scheduled: dateLoads.filter(l => l.status === 'scheduled').length,
          inTransit: dateLoads.filter(l => l.status === 'in_transit').length,
          delivered: dateLoads.filter(l => l.status === 'delivered').length,
          cancelled: dateLoads.filter(l => l.status === 'cancelled').length,
          revenue: this.calculateTotalRevenue(dateLoads.filter(l => l.status === 'delivered'))
        };
      });

      return {
        trends,
        summary: {
          totalLoads: trends.reduce((sum, day) => sum + day.totalLoads, 0),
          averageDaily: trends.reduce((sum, day) => sum + day.totalLoads, 0) / trends.length,
          totalRevenue: trends.reduce((sum, day) => sum + day.revenue, 0),
          completionRate: this.calculateCompletionRate(loads.filter(load => 
            new Date(load.createdAt) >= startDate && new Date(load.createdAt) <= endDate
          ))
        }
      };
    } catch (error) {
      console.error('Load trends error:', error);
      throw error;
    }
  }

  // Revenue Analytics
  async getRevenueAnalytics(filters: AnalyticsFilters): Promise<RevenueMetrics> {
    try {
      const loads = await storage.getAllLoads();
      const filteredLoads = this.filterLoadsByDate(loads, filters.startDate, filters.endDate);
      const deliveredLoads = filteredLoads.filter(load => load.status === 'delivered');
      
      const totalRevenue = this.calculateTotalRevenue(deliveredLoads);
      const previousPeriodRevenue = await this.getPreviousPeriodRevenue(filters);
      const monthOverMonthGrowth = this.calculateGrowthRate(totalRevenue, previousPeriodRevenue);
      
      const customers = await storage.getAllCustomers();
      const revenueByCustomer = customers.map(customer => {
        const customerLoads = deliveredLoads.filter(load => load.customerId === customer.id);
        const revenue = this.calculateTotalRevenue(customerLoads);
        return {
          customer: customer.name,
          revenue,
          percentage: (revenue / totalRevenue) * 100
        };
      }).filter(item => item.revenue > 0)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10);

      return {
        totalRevenue,
        monthOverMonthGrowth,
        revenueByPeriod: this.calculateRevenueByPeriod(deliveredLoads, filters.period || 'monthly'),
        topCustomers: revenueByCustomer
      };
    } catch (error) {
      console.error('Revenue analytics error:', error);
      throw error;
    }
  }

  // Report Generation
  async generateReport(config: any): Promise<any> {
    try {
      const reportData: any = {};
      
      // Generate different sections based on config
      if (config.includeDashboard) {
        reportData.dashboard = await this.getDashboardAnalytics();
      }
      
      if (config.includeDriverPerformance) {
        reportData.driverPerformance = await this.getDriverPerformance(config.filters || {});
      }
      
      if (config.includeCustomerInsights) {
        reportData.customerInsights = await this.getCustomerInsights(config.filters || {});
      }
      
      if (config.includeRevenue) {
        reportData.revenueAnalytics = await this.getRevenueAnalytics(config.filters || {});
      }
      
      return {
        reportId: this.generateReportId(),
        generatedAt: new Date().toISOString(),
        config,
        data: reportData,
        summary: this.generateReportSummary(reportData)
      };
    } catch (error) {
      console.error('Report generation error:', error);
      throw error;
    }
  }

  // Helper Methods
  private calculateTotalRevenue(loads: Load[]): number {
    // Estimate revenue based on weight and distance (simplified calculation)
    return loads.reduce((total, load) => {
      const baseRate = 2.5; // $2.5 per pound base rate
      const revenue = load.weight * baseRate;
      return total + revenue;
    }, 0);
  }

  private calculateOnTimeDeliveryRate(loads: Load[]): number {
    if (loads.length === 0) return 0;
    const onTimeDeliveries = loads.filter(load => this.isDeliveredOnTime(load));
    return (onTimeDeliveries.length / loads.length) * 100;
  }

  private isDeliveredOnTime(load: Load): boolean {
    // Simplified: assume on-time if delivered status
    return load.status === 'delivered';
  }

  private findTopPerformingDriver(loads: Load[], drivers: Driver[]): string {
    const driverPerformance = drivers.map(driver => {
      const driverLoads = loads.filter(load => load.driverId === driver.id);
      return {
        name: driver.name,
        loads: driverLoads.length,
        revenue: this.calculateTotalRevenue(driverLoads)
      };
    });
    
    const topDriver = driverPerformance.reduce((best, current) => 
      current.revenue > best.revenue ? current : best,
      { name: 'N/A', loads: 0, revenue: 0 }
    );
    
    return topDriver.name;
  }

  private async calculateMonthlyGrowth(loads: Load[]): Promise<number> {
    const now = new Date();
    const currentMonthLoads = loads.filter(load => {
      const loadDate = new Date(load.createdAt);
      return loadDate.getMonth() === now.getMonth() && loadDate.getFullYear() === now.getFullYear();
    });
    
    const lastMonthLoads = loads.filter(load => {
      const loadDate = new Date(load.createdAt);
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return loadDate.getMonth() === lastMonth.getMonth() && loadDate.getFullYear() === lastMonth.getFullYear();
    });
    
    if (lastMonthLoads.length === 0) return 0;
    return ((currentMonthLoads.length - lastMonthLoads.length) / lastMonthLoads.length) * 100;
  }

  private calculateRecentTrends(loads: Load[]): Array<{date: string; loads: number; revenue: number}> {
    const last7Days = Array.from({length: 7}, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - i));
      return date;
    });

    return last7Days.map(date => {
      const dayLoads = loads.filter(load => this.isSameDay(new Date(load.createdAt), date));
      return {
        date: date.toISOString().split('T')[0],
        loads: dayLoads.length,
        revenue: this.calculateTotalRevenue(dayLoads.filter(l => l.status === 'delivered'))
      };
    });
  }

  private calculateAverageDeliveryTime(loads: Load[]): number {
    // Simplified calculation - return hours between pickup and delivery dates
    const deliveryTimes = loads.map(load => {
      const pickup = new Date(load.pickupDate);
      const delivery = new Date(load.deliveryDate);
      return (delivery.getTime() - pickup.getTime()) / (1000 * 60 * 60); // hours
    });
    
    return deliveryTimes.length > 0 
      ? deliveryTimes.reduce((sum, time) => sum + time, 0) / deliveryTimes.length 
      : 0;
  }

  private filterLoadsByDate(loads: Load[], startDate?: string, endDate?: string): Load[] {
    if (!startDate && !endDate) return loads;
    
    return loads.filter(load => {
      const loadDate = new Date(load.createdAt);
      if (startDate && loadDate < new Date(startDate)) return false;
      if (endDate && loadDate > new Date(endDate)) return false;
      return true;
    });
  }

  private calculateDriverEfficiency(loads: Load[]): number {
    if (loads.length === 0) return 0;
    const delivered = loads.filter(load => load.status === 'delivered');
    return (delivered.length / loads.length) * 100;
  }

  private calculateDriverRating(loads: Load[]): number {
    // Simplified rating based on completion rate and on-time delivery
    const onTimeRate = this.calculateOnTimeDeliveryRate(loads);
    const completionRate = loads.length > 0 ? (loads.filter(l => l.status === 'delivered').length / loads.length) * 100 : 0;
    return (onTimeRate + completionRate) / 2 / 20; // Scale to 0-5
  }

  private calculateDriverTrends(loads: Load[], period: string): Array<{period: string; loads: number; onTimeRate: number}> {
    // Simplified trends - return last 3 periods
    return [{
      period: 'Current',
      loads: loads.length,
      onTimeRate: this.calculateOnTimeDeliveryRate(loads)
    }];
  }

  private getLastOrderDate(loads: Load[]): string {
    if (loads.length === 0) return '';
    const sortedLoads = loads.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return sortedLoads[0].createdAt.toString();
  }

  private calculateLoyaltyScore(loads: Load[]): number {
    // Simplified loyalty score based on frequency and recency
    const monthsActive = this.getMonthsActive(loads);
    const avgLoadsPerMonth = loads.length / Math.max(monthsActive, 1);
    return Math.min(avgLoadsPerMonth * 10, 100); // Scale 0-100
  }

  private calculateCustomerGrowthRate(loads: Load[], period: string): number {
    // Simplified growth calculation
    const currentPeriodLoads = loads.filter(load => this.isInCurrentPeriod(load, period));
    const previousPeriodLoads = loads.filter(load => this.isInPreviousPeriod(load, period));
    
    if (previousPeriodLoads.length === 0) return 0;
    return ((currentPeriodLoads.length - previousPeriodLoads.length) / previousPeriodLoads.length) * 100;
  }

  private calculateRevenueMetrics(loads: Load[]): any {
    const deliveredLoads = loads.filter(load => load.status === 'delivered');
    return {
      total: this.calculateTotalRevenue(deliveredLoads),
      average: deliveredLoads.length > 0 ? this.calculateTotalRevenue(deliveredLoads) / deliveredLoads.length : 0,
      growth: 0 // Would need historical data
    };
  }

  private calculateEfficiencyMetrics(loads: Load[]): any {
    return {
      completionRate: this.calculateCompletionRate(loads),
      onTimeDeliveryRate: this.calculateOnTimeDeliveryRate(loads.filter(l => l.status === 'delivered')),
      utilizationRate: this.calculateUtilizationRate(loads)
    };
  }

  private calculateGrowthMetrics(loads: Load[]): any {
    return {
      volumeGrowth: 0, // Would need historical comparison
      revenueGrowth: 0,
      customerGrowth: 0
    };
  }

  private calculateOperationalMetrics(loads: Load[]): any {
    return {
      averageLoadValue: this.calculateAverageLoadValue(loads),
      averageDeliveryTime: this.calculateAverageDeliveryTime(loads),
      capacity: this.calculateCapacityUtilization(loads)
    };
  }

  private async getPreviousPeriodRevenue(filters: AnalyticsFilters): Promise<number> {
    // Simplified - return 0 for now
    return 0;
  }

  private calculateGrowthRate(current: number, previous: number): number {
    if (previous === 0) return 0;
    return ((current - previous) / previous) * 100;
  }

  private calculateRevenueByPeriod(loads: Load[], period: string): Array<{period: string; revenue: number; loads: number; averageValue: number}> {
    // Group loads by period and calculate metrics
    const grouped = this.groupLoadsByPeriod(loads, period);
    return Object.entries(grouped).map(([periodKey, periodLoads]) => ({
      period: periodKey,
      revenue: this.calculateTotalRevenue(periodLoads as Load[]),
      loads: (periodLoads as Load[]).length,
      averageValue: this.calculateAverageLoadValue(periodLoads as Load[])
    }));
  }

  // Utility helper methods
  private generateDateRange(startDate: Date, endDate: Date): Date[] {
    const dates = [];
    const currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
      dates.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return dates;
  }

  private isSameDay(date1: Date, date2: Date): boolean {
    return date1.toDateString() === date2.toDateString();
  }

  private calculateCompletionRate(loads: Load[]): number {
    if (loads.length === 0) return 0;
    const completed = loads.filter(load => load.status === 'delivered');
    return (completed.length / loads.length) * 100;
  }

  private calculateUtilizationRate(loads: Load[]): number {
    // Simplified utilization based on active vs total loads
    const activeLoads = loads.filter(load => ['scheduled', 'in_transit'].includes(load.status));
    return loads.length > 0 ? (activeLoads.length / loads.length) * 100 : 0;
  }

  private calculateAverageLoadValue(loads: Load[]): number {
    if (loads.length === 0) return 0;
    const totalRevenue = this.calculateTotalRevenue(loads);
    return totalRevenue / loads.length;
  }

  private calculateCapacityUtilization(loads: Load[]): number {
    // Simplified capacity calculation
    const totalWeight = loads.reduce((sum, load) => sum + load.weight, 0);
    const averageCapacity = 40000; // Assume 40k lbs average truck capacity
    return loads.length > 0 ? (totalWeight / (loads.length * averageCapacity)) * 100 : 0;
  }

  private getMonthsActive(loads: Load[]): number {
    if (loads.length === 0) return 0;
    const dates = loads.map(load => new Date(load.createdAt));
    const earliest = new Date(Math.min(...dates.map(d => d.getTime())));
    const latest = new Date(Math.max(...dates.map(d => d.getTime())));
    
    const monthDiff = (latest.getFullYear() - earliest.getFullYear()) * 12 + 
                     (latest.getMonth() - earliest.getMonth());
    return Math.max(monthDiff, 1);
  }

  private isInCurrentPeriod(load: Load, period: string): boolean {
    const loadDate = new Date(load.createdAt);
    const now = new Date();
    
    switch (period) {
      case 'monthly':
        return loadDate.getMonth() === now.getMonth() && loadDate.getFullYear() === now.getFullYear();
      case 'weekly':
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        return loadDate >= weekAgo;
      default:
        return true;
    }
  }

  private isInPreviousPeriod(load: Load, period: string): boolean {
    const loadDate = new Date(load.createdAt);
    const now = new Date();
    
    switch (period) {
      case 'monthly':
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        return loadDate.getMonth() === lastMonth.getMonth() && loadDate.getFullYear() === lastMonth.getFullYear();
      case 'weekly':
        const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        return loadDate >= twoWeeksAgo && loadDate < weekAgo;
      default:
        return false;
    }
  }

  private groupLoadsByPeriod(loads: Load[], period: string): Record<string, Load[]> {
    return loads.reduce((groups, load) => {
      const date = new Date(load.createdAt);
      let key: string;
      
      switch (period) {
        case 'daily':
          key = date.toISOString().split('T')[0];
          break;
        case 'weekly':
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          key = weekStart.toISOString().split('T')[0];
          break;
        case 'monthly':
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          break;
        default:
          key = date.toISOString().split('T')[0];
      }
      
      if (!groups[key]) groups[key] = [];
      groups[key].push(load);
      return groups;
    }, {} as Record<string, Load[]>);
  }

  private generateReportId(): string {
    return 'RPT-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  }

  private generateReportSummary(reportData: any): any {
    return {
      totalSections: Object.keys(reportData).length,
      generatedAt: new Date().toISOString(),
      dataPoints: this.countDataPoints(reportData)
    };
  }

  private countDataPoints(data: any): number {
    let count = 0;
    const traverse = (obj: any) => {
      for (const key in obj) {
        if (typeof obj[key] === 'object' && obj[key] !== null) {
          traverse(obj[key]);
        } else {
          count++;
        }
      }
    };
    traverse(data);
    return count;
  }
}

export const analyticsService = new AnalyticsService();