import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { ClipboardCheck, Plus, Truck, User, Calendar, AlertTriangle, CheckCircle } from "lucide-react";

const INSPECTION_TYPES = ['PRE_TRIP', 'POST_TRIP', 'WEEKLY', 'MONTHLY_FLEET', 'QUARTERLY_PM_REVIEW', 'ANNUAL_DOT_READY'] as const;

const INSPECTION_CHECKLIST = [
  { code: 'BRAKES', label: 'Brakes & Air System', isSafety: true },
  { code: 'LIGHTS', label: 'Lights & Reflectors', isSafety: true },
  { code: 'TIRES', label: 'Tires & Wheels', isSafety: true },
  { code: 'STEERING', label: 'Steering & Suspension', isSafety: true },
  { code: 'MIRRORS', label: 'Mirrors & Windshield', isSafety: false },
  { code: 'HORN', label: 'Horn & Warning Devices', isSafety: false },
  { code: 'WIPERS', label: 'Windshield Wipers', isSafety: false },
  { code: 'FLUID_LEVELS', label: 'Fluid Levels (Oil, Coolant)', isSafety: false },
  { code: 'EXHAUST', label: 'Exhaust System', isSafety: false },
  { code: 'LIFTGATE', label: 'Liftgate Operation', isSafety: false },
  { code: 'BODY', label: 'Body & Doors', isSafety: false },
  { code: 'COUPLING', label: 'Coupling Devices', isSafety: true },
  { code: 'FIRE_EXTINGUISHER', label: 'Fire Extinguisher', isSafety: true },
  { code: 'EMERGENCY_KIT', label: 'Emergency Equipment', isSafety: true },
];

