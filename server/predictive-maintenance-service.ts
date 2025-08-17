import type { 
  Vehicle, 
  InsertVehicle, 
  MaintenanceAlert, 
  InsertMaintenanceAlert,
  MaintenanceRecord,
  InsertMaintenanceRecord,
  VehicleMetrics,
  InsertVehicleMetrics 
} from "@shared/schema";

interface MaintenanceFactors {
  mileageScore: number;
  timeScore: number;
  usageScore: number;
  performanceScore: number;
  healthScore: number;
  riskFactors: string[];
}

interface PredictiveAlert {
  vehicleId: string;
  alertType: 'due_soon' | 'overdue' | 'critical' | 'predictive';
  maintenanceType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  currentMileage: number;
  dueMileage?: number;
  mileageOverdue: number;
  dueDate?: Date;
  daysOverdue: number;
  riskScore: number;
  estimatedCost: number;
  predictiveFactors: MaintenanceFactors;
  priority: number;
}

export class PredictiveMaintenanceService {
  private vehicles: Map<string, Vehicle> = new Map();
  private alerts: Map<string, MaintenanceAlert> = new Map();
  private records: Map<string, MaintenanceRecord> = new Map();
  private metrics: Map<string, VehicleMetrics[]> = new Map();

  constructor() {
    this.initializeTestData();
  }

