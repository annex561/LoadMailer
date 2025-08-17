import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { 
  AlertTriangle, 
  Clock, 
  CheckCircle, 
  XCircle, 
  Wrench, 
  TrendingUp, 
  TrendingDown,
  Car,
  Fuel,
  Shield,
  Calendar,
  MapPin
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface MaintenanceAlert {
  id?: string;
  vehicleId: string;
  alertType: 'due_soon' | 'overdue' | 'critical' | 'predictive';
  maintenanceType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  currentMileage: number;
  dueMileage?: number;
  mileageOverdue: number;
  dueDate?: string;
  daysOverdue: number;
  riskScore: number;
  estimatedCost: number;
  predictiveFactors: {
    mileageScore: number;
    timeScore: number;
    usageScore: number;
    performanceScore: number;
    healthScore: number;
    riskFactors: string[];
  };
  priority: number;
  status?: 'active' | 'acknowledged' | 'resolved';
}

interface Vehicle {
  id: string;
  vehicleNumber: string;
  driverId?: string;
  make: string;
  model: string;
  year: number;
  currentMileage: number;
  healthScore: number;
  status: string;
  equipmentType: string;
  fuelEfficiency: number;
  nextOilChangeDue: number;
  nextTireRotationDue: number;
  nextBrakeInspectionDue: number;
  nextServiceDue: number;
  insuranceExpiry?: string;
  registrationExpiry?: string;
  inspectionExpiry?: string;
}

interface VehicleMetrics {
  id: string;
  vehicleId: string;
  recordDate: string;
  mileage: number;
  fuelEfficiency: number;
  overallHealthScore: number;
  engineHealthScore: number;
  brakeHealthScore: number;
  transmissionHealthScore: number;
}

function getSeverityColor(severity: string) {
  switch (severity) {
    case 'critical': return 'bg-red-500';
    case 'high': return 'bg-orange-500';
    case 'medium': return 'bg-yellow-500';
    case 'low': return 'bg-blue-500';
    default: return 'bg-gray-500';
  }
}

function getSeverityIcon(severity: string) {
  switch (severity) {
    case 'critical': return <XCircle className="w-4 h-4" />;
    case 'high': return <AlertTriangle className="w-4 h-4" />;
    case 'medium': return <Clock className="w-4 h-4" />;
    case 'low': return <CheckCircle className="w-4 h-4" />;
    default: return <Wrench className="w-4 h-4" />;
  }
}

function getMaintenanceTypeIcon(type: string) {
  switch (type) {
    case 'oil_change': return <Fuel className="w-4 h-4" />;
    case 'tire_rotation': return <Car className="w-4 h-4" />;
    case 'brake_inspection': return <Shield className="w-4 h-4" />;
    case 'insurance_renewal': return <Shield className="w-4 h-4" />;
    case 'registration_renewal': return <Calendar className="w-4 h-4" />;
    case 'safety_inspection': return <CheckCircle className="w-4 h-4" />;
    default: return <Wrench className="w-4 h-4" />;
  }
}

export default function PredictiveMaintenance() {
  const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: alerts = [], isLoading: alertsLoading } = useQuery<MaintenanceAlert[]>({
    queryKey: ['/api/maintenance/alerts'],
  });

  const { data: vehicles = [], isLoading: vehiclesLoading } = useQuery<Vehicle[]>({
    queryKey: ['/api/maintenance/vehicles'],
  });

  const { data: metrics = [] } = useQuery<VehicleMetrics[]>({
    queryKey: ['/api/maintenance/metrics', selectedVehicle],
    enabled: !!selectedVehicle,
  });

  const acknowledgeMutation = useMutation({
    mutationFn: (alertId: string) => 
      apiRequest(`/api/maintenance/alerts/${alertId}/acknowledge`, {
        method: 'POST',
        body: { acknowledgedBy: 'dispatcher' }
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/maintenance/alerts'] });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: ({ alertId, notes }: { alertId: string; notes?: string }) => 
      apiRequest(`/api/maintenance/alerts/${alertId}/resolve`, {
        method: 'POST',
        body: { resolvedBy: 'dispatcher', notes }
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/maintenance/alerts'] });
    },
  });

  const criticalAlerts = alerts.filter(alert => alert.severity === 'critical');
  const highAlerts = alerts.filter(alert => alert.severity === 'high');
  const mediumAlerts = alerts.filter(alert => alert.severity === 'medium');
  const lowAlerts = alerts.filter(alert => alert.severity === 'low');

  const getVehicleByAlert = (alert: MaintenanceAlert) => {
    return vehicles.find(v => v.id === alert.vehicleId);
  };

  if (alertsLoading || vehiclesLoading) {
    return (
      <div className="flex-1 p-8">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-8" data-testid="predictive-maintenance-page">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Predictive Maintenance</h1>
          <p className="text-gray-600">Monitor vehicle health and predict maintenance needs</p>
        </div>

        {/* Alert Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Critical Alerts</CardTitle>
              <XCircle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{criticalAlerts.length}</div>
              <p className="text-xs text-gray-500">Immediate attention required</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">High Priority</CardTitle>
              <AlertTriangle className="h-4 w-4 text-orange-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">{highAlerts.length}</div>
              <p className="text-xs text-gray-500">Schedule soon</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Medium Priority</CardTitle>
              <Clock className="h-4 w-4 text-yellow-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600">{mediumAlerts.length}</div>
              <p className="text-xs text-gray-500">Plan ahead</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Fleet Health</CardTitle>
              <TrendingUp className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {vehicles.length > 0 ? Math.round(vehicles.reduce((sum, v) => sum + v.healthScore, 0) / vehicles.length) : 0}%
              </div>
              <p className="text-xs text-gray-500">Average health score</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="alerts" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="alerts">Maintenance Alerts</TabsTrigger>
            <TabsTrigger value="vehicles">Fleet Overview</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
          </TabsList>

          <TabsContent value="alerts" className="space-y-4">
            <div className="space-y-4">
              {alerts.length === 0 ? (
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-center text-gray-500">
                      <CheckCircle className="mx-auto h-8 w-8 mb-2" />
                      <p>No maintenance alerts at this time</p>
                      <p className="text-sm">Your fleet is in good condition!</p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                alerts.map((alert) => {
                  const vehicle = getVehicleByAlert(alert);
                  return (
                    <Card key={`${alert.vehicleId}-${alert.maintenanceType}`} className="border-l-4" style={{borderLeftColor: getSeverityColor(alert.severity).replace('bg-', '#')}}>
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center space-x-2">
                              {getSeverityIcon(alert.severity)}
                              <CardTitle className="text-lg">{alert.title}</CardTitle>
                              <Badge variant="secondary" className={`${getSeverityColor(alert.severity)} text-white`}>
                                {alert.severity.toUpperCase()}
                              </Badge>
                            </div>
                            <CardDescription className="text-sm text-gray-600">
                              {vehicle?.make} {vehicle?.model} ({vehicle?.year}) - {alert.description}
                            </CardDescription>
                          </div>
                          <div className="flex items-center space-x-2">
                            {getMaintenanceTypeIcon(alert.maintenanceType)}
                            <div className="text-right">
                              <div className="text-sm font-medium">Risk Score</div>
                              <div className="text-lg font-bold text-red-600">{Math.round(alert.riskScore)}%</div>
                            </div>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                          <div>
                            <div className="text-sm font-medium text-gray-500">Current Mileage</div>
                            <div className="text-lg font-semibold">{alert.currentMileage.toLocaleString()}</div>
                          </div>
                          {alert.dueMileage && (
                            <div>
                              <div className="text-sm font-medium text-gray-500">Due at Mileage</div>
                              <div className="text-lg font-semibold">{alert.dueMileage.toLocaleString()}</div>
                            </div>
                          )}
                          <div>
                            <div className="text-sm font-medium text-gray-500">Estimated Cost</div>
                            <div className="text-lg font-semibold text-green-600">${alert.estimatedCost.toLocaleString()}</div>
                          </div>
                        </div>

                        {alert.mileageOverdue > 0 && (
                          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                            <div className="flex items-center">
                              <AlertTriangle className="h-4 w-4 text-red-500 mr-2" />
                              <span className="text-red-700 font-medium">
                                {alert.mileageOverdue.toLocaleString()} miles overdue
                              </span>
                            </div>
                          </div>
                        )}

                        <div className="mb-4">
                          <div className="text-sm font-medium text-gray-500 mb-2">Health Factors</div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="flex justify-between">
                              <span className="text-sm">Performance:</span>
                              <span className="text-sm font-medium">{Math.round(alert.predictiveFactors.performanceScore)}%</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm">Health Score:</span>
                              <span className="text-sm font-medium">{Math.round(alert.predictiveFactors.healthScore)}%</span>
                            </div>
                          </div>
                        </div>

                        {alert.predictiveFactors.riskFactors.length > 0 && (
                          <div className="mb-4">
                            <div className="text-sm font-medium text-gray-500 mb-2">Risk Factors</div>
                            <div className="flex flex-wrap gap-1">
                              {alert.predictiveFactors.riskFactors.map((factor, index) => (
                                <Badge key={index} variant="outline" className="text-xs">
                                  {factor}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="flex space-x-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => acknowledgeMutation.mutate(`${alert.vehicleId}-${alert.maintenanceType}`)}
                            disabled={acknowledgeMutation.isPending}
                            data-testid={`acknowledge-alert-${alert.vehicleId}-${alert.maintenanceType}`}
                          >
                            <CheckCircle className="w-4 h-4 mr-2" />
                            Acknowledge
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => resolveMutation.mutate({ 
                              alertId: `${alert.vehicleId}-${alert.maintenanceType}`,
                              notes: 'Resolved via dashboard' 
                            })}
                            disabled={resolveMutation.isPending}
                            data-testid={`resolve-alert-${alert.vehicleId}-${alert.maintenanceType}`}
                          >
                            <Wrench className="w-4 h-4 mr-2" />
                            Mark Resolved
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>
          </TabsContent>

          <TabsContent value="vehicles" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {vehicles.map((vehicle) => {
                const vehicleAlerts = alerts.filter(a => a.vehicleId === vehicle.id);
                const criticalCount = vehicleAlerts.filter(a => a.severity === 'critical').length;
                const highCount = vehicleAlerts.filter(a => a.severity === 'high').length;
                
                return (
                  <Card key={vehicle.id} className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => setSelectedVehicle(vehicle.id)}>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-lg">{vehicle.vehicleNumber}</CardTitle>
                          <CardDescription>
                            {vehicle.make} {vehicle.model} ({vehicle.year})
                          </CardDescription>
                        </div>
                        <Badge variant={vehicle.status === 'active' ? 'default' : 'secondary'}>
                          {vehicle.status}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div className="flex justify-between text-sm">
                          <span>Current Mileage:</span>
                          <span className="font-medium">{vehicle.currentMileage.toLocaleString()}</span>
                        </div>
                        
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span>Health Score:</span>
                            <span className="font-medium">{Math.round(vehicle.healthScore)}%</span>
                          </div>
                          <Progress value={vehicle.healthScore} className="h-2" />
                        </div>

                        <div className="flex justify-between text-sm">
                          <span>Fuel Efficiency:</span>
                          <span className="font-medium">{vehicle.fuelEfficiency} MPG</span>
                        </div>

                        <div className="flex justify-between text-sm">
                          <span>Equipment Type:</span>
                          <span className="font-medium capitalize">{vehicle.equipmentType.replace('_', ' ')}</span>
                        </div>

                        {vehicleAlerts.length > 0 && (
                          <div className="flex items-center justify-between pt-2 border-t">
                            <span className="text-sm text-gray-500">Alerts:</span>
                            <div className="flex space-x-1">
                              {criticalCount > 0 && (
                                <Badge variant="destructive" className="text-xs">
                                  {criticalCount} Critical
                                </Badge>
                              )}
                              {highCount > 0 && (
                                <Badge className="bg-orange-500 text-xs">
                                  {highCount} High
                                </Badge>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent value="analytics" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Fleet Health Trends</CardTitle>
                  <CardDescription>Average health scores over time</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-center text-gray-500 py-8">
                    <TrendingUp className="mx-auto h-8 w-8 mb-2" />
                    <p>Health trend analytics</p>
                    <p className="text-sm">Coming soon...</p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Maintenance Cost Analysis</CardTitle>
                  <CardDescription>Projected vs actual maintenance costs</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-sm">Projected Monthly Cost:</span>
                      <span className="font-medium text-lg">${alerts.reduce((sum, a) => sum + a.estimatedCost, 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm">Critical Repairs:</span>
                      <span className="font-medium text-red-600">
                        ${criticalAlerts.reduce((sum, a) => sum + a.estimatedCost, 0).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm">Preventive Maintenance:</span>
                      <span className="font-medium text-green-600">
                        ${mediumAlerts.concat(lowAlerts).reduce((sum, a) => sum + a.estimatedCost, 0).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}