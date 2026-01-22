import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Truck, Plus, Search, Filter, MoreHorizontal, Edit, Trash2, Eye } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const BODY_TYPES = ['BOX_26FT', 'SPRINTER', 'STRAIGHT_TRUCK', 'OTHER'] as const;
const STATUS_OPTIONS = ['ACTIVE', 'IN_SHOP', 'OUT_OF_SERVICE', 'SOLD'] as const;

export default function FleetTrucks() {
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingTruck, setEditingTruck] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

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
          <p className="text-gray-600 dark:text-gray-400">Manage your truck inventory</p>
        </div>
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
                <TableHead>Body Type</TableHead>
                <TableHead>Odometer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Liftgate</TableHead>
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
                    <TableCell>{truck.bodyType?.replace(/_/g, ' ')}</TableCell>
                    <TableCell>{truck.currentOdometer?.toLocaleString() || 0} mi</TableCell>
                    <TableCell>{getStatusBadge(truck.status)}</TableCell>
                    <TableCell>{truck.hasLiftgate ? 'Yes' : 'No'}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditingTruck(truck)}>
                            <Edit className="w-4 h-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
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
    </div>
  );
}
