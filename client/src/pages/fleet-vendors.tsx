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
import { useToast } from "@/hooks/use-toast";
import { Users, Plus, Phone, Mail, MapPin, Star, Search, Edit, Trash2, MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const VENDOR_CATEGORIES = ['TOWING', 'MOBILE_MECHANIC', 'TIRE', 'DEALER_SERVICE', 'LIFTGATE', 'BODY_SHOP', 'GENERAL_REPAIR', 'ROADSIDE'] as const;

export default function FleetVendors() {
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const { data: vendors = [], isLoading } = useQuery({
    queryKey: ['/api/fleet/vendors'],
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest('/api/fleet/vendors', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/fleet/vendors'] });
      setIsAddDialogOpen(false);
      toast({ title: "Vendor added successfully" });
    },
    onError: () => {
      toast({ title: "Failed to add vendor", variant: "destructive" });
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiRequest(`/api/fleet/vendors/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/fleet/vendors'] });
      setEditingVendor(null);
      toast({ title: "Vendor updated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to update vendor", variant: "destructive" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/fleet/vendors/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/fleet/vendors'] });
      toast({ title: "Vendor deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete vendor", variant: "destructive" });
    }
  });

  const filteredVendors = vendors.filter((vendor: any) => {
    const matchesSearch = vendor.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      vendor.city?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = categoryFilter === "all" || vendor.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get('name'),
      category: formData.get('category'),
      phone24_7: formData.get('phone24_7') || undefined,
      phoneDay: formData.get('phoneDay') || undefined,
      email: formData.get('email') || undefined,
      address: formData.get('address') || undefined,
      city: formData.get('city') || undefined,
      state: formData.get('state') || undefined,
      zip: formData.get('zip') || undefined,
      serviceRadiusMiles: parseInt(formData.get('serviceRadiusMiles') as string) || undefined,
      paymentTerms: formData.get('paymentTerms') || undefined,
      notes: formData.get('notes') || undefined,
      isPreferred: formData.get('isPreferred') === 'true',
      companyId: 'default-company',
    };

    if (editingVendor) {
      updateMutation.mutate({ id: editingVendor.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const getCategoryBadge = (category: string) => {
    const colors: Record<string, string> = {
      TOWING: 'bg-red-500',
      MOBILE_MECHANIC: 'bg-blue-500',
      TIRE: 'bg-gray-700',
      DEALER_SERVICE: 'bg-purple-500',
      LIFTGATE: 'bg-orange-500',
      BODY_SHOP: 'bg-pink-500',
      GENERAL_REPAIR: 'bg-green-500',
      ROADSIDE: 'bg-yellow-500',
    };
    return <Badge className={colors[category] || 'bg-gray-500'}>{category.replace(/_/g, ' ')}</Badge>;
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-48 bg-gray-200 rounded"></div>
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
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Vendor Directory</h1>
          <p className="text-gray-600 dark:text-gray-400">Manage your service providers and vendors</p>
        </div>
        <Dialog open={isAddDialogOpen || !!editingVendor} onOpenChange={(open) => { setIsAddDialogOpen(open); if (!open) setEditingVendor(null); }}>
          <DialogTrigger asChild>
            <Button onClick={() => setIsAddDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Vendor
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingVendor ? 'Edit Vendor' : 'Add New Vendor'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2 col-span-2">
                  <Label htmlFor="name">Company Name *</Label>
                  <Input id="name" name="name" required defaultValue={editingVendor?.name} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="category">Category *</Label>
                  <Select name="category" defaultValue={editingVendor?.category || 'GENERAL_REPAIR'}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VENDOR_CATEGORIES.map(cat => (
                        <SelectItem key={cat} value={cat}>{cat.replace(/_/g, ' ')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="isPreferred">Preferred Vendor</Label>
                  <Select name="isPreferred" defaultValue={editingVendor?.isPreferred ? 'true' : 'false'}>
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
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="phone24_7">24/7 Phone</Label>
                  <Input id="phone24_7" name="phone24_7" type="tel" defaultValue={editingVendor?.phone24_7} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phoneDay">Daytime Phone</Label>
                  <Input id="phoneDay" name="phoneDay" type="tel" defaultValue={editingVendor?.phoneDay} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" defaultValue={editingVendor?.email} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address">Address</Label>
                <Input id="address" name="address" defaultValue={editingVendor?.address} />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="city">City</Label>
                  <Input id="city" name="city" defaultValue={editingVendor?.city} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="state">State</Label>
                  <Input id="state" name="state" maxLength={2} defaultValue={editingVendor?.state} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="zip">ZIP</Label>
                  <Input id="zip" name="zip" defaultValue={editingVendor?.zip} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="serviceRadiusMiles">Service Radius (miles)</Label>
                  <Input id="serviceRadiusMiles" name="serviceRadiusMiles" type="number" defaultValue={editingVendor?.serviceRadiusMiles} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="paymentTerms">Payment Terms</Label>
                  <Input id="paymentTerms" name="paymentTerms" placeholder="e.g., Net 30" defaultValue={editingVendor?.paymentTerms} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" name="notes" defaultValue={editingVendor?.notes} />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => { setIsAddDialogOpen(false); setEditingVendor(null); }}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                  {editingVendor ? 'Update' : 'Add'} Vendor
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
            placeholder="Search vendors..."
            className="pl-10"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Filter by category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {VENDOR_CATEGORIES.map(cat => (
              <SelectItem key={cat} value={cat}>{cat.replace(/_/g, ' ')}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredVendors.length === 0 ? (
          <Card className="col-span-full">
            <CardContent className="text-center py-8 text-muted-foreground">
              {vendors.length === 0 ? "No vendors yet. Add your first service provider to get started." : "No vendors match your search."}
            </CardContent>
          </Card>
        ) : (
          filteredVendors.map((vendor: any) => (
            <Card key={vendor.id} className="relative">
              <CardContent className="p-4">
                <div className="absolute top-2 right-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setEditingVendor(vendor)}>
                        <Edit className="w-4 h-4 mr-2" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-red-600"
                        onClick={() => {
                          if (confirm('Are you sure you want to delete this vendor?')) {
                            deleteMutation.mutate(vendor.id);
                          }
                        }}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="flex items-start gap-3">
                  <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded-lg">
                    <Users className="w-6 h-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold truncate">{vendor.name}</h3>
                      {vendor.isPreferred && (
                        <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                      )}
                    </div>
                    {getCategoryBadge(vendor.category)}
                  </div>
                </div>

                <div className="mt-4 space-y-2 text-sm">
                  {vendor.phone24_7 && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Phone className="w-4 h-4" />
                      <span>{vendor.phone24_7} (24/7)</span>
                    </div>
                  )}
                  {vendor.phoneDay && !vendor.phone24_7 && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Phone className="w-4 h-4" />
                      <span>{vendor.phoneDay}</span>
                    </div>
                  )}
                  {vendor.email && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Mail className="w-4 h-4" />
                      <span className="truncate">{vendor.email}</span>
                    </div>
                  )}
                  {(vendor.city || vendor.state) && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <MapPin className="w-4 h-4" />
                      <span>{[vendor.city, vendor.state].filter(Boolean).join(', ')}</span>
                    </div>
                  )}
                </div>

                {vendor.notes && (
                  <p className="mt-3 text-xs text-muted-foreground line-clamp-2">{vendor.notes}</p>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