export default function FleetInspections() {
  const { toast } = useToast();
  const [isNewInspectionOpen, setIsNewInspectionOpen] = useState(false);
  const [selectedTruck, setSelectedTruck] = useState<string>("");
  const [inspectionType, setInspectionType] = useState<string>("PRE_TRIP");
  const [checklistItems, setChecklistItems] = useState<Record<string, { status: string; notes: string }>>({});
  const [summaryNotes, setSummaryNotes] = useState("");

  const { data: inspections = [], isLoading } = useQuery({
    queryKey: ['/api/fleet/inspections'],
  });

  const { data: trucks = [] } = useQuery({
    queryKey: ['/api/fleet/trucks'],
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest('/api/fleet/inspections', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/fleet/inspections'] });
      queryClient.invalidateQueries({ queryKey: ['/api/fleet/work-orders'] });
      setIsNewInspectionOpen(false);
      resetForm();
      toast({ title: "Inspection submitted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to submit inspection", variant: "destructive" });
    }
  });

  const resetForm = () => {
    setSelectedTruck("");
    setInspectionType("PRE_TRIP");
    setChecklistItems({});
    setSummaryNotes("");
  };

  const handleItemChange = (code: string, status: string) => {
    setChecklistItems(prev => ({
      ...prev,
      [code]: { ...prev[code], status }
    }));
  };

  const handleItemNotes = (code: string, notes: string) => {
    setChecklistItems(prev => ({
      ...prev,
      [code]: { ...prev[code], notes }
    }));
  };

  const handleSubmitInspection = () => {
    const items = INSPECTION_CHECKLIST.map(item => ({
      itemCode: item.code,
      itemLabel: item.label,
      status: checklistItems[item.code]?.status || 'OK',
      severity: checklistItems[item.code]?.status === 'NEEDS_ATTENTION' ? (item.isSafety ? 'CRITICAL' : 'ROUTINE') : undefined,
      defectNotes: checklistItems[item.code]?.notes || undefined,
    }));

    const hasDefects = items.some(i => i.status === 'NEEDS_ATTENTION');
    const hasSafetyDefects = items.some(i => 
      i.status === 'NEEDS_ATTENTION' && 
      INSPECTION_CHECKLIST.find(c => c.code === i.itemCode)?.isSafety
    );

    createMutation.mutate({
      companyId: 'default-company',
      truckId: selectedTruck,
      inspectionType,
      isSafeToOperate: !hasSafetyDefects,
      summaryNotes,
      items,
    });
  };

  const getInspectionBadge = (type: string) => {
    const colors: Record<string, string> = {
      PRE_TRIP: 'bg-blue-500',
      POST_TRIP: 'bg-indigo-500',
      WEEKLY: 'bg-purple-500',
      MONTHLY_FLEET: 'bg-pink-500',
      QUARTERLY_PM_REVIEW: 'bg-orange-500',
      ANNUAL_DOT_READY: 'bg-red-500',
    };
    return <Badge className={colors[type] || 'bg-gray-500'}>{type.replace(/_/g, ' ')}</Badge>;
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Fleet Inspections</h1>
          <p className="text-gray-600 dark:text-gray-400">Conduct and review vehicle inspections</p>
        </div>
        <Dialog open={isNewInspectionOpen} onOpenChange={(open) => { setIsNewInspectionOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              New Inspection
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>New Vehicle Inspection</DialogTitle>
            </DialogHeader>
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Truck *</Label>
                  <Select value={selectedTruck} onValueChange={setSelectedTruck}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select truck" />
                    </SelectTrigger>
                    <SelectContent>
                      {trucks.filter((t: any) => t.status === 'ACTIVE').map((truck: any) => (
                        <SelectItem key={truck.id} value={truck.id}>
                          {truck.unitNumber} - {truck.year} {truck.make}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Inspection Type</Label>
                  <Select value={inspectionType} onValueChange={setInspectionType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INSPECTION_TYPES.map(type => (
                        <SelectItem key={type} value={type}>{type.replace(/_/g, ' ')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="font-semibold">Inspection Checklist</h3>
                {INSPECTION_CHECKLIST.map(item => (
                  <Card key={item.code} className={checklistItems[item.code]?.status === 'NEEDS_ATTENTION' ? 'border-red-500' : ''}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          {item.isSafety && (
                            <AlertTriangle className="w-4 h-4 text-yellow-500" />
                          )}
                          <div>
                            <p className="font-medium">{item.label}</p>
                            {item.isSafety && (
                              <p className="text-xs text-muted-foreground">Safety Critical</p>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant={checklistItems[item.code]?.status === 'OK' || !checklistItems[item.code]?.status ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => handleItemChange(item.code, 'OK')}
                          >
                            <CheckCircle className="w-4 h-4 mr-1" />
                            OK
                          </Button>
                          <Button
                            variant={checklistItems[item.code]?.status === 'NEEDS_ATTENTION' ? 'destructive' : 'outline'}
                            size="sm"
                            onClick={() => handleItemChange(item.code, 'NEEDS_ATTENTION')}
                          >
                            <AlertTriangle className="w-4 h-4 mr-1" />
                            Defect
                          </Button>
                        </div>
                      </div>
                      {checklistItems[item.code]?.status === 'NEEDS_ATTENTION' && (
                        <div className="mt-3">
                          <Textarea
                            placeholder="Describe the defect..."
                            value={checklistItems[item.code]?.notes || ''}
                            onChange={(e) => handleItemNotes(item.code, e.target.value)}
                          />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="space-y-2">
                <Label>Additional Notes</Label>
                <Textarea
                  placeholder="Any additional observations..."
                  value={summaryNotes}
                  onChange={(e) => setSummaryNotes(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsNewInspectionOpen(false)}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleSubmitInspection} 
                  disabled={!selectedTruck || createMutation.isPending}
                >
                  Submit Inspection
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-4">
        {inspections.length === 0 ? (
          <Card>
            <CardContent className="text-center py-8 text-muted-foreground">
              No inspections recorded yet. Start a new inspection to track your fleet's condition.
            </CardContent>
          </Card>
        ) : (
          inspections.map((inspection: any) => {
            const truck = trucks.find((t: any) => t.id === inspection.truckId);
            return (
              <Card key={inspection.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      {getInspectionBadge(inspection.inspectionType)}
                      <div>
                        <div className="flex items-center gap-2">
                          <Truck className="w-4 h-4 text-muted-foreground" />
                          <span className="font-medium">{truck?.unitNumber || 'Unknown'}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Calendar className="w-3 h-3" />
                          {new Date(inspection.createdAt).toLocaleString()}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {inspection.isSafeToOperate ? (
                        <Badge className="bg-green-500">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Safe to Operate
                        </Badge>
                      ) : (
                        <Badge variant="destructive">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          Defects Found
                        </Badge>
                      )}
                    </div>
                  </div>
                  {inspection.summaryNotes && (
                    <p className="mt-2 text-sm text-muted-foreground">{inspection.summaryNotes}</p>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
