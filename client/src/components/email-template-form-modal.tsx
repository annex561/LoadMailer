import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { insertEmailTemplateSchema, type InsertEmailTemplate, type EmailTemplate } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

interface EmailTemplateFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  template?: EmailTemplate;
  isEdit?: boolean;
}

export default function EmailTemplateFormModal({ 
  isOpen, 
  onClose, 
  onSuccess, 
  template, 
  isEdit 
}: EmailTemplateFormModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<InsertEmailTemplate>({
    resolver: zodResolver(insertEmailTemplateSchema),
    defaultValues: {
      name: template?.name || "",
      description: template?.description || "",
      trigger: template?.trigger || "load_created",
      recipients: template?.recipients || "driver",
      subject: template?.subject || "",
      body: template?.body || "",
      isActive: template?.isActive ?? true,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertEmailTemplate) => {
      const response = await apiRequest("POST", "/api/email-templates", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-templates"] });
      toast({
        title: "Success",
        description: "Email template created successfully",
      });
      form.reset();
      onSuccess();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create email template",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: InsertEmailTemplate) => {
      const response = await apiRequest("PUT", `/api/email-templates/${template?.id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-templates"] });
      toast({
        title: "Success",
        description: "Email template updated successfully",
      });
      onSuccess();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update email template",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: InsertEmailTemplate) => {
    if (isEdit) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-screen overflow-y-auto" data-testid="email-template-form-modal">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Email Template" : "Create New Email Template"}</DialogTitle>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" data-testid="email-template-form">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Template Information */}
              <div className="space-y-4">
                <h4 className="text-lg font-medium text-gray-900">Template Information</h4>
                
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Template Name</FormLabel>
                      <FormControl>
                        <Input 
                          {...field} 
                          placeholder="e.g., Load Assignment Notification" 
                          data-testid="input-template-name"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea 
                          {...field} 
                          rows={3}
                          placeholder="Brief description of when this template is used"
                          data-testid="textarea-template-description"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="trigger"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Trigger Event</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value} data-testid="select-trigger">
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select trigger" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="load_created">Load Created</SelectItem>
                            <SelectItem value="pickup_confirmed">Pickup Confirmed</SelectItem>
                            <SelectItem value="in_transit">In Transit</SelectItem>
                            <SelectItem value="delivered">Delivery Complete</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="recipients"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Recipients</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value} data-testid="select-recipients">
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select recipients" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="driver">Driver Only</SelectItem>
                            <SelectItem value="customer">Customer Only</SelectItem>
                            <SelectItem value="both">Customer & Driver</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="checkbox-template-active"
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>Active Template</FormLabel>
                        <p className="text-sm text-gray-500">
                          When enabled, this template will be used for automated emails
                        </p>
                      </div>
                    </FormItem>
                  )}
                />
              </div>
              
              {/* Email Content */}
              <div className="space-y-4">
                <h4 className="text-lg font-medium text-gray-900">Email Content</h4>
                
                <FormField
                  control={form.control}
                  name="subject"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email Subject</FormLabel>
                      <FormControl>
                        <Input 
                          {...field} 
                          placeholder="e.g., New Load Assignment - {{loadNumber}}"
                          data-testid="input-template-subject"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="body"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email Body</FormLabel>
                      <FormControl>
                        <Textarea 
                          {...field} 
                          rows={12}
                          placeholder="Email content with variables like {{driverName}}, {{customerName}}, {{loadNumber}}, etc."
                          data-testid="textarea-template-body"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <div className="bg-gray-50 p-4 rounded-lg">
                  <h5 className="text-sm font-medium text-gray-900 mb-2">Available Variables</h5>
                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                    <div>• {"{{loadNumber}}"}</div>
                    <div>• {"{{customerName}}"}</div>
                    <div>• {"{{driverName}}"}</div>
                    <div>• {"{{pickupAddress}}"}</div>
                    <div>• {"{{deliveryAddress}}"}</div>
                    <div>• {"{{pickupDate}}"}</div>
                    <div>• {"{{deliveryDate}}"}</div>
                    <div>• {"{{specialInstructions}}"}</div>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="flex items-center justify-end space-x-4 pt-6 border-t border-gray-200">
              <Button 
                type="button" 
                variant="outline" 
                onClick={onClose}
                data-testid="button-cancel-template"
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={isPending}
                data-testid="button-save-template"
              >
                {isPending ? "Saving..." : isEdit ? "Update Template" : "Create Template"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}