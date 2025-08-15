import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Edit, Copy, Eye, Mail, Trash2, Send } from "lucide-react";
import type { EmailTemplate } from "@shared/schema";
import EmailTemplateFormModal from "@/components/email-template-form-modal";
import TestEmailModal from "@/components/test-email-modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export default function Templates() {
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [showTestModal, setShowTestModal] = useState(false);
  const [testingTemplate, setTestingTemplate] = useState<EmailTemplate | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: templates = [], isLoading } = useQuery<EmailTemplate[]>({
    queryKey: ["/api/email-templates"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/email-templates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-templates"] });
      toast({
        title: "Success",
        description: "Email template deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete email template",
        variant: "destructive",
      });
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: async (template: EmailTemplate) => {
      const { id, createdAt, ...templateData } = template;
      const duplicateData = {
        ...templateData,
        name: `${template.name} (Copy)`,
      };
      const response = await apiRequest("POST", "/api/email-templates", duplicateData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-templates"] });
      toast({
        title: "Success",
        description: "Email template duplicated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to duplicate email template",
        variant: "destructive",
      });
    },
  });

  const getTemplateIcon = (trigger: string) => {
    const iconMap = {
      load_created: { icon: "📦", bgColor: "bg-primary bg-opacity-10", iconColor: "text-primary" },
      pickup_confirmed: { icon: "🚛", bgColor: "bg-warning bg-opacity-10", iconColor: "text-warning" },
      in_transit: { icon: "🛣️", bgColor: "bg-secondary bg-opacity-10", iconColor: "text-secondary" },
      delivered: { icon: "✅", bgColor: "bg-success bg-opacity-10", iconColor: "text-success" },
    };

    return iconMap[trigger as keyof typeof iconMap] || iconMap.load_created;
  };

  const getTriggerLabel = (trigger: string) => {
    const triggerMap = {
      load_created: "Load Created",
      pickup_confirmed: "Pickup Confirmed",
      in_transit: "In Transit",
      delivered: "Delivery Complete",
    };

    return triggerMap[trigger as keyof typeof triggerMap] || trigger;
  };

  const getRecipientsLabel = (recipients: string) => {
    const recipientMap = {
      driver: "Driver",
      customer: "Customer",
      both: "Customer & Driver",
    };

    return recipientMap[recipients as keyof typeof recipientMap] || recipients;
  };

  const handleDelete = (template: EmailTemplate) => {
    if (window.confirm(`Are you sure you want to delete "${template.name}"? This action cannot be undone.`)) {
      deleteMutation.mutate(template.id);
    }
  };

  const handleDuplicate = (template: EmailTemplate) => {
    duplicateMutation.mutate(template);
  };

  const handleTest = (template: EmailTemplate) => {
    setTestingTemplate(template);
    setShowTestModal(true);
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
            <div className="h-20 bg-gray-200 rounded"></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="h-48 bg-gray-200 rounded"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="p-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Email Templates</h3>
                <p className="text-sm text-gray-500">Manage automated email notification templates ({templates.length} total)</p>
              </div>
              <Button
                onClick={() => setShowTemplateModal(true)}
                className="bg-primary text-white hover:bg-blue-700"
                data-testid="button-new-template"
              >
                <Plus className="mr-2 w-4 h-4" />
                New Template
              </Button>
            </div>
          </div>
          
          <div className="p-6">
            {templates.length === 0 ? (
              <div className="text-center py-12" data-testid="empty-templates">
                <Mail className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-4 text-lg font-medium text-gray-900">No email templates</h3>
                <p className="mt-2 text-sm text-gray-500">
                  Get started by creating your first email template for automated notifications.
                </p>
                <div className="mt-6">
                  <Button
                    onClick={() => setShowTemplateModal(true)}
                    className="bg-primary text-white hover:bg-blue-700"
                    data-testid="button-create-first-template"
                  >
                    <Plus className="mr-2 w-4 h-4" />
                    Create Template
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {templates.map((template) => {
                  const iconConfig = getTemplateIcon(template.trigger);
                  
                  return (
                    <div 
                      key={template.id} 
                      className="border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow"
                      data-testid={`template-card-${template.id}`}
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div className={`w-12 h-12 ${iconConfig.bgColor} rounded-lg flex items-center justify-center`}>
                          <span className="text-xl">{iconConfig.icon}</span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => setEditingTemplate(template)}
                            data-testid={`button-edit-template-${template.id}`}
                          >
                            <Edit className="w-4 h-4 text-gray-600" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => handleDuplicate(template)}
                            disabled={duplicateMutation.isPending}
                            data-testid={`button-duplicate-template-${template.id}`}
                          >
                            <Copy className="w-4 h-4 text-green-600" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => handleDelete(template)}
                            disabled={deleteMutation.isPending}
                            data-testid={`button-delete-template-${template.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-danger" />
                          </Button>
                        </div>
                      </div>
                      
                      <h4 className="text-lg font-semibold text-gray-900 mb-2">{template.name}</h4>
                      <p className="text-sm text-gray-500 mb-4 line-clamp-2">{template.description}</p>
                      
                      <div className="space-y-2 mb-4">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-500">Trigger:</span>
                          <span className="text-gray-900">{getTriggerLabel(template.trigger)}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-500">Recipients:</span>
                          <span className="text-gray-900">{getRecipientsLabel(template.recipients)}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-500">Status:</span>
                          <Badge 
                            className={template.isActive 
                              ? "bg-success bg-opacity-10 text-success border-0" 
                              : "bg-destructive bg-opacity-10 text-destructive border-0"
                            }
                          >
                            {template.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-3">
                        <Button 
                          variant="outline" 
                          className="flex-1 text-sm"
                          data-testid={`button-preview-template-${template.id}`}
                        >
                          <Eye className="w-4 h-4 mr-2" />
                          Preview
                        </Button>
                        <Button 
                          className="flex-1 bg-primary text-white hover:bg-blue-700 text-sm"
                          onClick={() => handleTest(template)}
                          data-testid={`button-test-template-${template.id}`}
                        >
                          <Send className="w-4 h-4 mr-2" />
                          Test Send
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <EmailTemplateFormModal
        isOpen={showTemplateModal}
        onClose={() => setShowTemplateModal(false)}
        onSuccess={() => setShowTemplateModal(false)}
      />

      {editingTemplate && (
        <EmailTemplateFormModal
          isOpen={true}
          onClose={() => setEditingTemplate(null)}
          onSuccess={() => setEditingTemplate(null)}
          template={editingTemplate}
          isEdit={true}
        />
      )}

      {testingTemplate && (
        <TestEmailModal
          isOpen={showTestModal}
          onClose={() => {
            setShowTestModal(false);
            setTestingTemplate(null);
          }}
          template={testingTemplate}
        />
      )}
    </>
  );
}
