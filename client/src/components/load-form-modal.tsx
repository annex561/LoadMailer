import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Plus } from "lucide-react";
import { insertLoadSchema, type InsertLoad, type Driver, type Customer } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

interface LoadFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  load?: any;
  isEdit?: boolean;
}

export default function LoadFormModal({ isOpen, onClose, onSuccess, load, isEdit }: LoadFormModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<InsertLoad>({
    resolver: zodResolver(insertLoadSchema),
    defaultValues: {
      customerId: load?.customerId || "",
      driverId: load?.driverId || "",
      description: load?.description || "",
      weight: load?.weight || 0,
      priority: load?.priority || "standard",
      pickupAddress: load?.pickupAddress || "",
      pickupDate: load?.pickupDate ? load.pickupDate.split('T')[0] : "",
      pickupTime: load?.pickupTime || "",
      deliveryAddress: load?.deliveryAddress || "",
      deliveryDate: load?.deliveryDate ? load.deliveryDate.split('T')[0] : "",
      deliveryTime: load?.deliveryTime || "",
      specialInstructions: load?.specialInstructions || "",
      status: load?.status || "scheduled",
    },
  });

  const { data: drivers = [] } = useQuery<Driver[]>({
    queryKey: ["/api/drivers"],
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertLoad) => {
      const response = await apiRequest("POST", "/api/loads", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/loads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard-stats"] });
      toast({
        title: "Success",
        description: "Load created successfully and emails sent",
      });
      form.reset();
      onSuccess();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to create load",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: InsertLoad) => {
      const response = await apiRequest("PUT", `/api/loads/${load.id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/loads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard-stats"] });
      toast({
        title: "Success",
        description: "Load updated successfully",
      });
      onSuccess();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to update load",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: InsertLoad) => {
    if (isEdit) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-screen overflow-y-auto" data-testid="load-form-modal">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Load" : "Create New Load"}</DialogTitle>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" data-testid="load-form">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Load Information */}
              <div className="space-y-4">
                <h4 className="text-lg font-medium text-gray-900">Load Information</h4>
                
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Input 
                          {...field} 
                          placeholder="e.g., Electronics & Appliances" 
                          data-testid="input-description"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="weight"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Weight (lbs)</FormLabel>
                        <FormControl>
                          <Input 
                            {...field} 
                            type="number" 
                            placeholder="4500"
                            onChange={(e) => field.onChange(Number(e.target.value))}
                            data-testid="input-weight"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="priority"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Priority</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value} data-testid="select-priority">
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select priority" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="standard">Standard</SelectItem>
                            <SelectItem value="high">High</SelectItem>
                            <SelectItem value="urgent">Urgent</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="customerId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Customer</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value} data-testid="select-customer">
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select customer" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {customers.map((customer) => (
                            <SelectItem key={customer.id} value={customer.id}>
                              {customer.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              
              {/* Route Information */}
              <div className="space-y-4">
                <h4 className="text-lg font-medium text-gray-900">Pickup Details</h4>
                <FormField
                  control={form.control}
                  name="pickupAddress"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Pickup Address</FormLabel>
                      <FormControl>
                        <Textarea 
                          {...field} 
                          rows={3} 
                          placeholder="1234 Industrial Blvd, Chicago, IL 60601"
                          data-testid="textarea-pickup-address"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="pickupDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Pickup Date</FormLabel>
                        <FormControl>
                          <Input {...field} type="date" data-testid="input-pickup-date" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="pickupTime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Pickup Time</FormLabel>
                        <FormControl>
                          <Input {...field} type="time" data-testid="input-pickup-time" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                
                <h4 className="text-lg font-medium text-gray-900 pt-4">Delivery Details</h4>
                <FormField
                  control={form.control}
                  name="deliveryAddress"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Delivery Address</FormLabel>
                      <FormControl>
                        <Textarea 
                          {...field} 
                          rows={3} 
                          placeholder="5678 Commerce St, Detroit, MI 48201"
                          data-testid="textarea-delivery-address"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="deliveryDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Delivery Date</FormLabel>
                        <FormControl>
                          <Input {...field} type="date" data-testid="input-delivery-date" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="deliveryTime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Delivery Time</FormLabel>
                        <FormControl>
                          <Input {...field} type="time" data-testid="input-delivery-time" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </div>
            
            {/* Driver Assignment */}
            <div className="pt-6 border-t border-gray-200">
              <h4 className="text-lg font-medium text-gray-900 mb-4">Driver Assignment</h4>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="driverId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Assign Driver</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value} data-testid="select-driver">
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select driver or auto-assign" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="auto">Auto-assign based on availability</SelectItem>
                          {drivers.filter(driver => driver.status === "available").map((driver) => (
                            <SelectItem key={driver.id} value={driver.id}>
                              {driver.name} - {driver.status}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="specialInstructions"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Special Instructions</FormLabel>
                      <FormControl>
                        <Input 
                          {...field} 
                          value={field.value || ""}
                          placeholder="e.g., Call upon arrival"
                          data-testid="input-special-instructions"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
            
            <div className="flex items-center justify-end space-x-4 pt-6 border-t border-gray-200">
              <Button 
                type="button" 
                variant="outline" 
                onClick={onClose}
                data-testid="button-cancel-load"
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={isPending}
                data-testid="button-save-load"
              >
                {isPending ? "Creating..." : isEdit ? "Update Load" : "Create Load"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