  // Initialize test data for demonstration
  private initializeTestData(): void {
    const testVehicles: Vehicle[] = [
      {
        id: "vh-001",
        vehicleNumber: "TRUCK001",
        driverId: "600e6379-6bf3-4aa0-b939-c26ccee04a17", // Mike Johnson
        make: "Freightliner",
        model: "Cascadia",
        year: 2020,
        vin: "3AKJGLDR5LSGG1234",
        licensePlate: "TX-ABC-123",
        equipmentType: "dry_van",
        engineType: "diesel",
        engineModel: "DD13",
        fuelCapacity: 150,
        weightCapacity: 80000,
        currentMileage: 287500,
        currentEngineHours: 15200,
        lastServiceMileage: 275000,
        nextServiceDue: 290000,
        oilChangeInterval: 15000,
        lastOilChange: new Date('2024-12-15'),
        nextOilChangeDue: 285000,
        tireRotationInterval: 12000,
        lastTireRotation: new Date('2024-11-20'),
        nextTireRotationDue: 283000,
        brakeInspectionInterval: 30000,
        lastBrakeInspection: new Date('2024-10-01'),
        nextBrakeInspectionDue: 305000,
        status: "active",
        healthScore: 78,
        fuelEfficiency: 6.8,
        insuranceExpiry: new Date('2025-06-01'),
        registrationExpiry: new Date('2025-03-15'),
        inspectionExpiry: new Date('2025-02-28'),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "vh-002",
        vehicleNumber: "TRUCK002",
        driverId: null,
        make: "Peterbilt",
        model: "579",
        year: 2019,
        vin: "1XPWDB9X5KD123456",
        licensePlate: "FL-XYZ-789",
        equipmentType: "flatbed",
        engineType: "diesel",
        engineModel: "MX-13",
        fuelCapacity: 200,
        weightCapacity: 80000,
        currentMileage: 412300,
        currentEngineHours: 22100,
        lastServiceMileage: 405000,
        nextServiceDue: 420000,
        oilChangeInterval: 15000,
        lastOilChange: new Date('2025-01-10'),
        nextOilChangeDue: 420000,
        tireRotationInterval: 12000,
        lastTireRotation: new Date('2024-12-18'),
        nextTireRotationDue: 415000,
        brakeInspectionInterval: 30000,
        lastBrakeInspection: new Date('2024-09-15'),
        nextBrakeInspectionDue: 435000,
        status: "active",
        healthScore: 85,
        fuelEfficiency: 7.2,
        insuranceExpiry: new Date('2025-08-01'),
        registrationExpiry: new Date('2025-04-20'),
        inspectionExpiry: new Date('2025-01-31'),
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    ];

    testVehicles.forEach(vehicle => {
      this.vehicles.set(vehicle.id, vehicle);
    });

    // Generate initial metrics for vehicles
    this.generateVehicleMetrics();
  }

  // Generate realistic vehicle metrics data
  private generateVehicleMetrics(): void {
    this.vehicles.forEach((vehicle, vehicleId) => {
      const metrics: VehicleMetrics[] = [];
      
      // Generate 30 days of metrics
      for (let i = 30; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        
        const dailyMiles = Math.floor(Math.random() * 500) + 200; // 200-700 miles per day
        const baseMileage = vehicle.currentMileage - (i * dailyMiles);
        
        metrics.push({
          id: `vm-${vehicleId}-${i}`,
          vehicleId,
          recordDate: date,
          mileage: baseMileage,
          engineHours: vehicle.currentEngineHours - (i * (dailyMiles / 45)), // ~45 mph average
          fuelUsed: dailyMiles / vehicle.fuelEfficiency,
          fuelEfficiency: vehicle.fuelEfficiency + (Math.random() - 0.5), // +/- 0.5 mpg variance
          idleTime: Math.random() * 2, // 0-2 hours idle
          averageSpeed: 45 + (Math.random() * 20), // 45-65 mph
          maxSpeed: 65 + (Math.random() * 15), // 65-80 mph
          engineLoad: 60 + (Math.random() * 30), // 60-90% load
          coolantTemp: 180 + (Math.random() * 20), // 180-200°F
          oilPressure: 35 + (Math.random() * 15), // 35-50 psi
          batteryVoltage: 12.5 + (Math.random() * 1.5), // 12.5-14V
          harshBraking: Math.floor(Math.random() * 5), // 0-4 events
          harshAcceleration: Math.floor(Math.random() * 3), // 0-2 events
          sharpTurns: Math.floor(Math.random() * 8), // 0-7 events
          engineHealthScore: this.calculateEngineHealthScore(vehicle, baseMileage),
          brakeHealthScore: this.calculateBrakeHealthScore(vehicle, baseMileage),
          transmissionHealthScore: this.calculateTransmissionHealthScore(vehicle, baseMileage),
          overallHealthScore: vehicle.healthScore + (Math.random() - 0.5) * 10, // +/- 5 points variance
          createdAt: date,
        });
      }
      
      this.metrics.set(vehicleId, metrics);
    });
  }

  // Calculate engine health score based on various factors
  private calculateEngineHealthScore(vehicle: Vehicle, currentMileage: number): number {
    const baseScore = 100;
    const age = new Date().getFullYear() - vehicle.year;
    const mileageFactor = currentMileage / 100000; // Deduct points per 100k miles
    const serviceFactor = Math.max(0, (currentMileage - vehicle.lastServiceMileage) / 1000);
    
    return Math.max(20, baseScore - (age * 2) - (mileageFactor * 5) - (serviceFactor * 0.1));
  }

  // Calculate brake health score
  private calculateBrakeHealthScore(vehicle: Vehicle, currentMileage: number): number {
    const baseScore = 100;
    const lastInspection = vehicle.lastBrakeInspection ? 
      (Date.now() - vehicle.lastBrakeInspection.getTime()) / (1000 * 60 * 60 * 24) : 365;
    const mileageSinceInspection = Math.max(0, currentMileage - (vehicle.nextBrakeInspectionDue - vehicle.brakeInspectionInterval));
    
    return Math.max(30, baseScore - (lastInspection * 0.1) - (mileageSinceInspection / 1000));
  }

  // Calculate transmission health score
  private calculateTransmissionHealthScore(vehicle: Vehicle, currentMileage: number): number {
    const baseScore = 100;
    const age = new Date().getFullYear() - vehicle.year;
    const mileageFactor = currentMileage / 150000; // Transmissions last longer
    
    return Math.max(40, baseScore - (age * 1.5) - (mileageFactor * 3));
  }

  // Analyze all vehicles and generate predictive maintenance alerts
  public async analyzeMaintenanceNeeds(): Promise<PredictiveAlert[]> {
    const alerts: PredictiveAlert[] = [];
    
    for (const [vehicleId, vehicle] of this.vehicles) {
      const vehicleAlerts = await this.analyzeVehicle(vehicle);
      alerts.push(...vehicleAlerts);
    }
    
    // Sort by priority (higher number = higher priority)
    return alerts.sort((a, b) => b.priority - a.priority);
  }

  // Analyze a single vehicle for maintenance needs
  private async analyzeVehicle(vehicle: Vehicle): Promise<PredictiveAlert[]> {
    const alerts: PredictiveAlert[] = [];
    const vehicleMetrics = this.metrics.get(vehicle.id) || [];
    const latestMetrics = vehicleMetrics[vehicleMetrics.length - 1];
    
    if (!latestMetrics) return alerts;
    
    // Check oil change needs
    const oilAlert = this.checkOilChangeDue(vehicle, latestMetrics);
    if (oilAlert) alerts.push(oilAlert);
    
    // Check tire rotation needs
    const tireAlert = this.checkTireRotationDue(vehicle, latestMetrics);
    if (tireAlert) alerts.push(tireAlert);
    
    // Check brake inspection needs
    const brakeAlert = this.checkBrakeInspectionDue(vehicle, latestMetrics);
    if (brakeAlert) alerts.push(brakeAlert);
    
    // Check general service needs
    const serviceAlert = this.checkGeneralServiceDue(vehicle, latestMetrics);
    if (serviceAlert) alerts.push(serviceAlert);
    
    // Predictive analysis based on metrics trends
    const predictiveAlerts = this.performPredictiveAnalysis(vehicle, vehicleMetrics);
    alerts.push(...predictiveAlerts);
    
    // Check expiration dates
    const expirationAlerts = this.checkExpirationDates(vehicle);
    alerts.push(...expirationAlerts);
    
    return alerts;
  }

  // Check if oil change is due
  private checkOilChangeDue(vehicle: Vehicle, metrics: VehicleMetrics): PredictiveAlert | null {
    const mileageOverdue = Math.max(0, metrics.mileage - vehicle.nextOilChangeDue);
    const mileagesUntilDue = vehicle.nextOilChangeDue - metrics.mileage;
    
    if (mileageOverdue > 0) {
      return {
        vehicleId: vehicle.id,
        alertType: 'overdue',
        maintenanceType: 'oil_change',
        severity: mileageOverdue > 5000 ? 'critical' : 'high',
        title: `Oil Change Overdue - ${vehicle.vehicleNumber}`,
        description: `Vehicle is ${mileageOverdue.toLocaleString()} miles overdue for an oil change. Current mileage: ${metrics.mileage.toLocaleString()}`,
        currentMileage: metrics.mileage,
        dueMileage: vehicle.nextOilChangeDue,
        mileageOverdue,
        daysOverdue: 0,
        riskScore: Math.min(100, 50 + (mileageOverdue / 100)),
        estimatedCost: 250,
        predictiveFactors: {
          mileageScore: 100,
          timeScore: 0,
          usageScore: metrics.engineLoad || 0,
          performanceScore: metrics.engineHealthScore || 0,
          healthScore: vehicle.healthScore,
          riskFactors: ['Overdue maintenance', 'Engine wear risk']
        },
        priority: mileageOverdue > 5000 ? 5 : 4,
      };
    } else if (mileagesUntilDue <= 2000) {
      return {
        vehicleId: vehicle.id,
        alertType: 'due_soon',
        maintenanceType: 'oil_change',
        severity: 'medium',
        title: `Oil Change Due Soon - ${vehicle.vehicleNumber}`,
        description: `Oil change is due in ${mileagesUntilDue.toLocaleString()} miles. Schedule maintenance soon.`,
        currentMileage: metrics.mileage,
        dueMileage: vehicle.nextOilChangeDue,
        mileageOverdue: 0,
        daysOverdue: 0,
        riskScore: 25,
        estimatedCost: 250,
        predictiveFactors: {
          mileageScore: 75,
          timeScore: 0,
          usageScore: metrics.engineLoad || 0,
          performanceScore: metrics.engineHealthScore || 0,
          healthScore: vehicle.healthScore,
          riskFactors: ['Approaching service interval']
        },
        priority: 3,
      };
    }
    
    return null;
  }

  // Check if tire rotation is due
  private checkTireRotationDue(vehicle: Vehicle, metrics: VehicleMetrics): PredictiveAlert | null {
    const mileageOverdue = Math.max(0, metrics.mileage - vehicle.nextTireRotationDue);
    const milesUntilDue = vehicle.nextTireRotationDue - metrics.mileage;
    
    if (mileageOverdue > 0) {
      return {
        vehicleId: vehicle.id,
        alertType: 'overdue',
        maintenanceType: 'tire_rotation',
        severity: 'medium',
        title: `Tire Rotation Overdue - ${vehicle.vehicleNumber}`,
        description: `Vehicle is ${mileageOverdue.toLocaleString()} miles overdue for tire rotation. Uneven tire wear may occur.`,
        currentMileage: metrics.mileage,
        dueMileage: vehicle.nextTireRotationDue,
        mileageOverdue,
        daysOverdue: 0,
        riskScore: Math.min(80, 30 + (mileageOverdue / 200)),
        estimatedCost: 150,
        predictiveFactors: {
          mileageScore: 100,
          timeScore: 0,
          usageScore: (metrics.sharpTurns || 0) * 10,
          performanceScore: 100,
          healthScore: vehicle.healthScore,
          riskFactors: ['Tire wear risk', 'Fuel efficiency impact']
        },
        priority: mileageOverdue > 3000 ? 3 : 2,
      };
    } else if (milesUntilDue <= 1500) {
      return {
        vehicleId: vehicle.id,
        alertType: 'due_soon',
        maintenanceType: 'tire_rotation',
        severity: 'low',
        title: `Tire Rotation Due Soon - ${vehicle.vehicleNumber}`,
        description: `Tire rotation is due in ${milesUntilDue.toLocaleString()} miles.`,
        currentMileage: metrics.mileage,
        dueMileage: vehicle.nextTireRotationDue,
        mileageOverdue: 0,
        daysOverdue: 0,
        riskScore: 15,
        estimatedCost: 150,
        predictiveFactors: {
          mileageScore: 60,
          timeScore: 0,
          usageScore: (metrics.sharpTurns || 0) * 10,
          performanceScore: 100,
          healthScore: vehicle.healthScore,
          riskFactors: ['Maintenance due soon']
        },
        priority: 2,
      };
    }
    
    return null;
  }

  // Check if brake inspection is due
  private checkBrakeInspectionDue(vehicle: Vehicle, metrics: VehicleMetrics): PredictiveAlert | null {
    const mileageOverdue = Math.max(0, metrics.mileage - vehicle.nextBrakeInspectionDue);
    const milesUntilDue = vehicle.nextBrakeInspectionDue - metrics.mileage;
    
    if (mileageOverdue > 0) {
      return {
        vehicleId: vehicle.id,
        alertType: 'overdue',
        maintenanceType: 'brake_inspection',
        severity: 'high',
        title: `Brake Inspection Overdue - ${vehicle.vehicleNumber}`,
        description: `Vehicle is ${mileageOverdue.toLocaleString()} miles overdue for brake inspection. Safety risk!`,
        currentMileage: metrics.mileage,
        dueMileage: vehicle.nextBrakeInspectionDue,
        mileageOverdue,
        daysOverdue: 0,
        riskScore: Math.min(100, 60 + (mileageOverdue / 100)),
        estimatedCost: 400,
        predictiveFactors: {
          mileageScore: 100,
          timeScore: 0,
          usageScore: (metrics.harshBraking || 0) * 20,
          performanceScore: metrics.brakeHealthScore || 0,
          healthScore: vehicle.healthScore,
          riskFactors: ['Safety critical', 'Brake system wear', 'Regulatory compliance']
        },
        priority: 5,
      };
    } else if (milesUntilDue <= 5000) {
      return {
        vehicleId: vehicle.id,
        alertType: 'due_soon',
        maintenanceType: 'brake_inspection',
        severity: 'medium',
        title: `Brake Inspection Due Soon - ${vehicle.vehicleNumber}`,
        description: `Brake inspection is due in ${milesUntilDue.toLocaleString()} miles.`,
        currentMileage: metrics.mileage,
        dueMileage: vehicle.nextBrakeInspectionDue,
        mileageOverdue: 0,
        daysOverdue: 0,
        riskScore: 25,
        estimatedCost: 400,
        predictiveFactors: {
          mileageScore: 50,
          timeScore: 0,
          usageScore: (metrics.harshBraking || 0) * 20,
          performanceScore: metrics.brakeHealthScore || 0,
          healthScore: vehicle.healthScore,
          riskFactors: ['Safety maintenance due']
        },
        priority: 3,
      };
    }
    
    return null;
  }

  // Check if general service is due
  private checkGeneralServiceDue(vehicle: Vehicle, metrics: VehicleMetrics): PredictiveAlert | null {
    const mileageOverdue = Math.max(0, metrics.mileage - vehicle.nextServiceDue);
    const milesUntilDue = vehicle.nextServiceDue - metrics.mileage;
    
    if (mileageOverdue > 0) {
      return {
        vehicleId: vehicle.id,
        alertType: 'overdue',
        maintenanceType: 'general_service',
        severity: 'high',
        title: `General Service Overdue - ${vehicle.vehicleNumber}`,
        description: `Vehicle is ${mileageOverdue.toLocaleString()} miles overdue for general service.`,
        currentMileage: metrics.mileage,
        dueMileage: vehicle.nextServiceDue,
        mileageOverdue,
        daysOverdue: 0,
        riskScore: Math.min(90, 40 + (mileageOverdue / 150)),
        estimatedCost: 800,
        predictiveFactors: {
          mileageScore: 100,
          timeScore: 0,
          usageScore: metrics.engineLoad || 0,
          performanceScore: metrics.overallHealthScore || 0,
          healthScore: vehicle.healthScore,
          riskFactors: ['Comprehensive maintenance overdue', 'Multiple system check needed']
        },
        priority: 4,
      };
    } else if (milesUntilDue <= 3000) {
      return {
        vehicleId: vehicle.id,
        alertType: 'due_soon',
        maintenanceType: 'general_service',
        severity: 'medium',
        title: `General Service Due Soon - ${vehicle.vehicleNumber}`,
        description: `General service is due in ${milesUntilDue.toLocaleString()} miles.`,
        currentMileage: metrics.mileage,
        dueMileage: vehicle.nextServiceDue,
        mileageOverdue: 0,
        daysOverdue: 0,
        riskScore: 20,
        estimatedCost: 800,
        predictiveFactors: {
          mileageScore: 65,
          timeScore: 0,
          usageScore: metrics.engineLoad || 0,
          performanceScore: metrics.overallHealthScore || 0,
          healthScore: vehicle.healthScore,
          riskFactors: ['Scheduled maintenance due']
        },
        priority: 3,
      };
    }
    
    return null;
  }

  // Perform predictive analysis based on metrics trends
  private performPredictiveAnalysis(vehicle: Vehicle, metrics: VehicleMetrics[]): PredictiveAlert[] {
    const alerts: PredictiveAlert[] = [];
    
    if (metrics.length < 7) return alerts; // Need at least a week of data
    
    const recent = metrics.slice(-7); // Last 7 days
    const avgHealthScore = recent.reduce((sum, m) => sum + (m.overallHealthScore || 0), 0) / recent.length;
    const avgEngineHealth = recent.reduce((sum, m) => sum + (m.engineHealthScore || 0), 0) / recent.length;
    const avgFuelEff = recent.reduce((sum, m) => sum + (m.fuelEfficiency || 0), 0) / recent.length;
    const totalHarshEvents = recent.reduce((sum, m) => sum + (m.harshBraking || 0) + (m.harshAcceleration || 0), 0);
    
    // Engine health declining rapidly
    if (avgEngineHealth < 60 && vehicle.healthScore > 70) {
      alerts.push({
        vehicleId: vehicle.id,
        alertType: 'predictive',
        maintenanceType: 'engine_diagnostic',
        severity: 'high',
        title: `Engine Performance Declining - ${vehicle.vehicleNumber}`,
        description: `Engine health score has dropped to ${avgEngineHealth.toFixed(1)}. Recommend immediate diagnostic.`,
        currentMileage: metrics[metrics.length - 1].mileage,
        mileageOverdue: 0,
        daysOverdue: 0,
        riskScore: 85,
        estimatedCost: 1200,
        predictiveFactors: {
          mileageScore: 0,
          timeScore: 0,
          usageScore: 0,
          performanceScore: avgEngineHealth,
          healthScore: avgHealthScore,
          riskFactors: ['Engine performance decline', 'Potential major repair needed']
        },
        priority: 4,
      });
    }
    
    // Fuel efficiency declining
    if (avgFuelEff < vehicle.fuelEfficiency * 0.85) {
      alerts.push({
        vehicleId: vehicle.id,
        alertType: 'predictive',
        maintenanceType: 'fuel_system',
        severity: 'medium',
        title: `Fuel Efficiency Declining - ${vehicle.vehicleNumber}`,
        description: `Fuel efficiency has dropped to ${avgFuelEff.toFixed(1)} MPG. Check filters and fuel system.`,
        currentMileage: metrics[metrics.length - 1].mileage,
        mileageOverdue: 0,
        daysOverdue: 0,
        riskScore: 40,
        estimatedCost: 350,
        predictiveFactors: {
          mileageScore: 0,
          timeScore: 0,
          usageScore: 0,
          performanceScore: (avgFuelEff / vehicle.fuelEfficiency) * 100,
          healthScore: avgHealthScore,
          riskFactors: ['Fuel efficiency decline', 'Filter replacement needed']
        },
        priority: 2,
      });
    }
    
    // Excessive harsh driving events
    if (totalHarshEvents > 20) {
      alerts.push({
        vehicleId: vehicle.id,
        alertType: 'predictive',
        maintenanceType: 'brake_system',
        severity: 'medium',
        title: `Excessive Harsh Driving Events - ${vehicle.vehicleNumber}`,
        description: `${totalHarshEvents} harsh events recorded in the past week. Check brakes and suspension.`,
        currentMileage: metrics[metrics.length - 1].mileage,
        mileageOverdue: 0,
        daysOverdue: 0,
        riskScore: 50,
        estimatedCost: 600,
        predictiveFactors: {
          mileageScore: 0,
          timeScore: 0,
          usageScore: totalHarshEvents * 5,
          performanceScore: avgHealthScore,
          healthScore: avgHealthScore,
          riskFactors: ['Excessive harsh driving', 'Brake wear acceleration', 'Suspension stress']
        },
        priority: 3,
      });
    }
    
    return alerts;
  }

  // Check expiration dates for insurance, registration, etc.
  private checkExpirationDates(vehicle: Vehicle): PredictiveAlert[] {
    const alerts: PredictiveAlert[] = [];
    const now = new Date();
    const thirtyDays = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000));
    
