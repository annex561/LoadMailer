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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Wrench, Plus, Clock, CheckCircle, AlertTriangle, Truck, User, Calendar } from "lucide-react";

const STATUS_OPTIONS = ['OPEN', 'TRIAGED', 'ASSIGNED_VENDOR', 'IN_PROGRESS', 'WAITING_PARTS', 'COMPLETED', 'CLOSED', 'CANCELED'] as const;
const PRIORITY_OPTIONS = ['ROUTINE', 'URGENT', 'CRITICAL'] as const;
const CATEGORY_OPTIONS = ['ENGINE', 'BRAKES', 'TIRES', 'ELECTRICAL', 'SUSPENSION', 'DRIVELINE', 'LIFTGATE', 'SAFETY', 'OTHER'] as const;

export default function FleetWorkOrders() {
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<any>(null);
  const [activeTab, setActiveTab] = useState("all");

  const { data: workOrders = [], isLoading } = useQuery({
    queryKey: ['/api/fleet/work-orders'],
  });

  const { data: trucks = [] } = useQuery({
    queryKey: ['/api/fleet/trucks'],
  });

  const { data: vendors = [] } = useQuery({
    queryKey: ['/api/fleet/vendors'],
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest('/api/fleet/work-orders', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/fleet/work-orders'] });
      setIsAddDialogOpen(false);
      toast({ title: "Work order created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create work order", variant: "destructive" });
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiRequest(`/api/fleet/work-orders/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/fleet/work-orders'] });
      toast({ title: "Work order updated" });
    },
    onError: () => {
      toast({ title: "Failed to update work order", variant: "destructive" });
    }
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      truckId: formData.get('truckId'),
      priority: formData.get('priority'),
      issueCategory: formData.get('issueCategory'),
      symptoms: formData.get('symptoms'),
      vendorId: formData.get('vendorId') || undefined,
      source: 'MANUAL',
      status: 'OPEN',
      companyId: 'default-company',
    };
    createMutation.mutate(data);
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      OPEN: 'bg-blue-500',
      TRIAGED: 'bg-purple-500',
      ASSIGNED_VENDOR: 'bg-indigo-500',
      IN_PROGRESS: 'bg-yellow-500',
      WAITING_PARTS: 'bg-orange-500',
      COMPLETED: 'bg-green-500',
      CLOSED: 'bg-gray-500',
      CANCELED: 'bg-red-500',
    };
    return <Badge className={colors[status] || 'bg-gray-500'}>{status.replace(/_/g, ' ')}</Badge>;
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'CRITICAL':
        return <Badge variant="destructive">Critical</Badge>;
      case 'URGENT':
        return <Badge className="bg-orange-500">Urgent</Badge>;
      default:
        return <Badge variant="secondary">Routine</Badge>;
    }
  };

  const filteredWorkOrders = workOrders.filter((wo: any) => {
    if (activeTab === 'all') return true;
    if (activeTab === 'open') return ['OPEN', 'TRIAGED', 'ASSIGNED_VENDOR', 'IN_PROGRESS', 'WAITING_PARTS'].includes(wo.status);
    if (activeTab === 'completed') return ['COMPLETED', 'CLOSED'].includes(wo.status);
    return wo.status === activeTab;
  });

  const WorkOrderCard = ({ workOrder }: { workOrder: any }) => {
    const truck = trucks.find((t: any) => t.id === workOrder.truckId);
    const vendor = vendors.find((v: any) => v.id === workOrder.vendorId);

    return (
      <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => setSelectedWorkOrder(workOrder)}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              {getPriorityBadge(workOrder.priority)}
              {getStatusBadge(workOrder.status)}
            </div>
            {workOrder.safetyHold && (
              <Badge variant="destructive" className="flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Safety Hold
              </Badge>
            )}
          </div>
          
          <h3 className="font-semibold mt-2">{workOrder.issueCategory?.replace(/_/g, ' ')}</h3>
          <p className="text-sm text-muted-foreground line-clamp-2">{workOrder.symptoms || 'No description'}</p>
          
          <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Truck className="w-3 h-3" />
              {truck?.unitNumber || 'Unknown'}
            </span>
            {vendor && (
              <span className="flex items-center gap-1">
                <User className="w-3 h-3" />
                {vendor.name}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {new Date(workOrder.createdAt).toLocaleDateString()}
            </span>
          </div>
        </CardContent>
      </Card>
    );
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-40 bg-gray-200 rounded"></div>
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
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Work Orders</h1>
          <p className="text-gray-600 dark:text-gray-400">Track and manage maintenance work orders</p>
        </div>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Create Work Order
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Create Work Order</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="truckId">Truck *</Label>
                <Select name="truckId" required>
                  <SelectTrigger>
                    <SelectValue placeholder="Select truck" />
                  </SelectTrigger>
                  <SelectContent>
                    {trucks.map((truck: any) => (
                      <SelectItem key={truck.id} value={truck.id}>
                        {truck.unitNumber} - {truck.year} {truck.make} {truck.model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="priority">Priority</Label>
                  <Select name="priority" defaultValue="ROUTINE">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITY_OPTIONS.map(p => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="issueCategory">Category</Label>
                  <Select name="issueCategory" defaultValue="OTHER">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORY_OPTIONS.map(c => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="symptoms">Description</Label>
                <Textarea name="symptoms" placeholder="Describe the issue..." rows={3} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vendorId">Assign Vendor (optional)</Label>
                <Select name="vendorId">
                  <SelectTrigger>
                    <SelectValue placeholder="Select vendor" />
                  </SelectTrigger>
                  <SelectContent>
                    {vendors.map((vendor: any) => (
                      <SelectItem key={vendor.id} value={vendor.id}>
                        {vendor.name} ({vendor.category})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createMutation.isPending}>
                  Create Work Order
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all">All ({workOrders.length})</TabsTrigger>
          <TabsTrigger value="open">
            Open ({workOrders.filter((wo: any) => ['OPEN', 'TRIAGED', 'ASSIGNED_VENDOR', 'IN_PROGRESS', 'WAITING_PARTS'].includes(wo.status)).length})
          </TabsTrigger>
          <TabsTrigger value="completed">
            Completed ({workOrders.filter((wo: any) => ['COMPLETED', 'CLOSED'].includes(wo.status)).length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredWorkOrders.length === 0 ? (
              <Card className="col-span-full">
                <CardContent className="text-center py-8 text-muted-foreground">
                  No work orders found
                </CardContent>
              </Card>
            ) : (
              filteredWorkOrders.map((wo: any) => (
                <WorkOrderCard key={wo.id} workOrder={wo} />
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={!!selectedWorkOrder} onOpenChange={(open) => !open && setSelectedWorkOrder(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Work Order Details</DialogTitle>
          </DialogHeader>
          {selectedWorkOrder && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                {getPriorityBadge(selectedWorkOrder.priority)}
                {getStatusBadge(selectedWorkOrder.status)}
                {selectedWorkOrder.safetyHold && (
                  <Badge variant="destructive">Safety Hold</Badge>
                )}
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Truck</Label>
                  <p className="font-medium">
                    {trucks.find((t: any) => t.id === selectedWorkOrder.truckId)?.unitNumber || 'Unknown'}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Category</Label>
                  <p className="font-medium">{selectedWorkOrder.issueCategory?.replace(/_/g, ' ')}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Created</Label>
                  <p className="font-medium">{new Date(selectedWorkOrder.createdAt).toLocaleString()}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Vendor</Label>
                  <p className="font-medium">
                    {vendors.find((v: any) => v.id === selectedWorkOrder.vendorId)?.name || 'Not assigned'}
                  </p>
                </div>
              </div>

              <div>
                <Label className="text-muted-foreground">Description</Label>
                <p className="mt-1">{selectedWorkOrder.symptoms || 'No description provided'}</p>
              </div>

              {selectedWorkOrder.estimatedCost && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground">Estimated Cost</Label>
                    <p className="font-medium">${selectedWorkOrder.estimatedCost?.toLocaleString()}</p>
                  </div>
                  {selectedWorkOrder.actualCost && (
                    <div>
                      <Label className="text-muted-foreground">Actual Cost</Label>
                      <p className="font-medium">${selectedWorkOrder.actualCost?.toLocaleString()}</p>
                    </div>
                  )}
                </div>
              )}

              <div className="border-t pt-4">
                <Label className="text-muted-foreground">Update Status</Label>
                <div className="flex gap-2 mt-2 flex-wrap">
                  {STATUS_OPTIONS.filter(s => s !== selectedWorkOrder.status).map(status => (
                    <Button
                      key={status}
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        updateMutation.mutate({ id: selectedWorkOrder.id, data: { status } });
                        setSelectedWorkOrder({ ...selectedWorkOrder, status });
                      }}
                    >
                      {status.replace(/_/g, ' ')}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
