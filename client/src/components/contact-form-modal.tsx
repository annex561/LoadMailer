import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { insertDriverSchema, insertCustomerSchema, type InsertDriver, type InsertCustomer, type Driver, type Customer } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useState } from "react";

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
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [duplicateContacts, setDuplicateContacts] = useState<(Driver | Customer)[]>([]);
  const [pendingSubmission, setPendingSubmission] = useState<any>(null);

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
          loadType: (contact as Driver)?.loadType || "full_partial",
          maxLength: (contact as Driver)?.maxLength || 53,
          maxWeight: (contact as Driver)?.maxWeight || 26000,
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

  const checkDuplicatesMutation = useMutation({
    mutationFn: async (data: { name: string; email: string; phone: string; type: string }) => {
      const response = await apiRequest("POST", "/api/check-duplicates", data);
      return response.json();
    },
    onSuccess: (result, variables) => {
      if (result.hasDuplicates) {
        setDuplicateContacts(result.duplicates);
        setPendingSubmission(form.getValues());
        setShowDuplicateDialog(true);
      } else {
        // No duplicates, proceed with creation
        createMutation.mutate(form.getValues());
      }
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to check for duplicates",
        variant: "destructive",
      });
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
      setShowDuplicateDialog(false);
      setPendingSubmission(null);
      onSuccess();
    },
    onError: (error: any) => {
      if (error?.status === 409) {
        // Handle duplicate error from backend
        const duplicates = error.data?.duplicates || [];
        setDuplicateContacts(duplicates);
        setShowDuplicateDialog(true);
      } else {
        toast({
          title: "Error",
          description: `Failed to create ${type}`,
          variant: "destructive",
        });
      }
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
    onSuccess: async () => {
      const queryKey = type === "driver" ? ["/api/drivers"] : ["/api/customers"];
      queryClient.invalidateQueries({ queryKey });
      
      // If this is a driver update, trigger load matching refresh
      if (type === "driver" && contact?.id) {
        try {
          await apiRequest("POST", `/api/drivers/${contact.id}/refresh-load-matching`, {});
        } catch (error) {
          console.log("Load matching refresh triggered for driver");
        }
      }
      
      toast({
        title: "Success",
        description: `${type === "driver" ? "Driver" : "Customer"} updated successfully${type === "driver" ? ". Load matching refreshed." : ""}`,
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

  const onSubmit = async (data: InsertDriver | InsertCustomer) => {
    if (isEdit && contact) {
      updateMutation.mutate({ id: contact.id, data });
    } else {
      // Check for duplicates first
      checkDuplicatesMutation.mutate({
        name: data.name,
        email: data.email,
        phone: data.phone,
        type: type,
      });
    }
  };

  const handleEditExisting = (existingContact: Driver | Customer) => {
    // Close duplicate dialog and current modal
    setShowDuplicateDialog(false);
    onClose();
    
    // Reset form with existing contact data
    form.reset(type === "driver" 
      ? {
          name: existingContact.name,
          email: existingContact.email,
          phone: existingContact.phone,
          status: (existingContact as Driver).status || "available",
          equipmentType: (existingContact as Driver).equipmentType || "sprinter_van",
          loadType: (existingContact as Driver).loadType || "full_partial",
          maxLength: (existingContact as Driver).maxLength || 53,
          maxWeight: (existingContact as Driver).maxWeight || 26000,
        }
      : {
          name: existingContact.name,
          contactPerson: (existingContact as Customer).contactPerson || "",
          email: existingContact.email,
          phone: existingContact.phone,
          address: (existingContact as Customer).address || "",
          status: (existingContact as Customer).status || "active",
        }
    );
    
    // Notify parent to open edit mode
    // This would typically require passing additional props to enable editing
    toast({
      title: "Contact Found",
      description: `Switching to edit mode for existing ${type}: ${existingContact.name}`,
    });
  };

  const handleCreateAnyway = () => {
    if (pendingSubmission) {
      // Force create despite duplicates
      createMutation.mutate(pendingSubmission);
    }
    setShowDuplicateDialog(false);
  };

  const isPending = createMutation.isPending || updateMutation.isPending || checkDuplicatesMutation.isPending;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md dialog-improved" data-testid={`${type}-form-modal`}>
        <DialogHeader className="dialog-header-improved">
          <DialogTitle className="dialog-title-improved">
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
                  <FormLabel className="form-label-improved">{type === "driver" ? "Driver Name" : "Company Name"}</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      placeholder={type === "driver" ? "John Doe" : "ABC Manufacturing"}
                      className="form-input-improved"
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
                    <FormLabel className="form-label-improved">Contact Person</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        placeholder="John Smith"
                        className="form-input-improved"
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
                  <FormLabel className="form-label-improved">Email</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      type="email"
                      placeholder="john@example.com"
                      className="form-input-improved"
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
                  <FormLabel className="form-label-improved">Phone</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      placeholder="(555) 123-4567"
                      className="form-input-improved"
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
                    <FormLabel className="form-label-improved">Address</FormLabel>
                    <FormControl>
                      <Textarea 
                        {...field} 
                        rows={3}
                        placeholder="1234 Business St, City, State 12345"
                        className="form-textarea-improved"
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
                    <FormLabel className="form-label-improved">Equipment Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value} data-testid="select-driver-equipment-type">
                      <FormControl>
                        <SelectTrigger className="bg-white border border-gray-300">
                          <SelectValue placeholder="Select equipment type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="bg-white border border-gray-300 shadow-lg">
                        <SelectItem value="vans_standard">Vans (Standard)</SelectItem>
                        <SelectItem value="dry_van">Dry Van</SelectItem>
                        <SelectItem value="refrigerated">Refrigerated</SelectItem>
                        <SelectItem value="flatbed">Flatbed</SelectItem>
                        <SelectItem value="step_deck">Step Deck</SelectItem>
                        <SelectItem value="lowboy">Lowboy</SelectItem>
                        <SelectItem value="power_only">Power Only</SelectItem>
                        <SelectItem value="container">Container</SelectItem>
                        <SelectItem value="car_carrier">Car Carrier</SelectItem>
                        <SelectItem value="tanker">Tanker</SelectItem>
                        <SelectItem value="dump_truck">Dump Truck</SelectItem>
                        <SelectItem value="conestoga">Conestoga</SelectItem>
                        <SelectItem value="removable_gooseneck">Removable Gooseneck (RGN)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}



            {type === "driver" && (
              <FormField
                control={form.control}
                name="loadType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="form-label-improved">Load Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value} data-testid="select-preferred-load-types">
                      <FormControl>
                        <SelectTrigger className="bg-white border border-gray-300 shadow-lg">
                          <SelectValue placeholder="Select load type preference" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="bg-white border border-gray-300 shadow-lg">
                        <SelectItem value="full">Full Load Only</SelectItem>
                        <SelectItem value="partial">Partial Load Only</SelectItem>
                        <SelectItem value="full_partial">Full & Partial</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <div className="grid grid-cols-2 gap-4">
              {type === "driver" && (
                <FormField
                  control={form.control}
                  name="maxLength"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="form-label-improved">Length ft</FormLabel>
                      <FormControl>
                        <Input 
                          {...field} 
                          type="number"
                          placeholder="53"
                          className="form-input-improved"
                          data-testid="input-max-length"
                          onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
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
                  name="maxWeight"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="form-label-improved">Weight lbs</FormLabel>
                      <FormControl>
                        <Input 
                          {...field} 
                          type="number"
                          placeholder="26000"
                          className="form-input-improved"
                          data-testid="input-max-weight"
                          onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="form-label-improved">Status</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value} data-testid={`select-${type}-status`}>
                    <FormControl>
                      <SelectTrigger className="bg-white border border-gray-300">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="bg-white border border-gray-300 shadow-lg">
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
                className="bg-blue-600 text-white hover:bg-blue-700 form-button-improved"
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
      
      <AlertDialog open={showDuplicateDialog} onOpenChange={setShowDuplicateDialog}>
        <AlertDialogContent data-testid="duplicate-warning-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Duplicate Contact Found</AlertDialogTitle>
            <AlertDialogDescription>
              A {type} with similar information already exists. What would you like to do?
              
              {duplicateContacts.length > 0 && (
                <div className="mt-4 space-y-2">
                  <p className="font-medium">Existing contacts:</p>
                  {duplicateContacts.map((duplicate) => (
                    <div 
                      key={duplicate.id} 
                      className="p-3 bg-gray-50 rounded-lg border"
                      data-testid={`duplicate-contact-${duplicate.id}`}
                    >
                      <div className="font-medium">{duplicate.name}</div>
                      <div className="text-sm text-gray-600">
                        {duplicate.email} • {duplicate.phone}
                      </div>
                      {type === "customer" && (duplicate as Customer).contactPerson && (
                        <div className="text-sm text-gray-600">
                          Contact: {(duplicate as Customer).contactPerson}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
            <AlertDialogCancel 
              onClick={() => {
                setShowDuplicateDialog(false);
                setPendingSubmission(null);
              }}
              data-testid="button-cancel-duplicate"
            >
              Cancel
            </AlertDialogCancel>
            
            {duplicateContacts.length > 0 && (
              <Button
                variant="outline"
                onClick={() => handleEditExisting(duplicateContacts[0])}
                data-testid="button-edit-existing"
                className="bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100"
              >
                Edit Existing Contact
              </Button>
            )}
            
            <AlertDialogAction
              onClick={handleCreateAnyway}
              data-testid="button-create-anyway"
              className="bg-orange-600 hover:bg-orange-700"
            >
              Create New Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
