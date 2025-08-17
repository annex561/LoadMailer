import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { insertDriverSchema, insertCustomerSchema, type InsertDriver, type InsertCustomer, type Driver, type Customer } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

interface ContactFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  type: "driver" | "customer";
  contact?: Driver | Customer;
  isEdit?: boolean;
}

export default function ContactFormModal({ 
  isOpen, 
  onClose, 
  onSuccess, 
  type, 
  contact, 
  isEdit 
}: ContactFormModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const schema = type === "driver" ? insertDriverSchema : insertCustomerSchema;
  
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: type === "driver" 
      ? {
          name: (contact as Driver)?.name || "",
          email: (contact as Driver)?.email || "",
          phone: (contact as Driver)?.phone || "",
          status: (contact as Driver)?.status || "available",
          equipmentType: (contact as Driver)?.equipmentType || "sprinter_van",
        }
      : {
          name: (contact as Customer)?.name || "",
          contactPerson: (contact as Customer)?.contactPerson || "",
          email: (contact as Customer)?.email || "",
          phone: (contact as Customer)?.phone || "",
          address: (contact as Customer)?.address || "",
          status: (contact as Customer)?.status || "active",
        },
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertDriver | InsertCustomer) => {
      const endpoint = type === "driver" ? "/api/drivers" : "/api/customers";
      const response = await apiRequest("POST", endpoint, data);
      return response.json();
    },
    onSuccess: () => {
      const queryKey = type === "driver" ? ["/api/drivers"] : ["/api/customers"];
      queryClient.invalidateQueries({ queryKey });
      toast({
        title: "Success",
        description: `${type === "driver" ? "Driver" : "Customer"} created successfully`,
      });
      form.reset();
      onSuccess();
    },
    onError: () => {
      toast({
        title: "Error",
        description: `Failed to create ${type}`,
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<InsertDriver | InsertCustomer>) => {
      const endpoint = type === "driver" 
        ? `/api/drivers/${contact?.id}` 
        : `/api/customers/${contact?.id}`;
      const response = await apiRequest("PUT", endpoint, data);
      return response.json();
    },
    onSuccess: () => {
      const queryKey = type === "driver" ? ["/api/drivers"] : ["/api/customers"];
      queryClient.invalidateQueries({ queryKey });
      toast({
        title: "Success",
        description: `${type === "driver" ? "Driver" : "Customer"} updated successfully`,
      });
      onSuccess();
    },
    onError: () => {
      toast({
        title: "Error",
        description: `Failed to update ${type}`,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: any) => {
    if (isEdit) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md" data-testid={`${type}-form-modal`}>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Edit ${type === "driver" ? "Driver" : "Customer"}` : `Add New ${type === "driver" ? "Driver" : "Customer"}`}
          </DialogTitle>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" data-testid={`${type}-form`}>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{type === "driver" ? "Driver Name" : "Company Name"}</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      placeholder={type === "driver" ? "John Doe" : "ABC Manufacturing"}
                      data-testid={`input-${type}-name`}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {type === "customer" && (
              <FormField
                control={form.control}
                name="contactPerson"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact Person</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        placeholder="John Smith"
                        data-testid="input-contact-person"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      type="email"
                      placeholder="john@example.com"
                      data-testid={`input-${type}-email`}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      placeholder="(555) 123-4567"
                      data-testid={`input-${type}-phone`}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {type === "customer" && (
              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <Textarea 
                        {...field} 
                        rows={3}
                        placeholder="1234 Business St, City, State 12345"
                        data-testid="textarea-customer-address"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {type === "driver" && (
              <FormField
                control={form.control}
                name="equipmentType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Equipment Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value} data-testid="select-driver-equipment-type">
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select equipment type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="sprinter_van">Sprinter Van (SV)</SelectItem>
                        <SelectItem value="van_lift_gate">Van Lift-Gate (VG)</SelectItem>
                        <SelectItem value="van_hotshot">Van Hotshot (VH)</SelectItem>
                        <SelectItem value="straight_box_truck">Straight Box Truck (SB)</SelectItem>
                        <SelectItem value="moving_van">Moving Van (MV)</SelectItem>
                        <SelectItem value="flatbed_hotshot">Flatbed Hotshot (FH)</SelectItem>
                        <SelectItem value="van">Van (V)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value} data-testid={`select-${type}-status`}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {type === "driver" ? (
                        <>
                          <SelectItem value="available">Available</SelectItem>
                          <SelectItem value="on_route">On Route</SelectItem>
                          <SelectItem value="unavailable">Unavailable</SelectItem>
                        </>
                      ) : (
                        <>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <div className="flex items-center justify-end space-x-4 pt-4 border-t border-gray-200">
              <Button 
                type="button" 
                variant="outline" 
                onClick={onClose}
                data-testid={`button-cancel-${type}`}
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={isPending}
                className="bg-primary text-white hover:bg-blue-700"
                data-testid={`button-save-${type}`}
              >
                {isPending 
                  ? "Saving..." 
                  : isEdit 
                    ? `Update ${type === "driver" ? "Driver" : "Customer"}` 
                    : `Add ${type === "driver" ? "Driver" : "Customer"}`}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