    // Insurance expiry
    if (vehicle.insuranceExpiry && vehicle.insuranceExpiry <= thirtyDays) {
      const daysUntilExpiry = Math.ceil((vehicle.insuranceExpiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      alerts.push({
        vehicleId: vehicle.id,
        alertType: daysUntilExpiry <= 0 ? 'overdue' : 'due_soon',
        maintenanceType: 'insurance_renewal',
        severity: daysUntilExpiry <= 0 ? 'critical' : 'high',
        title: `Insurance ${daysUntilExpiry <= 0 ? 'Expired' : 'Expiring Soon'} - ${vehicle.vehicleNumber}`,
        description: `Insurance ${daysUntilExpiry <= 0 ? 'expired' : `expires in ${daysUntilExpiry} days`}. Renew immediately.`,
        currentMileage: vehicle.currentMileage,
        dueDate: vehicle.insuranceExpiry,
        mileageOverdue: 0,
        daysOverdue: daysUntilExpiry <= 0 ? Math.abs(daysUntilExpiry) : 0,
        riskScore: daysUntilExpiry <= 0 ? 100 : 80,
        estimatedCost: 2400, // Annual insurance cost
        predictiveFactors: {
          mileageScore: 0,
          timeScore: 100,
          usageScore: 0,
          performanceScore: 0,
          healthScore: 0,
          riskFactors: daysUntilExpiry <= 0 ? ['Vehicle uninsured', 'Legal violation'] : ['Insurance expires soon']
        },
        priority: 5,
      });
    }
    
    // Registration expiry
    if (vehicle.registrationExpiry && vehicle.registrationExpiry <= thirtyDays) {
      const daysUntilExpiry = Math.ceil((vehicle.registrationExpiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      alerts.push({
        vehicleId: vehicle.id,
        alertType: daysUntilExpiry <= 0 ? 'overdue' : 'due_soon',
        maintenanceType: 'registration_renewal',
        severity: daysUntilExpiry <= 0 ? 'critical' : 'high',
        title: `Registration ${daysUntilExpiry <= 0 ? 'Expired' : 'Expiring Soon'} - ${vehicle.vehicleNumber}`,
        description: `Registration ${daysUntilExpiry <= 0 ? 'expired' : `expires in ${daysUntilExpiry} days`}.`,
        currentMileage: vehicle.currentMileage,
        dueDate: vehicle.registrationExpiry,
        mileageOverdue: 0,
        daysOverdue: daysUntilExpiry <= 0 ? Math.abs(daysUntilExpiry) : 0,
        riskScore: daysUntilExpiry <= 0 ? 100 : 70,
        estimatedCost: 150,
        predictiveFactors: {
          mileageScore: 0,
          timeScore: 100,
          usageScore: 0,
          performanceScore: 0,
          healthScore: 0,
          riskFactors: daysUntilExpiry <= 0 ? ['Vehicle unregistered', 'Legal violation'] : ['Registration expires soon']
        },
        priority: 5,
      });
    }
    
    // Inspection expiry
    if (vehicle.inspectionExpiry && vehicle.inspectionExpiry <= thirtyDays) {
      const daysUntilExpiry = Math.ceil((vehicle.inspectionExpiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      alerts.push({
        vehicleId: vehicle.id,
        alertType: daysUntilExpiry <= 0 ? 'overdue' : 'due_soon',
        maintenanceType: 'safety_inspection',
        severity: daysUntilExpiry <= 0 ? 'critical' : 'high',
        title: `Safety Inspection ${daysUntilExpiry <= 0 ? 'Expired' : 'Expiring Soon'} - ${vehicle.vehicleNumber}`,
        description: `Safety inspection ${daysUntilExpiry <= 0 ? 'expired' : `expires in ${daysUntilExpiry} days`}.`,
        currentMileage: vehicle.currentMileage,
        dueDate: vehicle.inspectionExpiry,
        mileageOverdue: 0,
        daysOverdue: daysUntilExpiry <= 0 ? Math.abs(daysUntilExpiry) : 0,
        riskScore: daysUntilExpiry <= 0 ? 100 : 75,
        estimatedCost: 80,
        predictiveFactors: {
          mileageScore: 0,
          timeScore: 100,
          usageScore: 0,
          performanceScore: 0,
          healthScore: 0,
          riskFactors: daysUntilExpiry <= 0 ? ['Vehicle uninspected', 'Safety violation'] : ['Inspection expires soon']
        },
        priority: 5,
      });
    }
    
    return alerts;
  }

  // Get all vehicles
  public async getAllVehicles(): Promise<Vehicle[]> {
    return Array.from(this.vehicles.values());
  }

  // Add new vehicle
  public async addVehicle(vehicleData: any): Promise<Vehicle> {
    const vehicleId = `vh-${Date.now()}`;
    
    const newVehicle: Vehicle = {
      id: vehicleId,
      vehicleNumber: vehicleData.vehicleNumber,
      make: vehicleData.make,
      model: vehicleData.model,
      year: vehicleData.year,
      currentMileage: vehicleData.currentMileage,
      equipmentType: vehicleData.equipmentType,
      status: vehicleData.status || 'active',
      healthScore: 100, // New vehicle starts with perfect health
      fuelEfficiency: 7.0, // Default fuel efficiency
      lastMaintenanceDate: new Date().toISOString(),
      nextMaintenanceDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString() // 90 days from now
    };

    this.vehicles.set(vehicleId, newVehicle);
    console.log(`Added new vehicle: ${newVehicle.vehicleNumber} (${newVehicle.make} ${newVehicle.model})`);
    return newVehicle;
  }

  // Update vehicle mileage
  public async updateVehicleMileage(vehicleId: string, newMileage: number): Promise<Vehicle | null> {
    const vehicle = this.vehicles.get(vehicleId);
    
    if (!vehicle) {
      return null;
    }

    // Update mileage and recalculate health score
    const updatedVehicle: Vehicle = {
      ...vehicle,
      currentMileage: newMileage,
      healthScore: Math.max(50, vehicle.healthScore - (newMileage > vehicle.currentMileage ? Math.floor((newMileage - vehicle.currentMileage) / 5000) : 0))
    };

    this.vehicles.set(vehicleId, updatedVehicle);
    console.log(`Updated vehicle ${vehicleId} mileage to ${newMileage}`);
    return updatedVehicle;
  }

  // Get vehicle by ID
  public async getVehicle(id: string): Promise<Vehicle | undefined> {
    return this.vehicles.get(id);
  }

  // Get vehicle metrics
  public async getVehicleMetrics(vehicleId: string): Promise<VehicleMetrics[]> {
    return this.metrics.get(vehicleId) || [];
  }

  // Update vehicle mileage (from GPS or manual input)
  public async updateVehicleMileage(vehicleId: string, newMileage: number): Promise<void> {
    const vehicle = this.vehicles.get(vehicleId);
    if (vehicle) {
      vehicle.currentMileage = newMileage;
      vehicle.updatedAt = new Date();
      
      // Recalculate health score
      vehicle.healthScore = this.calculateOverallHealthScore(vehicle);
      
      this.vehicles.set(vehicleId, vehicle);
    }
  }

  // Calculate overall health score
  private calculateOverallHealthScore(vehicle: Vehicle): number {
    const age = new Date().getFullYear() - vehicle.year;
    const mileageFactor = vehicle.currentMileage / 100000;
    const serviceFactor = Math.max(0, (vehicle.currentMileage - vehicle.lastServiceMileage) / 5000);
    
    return Math.max(20, 100 - (age * 2) - (mileageFactor * 3) - (serviceFactor * 2));
  }

  // Acknowledge an alert
  public async acknowledgeAlert(alertId: string, acknowledgedBy: string): Promise<boolean> {
    // In a real implementation, this would update the database
    console.log(`Alert ${alertId} acknowledged by ${acknowledgedBy}`);
    return true;
  }

  // Resolve an alert
  public async resolveAlert(alertId: string, resolvedBy: string, notes?: string): Promise<boolean> {
    // In a real implementation, this would update the database
    console.log(`Alert ${alertId} resolved by ${resolvedBy}`, notes);
    return true;
  }
}