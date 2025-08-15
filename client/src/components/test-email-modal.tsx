import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import type { EmailTemplate, LoadWithRelations } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

const testEmailSchema = z.object({
  recipientEmail: z.string().email("Please enter a valid email address"),
  loadId: z.string().optional(),
});

type TestEmailForm = z.infer<typeof testEmailSchema>;

interface TestEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  template: EmailTemplate;
}

export default function TestEmailModal({ isOpen, onClose, template }: TestEmailModalProps) {
  const { toast } = useToast();

  const form = useForm<TestEmailForm>({
    resolver: zodResolver(testEmailSchema),
    defaultValues: {
      recipientEmail: "",
      loadId: "",
    },
  });

  const { data: loads = [] } = useQuery<LoadWithRelations[]>({
    queryKey: ["/api/loads"],
  });

  const sendTestEmailMutation = useMutation({
    mutationFn: async (data: TestEmailForm) => {
      const response = await apiRequest("POST", "/api/test-email", {
        templateId: template.id,
        recipientEmail: data.recipientEmail,
        loadId: data.loadId || null,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Test email sent successfully",
      });
      form.reset();
      onClose();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to send test email",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: TestEmailForm) => {
    sendTestEmailMutation.mutate(data);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md" data-testid="test-email-modal">
        <DialogHeader>
          <DialogTitle>Send Test Email</DialogTitle>
        </DialogHeader>
        
        <div className="mb-4">
          <h4 className="text-sm font-medium text-gray-900 mb-2">Template: {template.name}</h4>
          <p className="text-sm text-gray-500">{template.description}</p>
        </div>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" data-testid="test-email-form">
            <FormField
              control={form.control}
              name="recipientEmail"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Recipient Email</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      type="email"
                      placeholder="test@example.com"
                      data-testid="input-recipient-email"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="loadId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Test with Load (Optional)</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value} data-testid="select-test-load">
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Use sample data or select a load" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="">Use sample test data</SelectItem>
                      {loads.slice(0, 10).map((load) => (
                        <SelectItem key={load.id} value={load.id}>
                          {load.loadNumber} - {load.customer.name}
                        </SelectItem>
                      ))}
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
                data-testid="button-cancel-test"
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={sendTestEmailMutation.isPending}
                data-testid="button-send-test"
              >
                {sendTestEmailMutation.isPending ? "Sending..." : "Send Test Email"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}