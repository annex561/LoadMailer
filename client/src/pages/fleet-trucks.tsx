import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Truck, Plus, Search, Filter, MoreHorizontal, Edit, Trash2, AlertTriangle, ShieldCheck, ShieldAlert, RefreshCw, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const BODY_TYPES = ['BOX_26FT', 'SPRINTER', 'STRAIGHT_TRUCK', 'OTHER'] as const;
const STATUS_OPTIONS = ['ACTIVE', 'IN_SHOP', 'OUT_OF_SERVICE', 'SOLD'] as const;

interface RiskScoreData {
  riskScore: number;
  inspectionRiskPoints: number;
  maintenanceRiskPoints: number;
  breakdownRiskPoints: number;
  complianceRiskPoints: number;
  ageRiskPoints: number;
  dispatchGateStatus: 'GREEN' | 'YELLOW' | 'RED';
  dispatchGateReason: string | null;
}

export default function FleetTrucks() {
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingTruck, setEditingTruck] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [riskDetailsTruck, setRiskDetailsTruck] = useState<any>(null);
  const [overrideTruck, setOverrideTruck] = useState<any>(null);
  const [overrideReason, setOverrideReason] = useState("");

  const { data: trucks = [], isLoading } = useQuery({
    queryKey: ['/api/fleet/trucks'],
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest('/api/fleet/trucks', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/fleet/trucks'] });
      setIsAddDialogOpen(false);
      toast({ title: "Truck added successfully" });
    },
    onError: () => {
      toast({ title: "Failed to add truck", variant: "destructive" });
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiRequest(`/api/fleet/trucks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/fleet/trucks'] });
      setEditingTruck(null);
      toast({ title: "Truck updated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to update truck", variant: "destructive" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/fleet/trucks/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/fleet/trucks'] });
      toast({ title: "Truck deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete truck", variant: "destructive" });
    }
  });

  const calculateRiskMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/fleet/trucks/${id}/calculate-risk`, { method: 'POST' }),
    onSuccess: (data, truckId) => {
      queryClient.invalidateQueries({ queryKey: ['/api/fleet/trucks'] });
      toast({ title: "Risk score recalculated" });
    },
    onError: () => {
      toast({ title: "Failed to calculate risk score", variant: "destructive" });
    }
  });

  const recalculateAllMutation = useMutation({
    mutationFn: () => apiRequest('/api/fleet/trucks/recalculate-all-risk-scores', { method: 'POST', body: JSON.stringify({ companyId: 'default-company' }) }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/fleet/trucks'] });
      toast({ title: `Risk scores recalculated for ${data.trucksProcessed} trucks` });
    },
    onError: () => {
      toast({ title: "Failed to recalculate risk scores", variant: "destructive" });
    }
  });

  const overrideMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => 
      apiRequest(`/api/fleet/trucks/${id}/dispatch-gate/override`, { method: 'POST', body: JSON.stringify({ reason }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/fleet/trucks'] });
      setOverrideTruck(null);
      setOverrideReason("");
      toast({ title: "Dispatch gate override approved" });
    },
    onError: () => {
      toast({ title: "Failed to override dispatch gate", variant: "destructive" });
    }
  });

  const clearOverrideMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/fleet/trucks/${id}/dispatch-gate/override`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/fleet/trucks'] });
      toast({ title: "Override cleared" });
    },
    onError: () => {
      toast({ title: "Failed to clear override", variant: "destructive" });
    }
  });

  const filteredTrucks = trucks.filter((truck: any) => {
    const matchesSearch = truck.unitNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      truck.make?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      truck.model?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || truck.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      unitNumber: formData.get('unitNumber'),
      vin: formData.get('vin') || undefined,
      year: parseInt(formData.get('year') as string),
      make: formData.get('make'),
      model: formData.get('model'),
      bodyType: formData.get('bodyType'),
      hasLiftgate: formData.get('hasLiftgate') === 'true',
      currentOdometer: parseInt(formData.get('currentOdometer') as string) || 0,
      status: formData.get('status') || 'ACTIVE',
      baseZip: formData.get('baseZip') || undefined,
      companyId: 'default-company',
    };

    if (editingTruck) {
      updateMutation.mutate({ id: editingTruck.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return <Badge className="bg-green-500">Active</Badge>;
      case 'IN_SHOP':
        return <Badge className="bg-yellow-500">In Shop</Badge>;
      case 'OUT_OF_SERVICE':
        return <Badge className="bg-red-500">Out of Service</Badge>;
      case 'SOLD':
        return <Badge variant="secondary">Sold</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getRiskScoreBadge = (score: number) => {
    if (score >= 60) {
      return <Badge className="bg-red-600 text-white">{score}</Badge>;
    } else if (score >= 40) {
      return <Badge className="bg-orange-500 text-white">{score}</Badge>;
    } else if (score >= 20) {
      return <Badge className="bg-yellow-500 text-black">{score}</Badge>;
    } else {
      return <Badge className="bg-green-500 text-white">{score}</Badge>;
    }
  };

  const getDispatchGateIcon = (status: string, hasOverride: boolean) => {
    if (hasOverride) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <div className="flex items-center gap-1">
                <CheckCircle className="w-5 h-5 text-blue-500" />
                <span className="text-xs text-blue-500">Override</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>Manager override active</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    
    switch (status) {
      case 'GREEN':
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <ShieldCheck className="w-5 h-5 text-green-500" />
              </TooltipTrigger>
              <TooltipContent>Ready to dispatch</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      case 'YELLOW':
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <AlertTriangle className="w-5 h-5 text-yellow-500" />
              </TooltipTrigger>
              <TooltipContent>Requires manager approval</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      case 'RED':
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <ShieldAlert className="w-5 h-5 text-red-500" />
              </TooltipTrigger>
              <TooltipContent>Cannot dispatch</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      default:
        return <AlertCircle className="w-5 h-5 text-gray-400" />;
    }
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Fleet Trucks</h1>
          <p className="text-gray-600 dark:text-gray-400">Manage your truck inventory with risk scoring</p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            onClick={() => recalculateAllMutation.mutate()}
            disabled={recalculateAllMutation.isPending}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${recalculateAllMutation.isPending ? 'animate-spin' : ''}`} />
            Recalculate All Risk Scores
          </Button>
          <Dialog open={isAddDialogOpen || !!editingTruck} onOpenChange={(open) => { setIsAddDialogOpen(open); if (!open) setEditingTruck(null); }}>
            <DialogTrigger asChild>
              <Button onClick={() => setIsAddDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Truck
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{editingTruck ? 'Edit Truck' : 'Add New Truck'}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="unitNumber">Unit Number *</Label>
                    <Input id="unitNumber" name="unitNumber" required defaultValue={editingTruck?.unitNumber} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="vin">VIN</Label>
                    <Input id="vin" name="vin" defaultValue={editingTruck?.vin} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="year">Year *</Label>
                    <Input id="year" name="year" type="number" required defaultValue={editingTruck?.year || new Date().getFullYear()} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="make">Make *</Label>
                    <Input id="make" name="make" required defaultValue={editingTruck?.make} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="model">Model *</Label>
                    <Input id="model" name="model" required defaultValue={editingTruck?.model} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="bodyType">Body Type</Label>
                    <Select name="bodyType" defaultValue={editingTruck?.bodyType || 'BOX_26FT'}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BODY_TYPES.map(type => (
                          <SelectItem key={type} value={type}>{type.replace(/_/g, ' ')}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="status">Status</Label>
                    <Select name="status" defaultValue={editingTruck?.status || 'ACTIVE'}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map(status => (
                          <SelectItem key={status} value={status}>{status.replace(/_/g, ' ')}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="currentOdometer">Current Odometer</Label>
                    <Input id="currentOdometer" name="currentOdometer" type="number" defaultValue={editingTruck?.currentOdometer || 0} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="hasLiftgate">Has Liftgate</Label>
                    <Select name="hasLiftgate" defaultValue={editingTruck?.hasLiftgate ? 'true' : 'false'}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">Yes</SelectItem>
                        <SelectItem value="false">No</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="baseZip">Base ZIP Code</Label>
                  <Input id="baseZip" name="baseZip" defaultValue={editingTruck?.baseZip} />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => { setIsAddDialogOpen(false); setEditingTruck(null); }}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                    {editingTruck ? 'Update' : 'Add'} Truck
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search trucks..."
            className="pl-10"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <Filter className="w-4 h-4 mr-2" />
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {STATUS_OPTIONS.map(status => (
              <SelectItem key={status} value={status}>{status.replace(/_/g, ' ')}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unit #</TableHead>
                <TableHead>Year/Make/Model</TableHead>
                <TableHead>Odometer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Risk Score</TableHead>
                <TableHead className="text-center">Dispatch Gate</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTrucks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    {trucks.length === 0 ? "No trucks in fleet. Add your first truck to get started." : "No trucks match your filters."}
                  </TableCell>
                </TableRow>
              ) : (
                filteredTrucks.map((truck: any) => (
                  <TableRow key={truck.id}>
                    <TableCell className="font-medium">{truck.unitNumber}</TableCell>
                    <TableCell>{truck.year} {truck.make} {truck.model}</TableCell>
                    <TableCell>{truck.currentOdometer?.toLocaleString() || 0} mi</TableCell>
                    <TableCell>{getStatusBadge(truck.status)}</TableCell>
                    <TableCell className="text-center">
                      <button 
                        onClick={() => setRiskDetailsTruck(truck)}
                        className="hover:opacity-80 cursor-pointer"
                      >
                        {getRiskScoreBadge(truck.riskScore || 0)}
                      </button>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-2">
                        {getDispatchGateIcon(truck.dispatchGateStatus, !!truck.dispatchGateOverrideBy)}
                        {truck.dispatchGateStatus === 'YELLOW' && !truck.dispatchGateOverrideBy && (
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="h-6 text-xs"
                            onClick={() => setOverrideTruck(truck)}
                          >
                            Override
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setRiskDetailsTruck(truck)}>
                            <AlertTriangle className="w-4 h-4 mr-2" />
                            View Risk Details
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => calculateRiskMutation.mutate(truck.id)}
                            disabled={calculateRiskMutation.isPending}
                          >
                            <RefreshCw className="w-4 h-4 mr-2" />
                            Recalculate Risk
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => setEditingTruck(truck)}>
                            <Edit className="w-4 h-4 mr-2" />
                            Edit Truck
                          </DropdownMenuItem>
                          {truck.dispatchGateOverrideBy && (
                            <DropdownMenuItem onClick={() => clearOverrideMutation.mutate(truck.id)}>
                              <XCircle className="w-4 h-4 mr-2" />
                              Clear Override
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-red-600"
                            onClick={() => {
                              if (confirm('Are you sure you want to delete this truck?')) {
                                deleteMutation.mutate(truck.id);
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Risk Details Dialog */}
      <Dialog open={!!riskDetailsTruck} onOpenChange={() => setRiskDetailsTruck(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Risk Score Details - {riskDetailsTruck?.unitNumber}</DialogTitle>
            <DialogDescription>
              {riskDetailsTruck?.year} {riskDetailsTruck?.make} {riskDetailsTruck?.model}
            </DialogDescription>
          </DialogHeader>
          {riskDetailsTruck && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Overall Risk Score</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-4xl font-bold">{riskDetailsTruck.riskScore || 0}</span>
                    <span className="text-lg text-muted-foreground">/ 100</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Dispatch Status</p>
                  <div className="flex items-center gap-2 mt-1 justify-end">
                    {getDispatchGateIcon(riskDetailsTruck.dispatchGateStatus, !!riskDetailsTruck.dispatchGateOverrideBy)}
                    <span className={`font-medium ${
                      riskDetailsTruck.dispatchGateStatus === 'GREEN' ? 'text-green-600' :
                      riskDetailsTruck.dispatchGateStatus === 'YELLOW' ? 'text-yellow-600' : 'text-red-600'
                    }`}>
                      {riskDetailsTruck.dispatchGateStatus || 'GREEN'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>Inspection Risk</span>
                    <span>{riskDetailsTruck.inspectionRiskPoints || 0} / 25</span>
                  </div>
                  <Progress value={(riskDetailsTruck.inspectionRiskPoints || 0) * 4} className="h-2" />
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>Maintenance Risk</span>
                    <span>{riskDetailsTruck.maintenanceRiskPoints || 0} / 25</span>
                  </div>
                  <Progress value={(riskDetailsTruck.maintenanceRiskPoints || 0) * 4} className="h-2" />
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>Breakdown Risk</span>
                    <span>{riskDetailsTruck.breakdownRiskPoints || 0} / 20</span>
                  </div>
                  <Progress value={(riskDetailsTruck.breakdownRiskPoints || 0) * 5} className="h-2" />
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>Compliance Risk</span>
                    <span>{riskDetailsTruck.complianceRiskPoints || 0} / 20</span>
                  </div>
                  <Progress value={(riskDetailsTruck.complianceRiskPoints || 0) * 5} className="h-2" />
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>Age Risk</span>
                    <span>{riskDetailsTruck.ageRiskPoints || 0} / 10</span>
                  </div>
                  <Progress value={(riskDetailsTruck.ageRiskPoints || 0) * 10} className="h-2" />
                </div>
              </div>

              {riskDetailsTruck.dispatchGateReason && (
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
                  <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">Reason:</p>
                  <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">{riskDetailsTruck.dispatchGateReason}</p>
                </div>
              )}

              {riskDetailsTruck.dispatchGateOverrideBy && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-200">Manager Override Active</p>
                  {riskDetailsTruck.dispatchGateOverrideReason && (
                    <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">{riskDetailsTruck.dispatchGateOverrideReason}</p>
                  )}
                  {riskDetailsTruck.dispatchGateOverrideAt && (
                    <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                      Approved: {new Date(riskDetailsTruck.dispatchGateOverrideAt).toLocaleString()}
                    </p>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button 
                  variant="outline" 
                  onClick={() => {
                    calculateRiskMutation.mutate(riskDetailsTruck.id);
                    setRiskDetailsTruck(null);
                  }}
                  disabled={calculateRiskMutation.isPending}
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Recalculate
                </Button>
                <Button onClick={() => setRiskDetailsTruck(null)}>Close</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Override Dialog */}
      <Dialog open={!!overrideTruck} onOpenChange={() => { setOverrideTruck(null); setOverrideReason(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Override Dispatch Gate - {overrideTruck?.unitNumber}</DialogTitle>
            <DialogDescription>
              This truck has an elevated risk score and requires manager approval to dispatch.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
              <p className="text-sm text-yellow-700 dark:text-yellow-300">
                <strong>Reason:</strong> {overrideTruck?.dispatchGateReason || "Elevated risk level"}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="overrideReason">Override Reason (min 10 characters) *</Label>
              <Textarea 
                id="overrideReason"
                placeholder="Enter justification for overriding the dispatch gate..."
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOverrideTruck(null); setOverrideReason(""); }}>
              Cancel
            </Button>
            <Button 
              onClick={() => overrideMutation.mutate({ id: overrideTruck.id, reason: overrideReason })}
              disabled={overrideReason.length < 10 || overrideMutation.isPending}
            >
              Approve Override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
