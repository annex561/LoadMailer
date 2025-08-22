import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { CheckCircle, AlertCircle, ExternalLink, Webhook, BarChart3, Loader2 } from "lucide-react";

interface TaskMagicStatus {
  integration: string;
  status: string;
  webhookEndpoints: {
    singleLoad: string;
    batchLoads: string;
  };
  totalTaskMagicLoads: number;
  availableLoads: number;
  assignedLoads: number;
  inTransitLoads: number;
  deliveredLoads: number;
  lastUpdated: string;
}

export function TaskMagicStatusPage() {
  const { data: status, isLoading, error, refetch } = useQuery<TaskMagicStatus>({
    queryKey: ['/api/taskmagic/status'],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex items-center gap-2">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span>Loading TaskMagic status...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error Loading Status</AlertTitle>
          <AlertDescription>
            Failed to load TaskMagic integration status. Please check your connection and try again.
          </AlertDescription>
        </Alert>
        <Button onClick={() => refetch()} className="mt-4">
          Retry
        </Button>
      </div>
    );
  }

  const isActive = status?.status === 'active';
  const hasLoads = (status?.totalTaskMagicLoads || 0) > 0;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">TaskMagic Integration</h1>
          <p className="text-muted-foreground mt-1">
            Automated DAT load scraping and processing status
          </p>
        </div>
        <Button onClick={() => refetch()} variant="outline">
          Refresh Status
        </Button>
      </div>

      {/* Status Overview */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                {isActive ? (
                  <CheckCircle className="h-5 w-5 text-green-600" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-yellow-600" />
                )}
                Integration Status
              </CardTitle>
              <CardDescription>
                Current status of TaskMagic DAT automation
              </CardDescription>
            </div>
            <Badge variant={isActive ? "default" : "secondary"}>
              {status?.status || 'Unknown'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {isActive ? (
              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertTitle>TaskMagic Integration Active</AlertTitle>
                <AlertDescription>
                  Your system is ready to receive DAT loads from TaskMagic automations. 
                  Configure your TaskMagic workflows to send data to the webhook endpoints below.
                </AlertDescription>
              </Alert>
            ) : (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Integration Not Active</AlertTitle>
                <AlertDescription>
                  The TaskMagic integration is not currently active. Check your configuration
                  and ensure the webhook endpoints are properly set up.
                </AlertDescription>
              </Alert>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Load Statistics */}
      {status && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Load Statistics
            </CardTitle>
            <CardDescription>
              TaskMagic processed loads breakdown
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">
                  {status.totalTaskMagicLoads}
                </div>
                <div className="text-sm text-muted-foreground">Total Loads</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">
                  {status.availableLoads}
                </div>
                <div className="text-sm text-muted-foreground">Available</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-yellow-600">
                  {status.assignedLoads}
                </div>
                <div className="text-sm text-muted-foreground">Assigned</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-600">
                  {status.inTransitLoads}
                </div>
                <div className="text-sm text-muted-foreground">In Transit</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">
                  {status.deliveredLoads}
                </div>
                <div className="text-sm text-muted-foreground">Delivered</div>
              </div>
            </div>
            
            {!hasLoads && (
              <Alert className="mt-4">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>No TaskMagic Loads Yet</AlertTitle>
                <AlertDescription>
                  Once you configure TaskMagic to send DAT loads to your webhook endpoints,
                  they will appear here and in your main DAT Loads dashboard.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* Webhook Endpoints */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Webhook className="h-5 w-5" />
            Webhook Endpoints
          </CardTitle>
          <CardDescription>
            Configure these URLs in your TaskMagic automations
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Single Load Processing</label>
              <div className="flex items-center gap-2 mt-1">
                <code className="flex-1 p-2 bg-muted rounded text-sm">
                  {window.location.origin}{status?.webhookEndpoints?.singleLoad}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigator.clipboard.writeText(
                    `${window.location.origin}${status?.webhookEndpoints?.singleLoad}`
                  )}
                >
                  Copy
                </Button>
              </div>
            </div>
            
            <div>
              <label className="text-sm font-medium">Batch Load Processing</label>
              <div className="flex items-center gap-2 mt-1">
                <code className="flex-1 p-2 bg-muted rounded text-sm">
                  {window.location.origin}{status?.webhookEndpoints?.batchLoads}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigator.clipboard.writeText(
                    `${window.location.origin}${status?.webhookEndpoints?.batchLoads}`
                  )}
                >
                  Copy
                </Button>
              </div>
            </div>
          </div>

          <Separator />
          
          <div className="space-y-2">
            <h4 className="font-medium">Authentication</h4>
            <p className="text-sm text-muted-foreground">
              Include the webhook secret in your TaskMagic automation:
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 p-2 bg-muted rounded text-sm">
                x-taskmagic-secret: taskmagic-webhook-secret-2025
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigator.clipboard.writeText('taskmagic-webhook-secret-2025')}
              >
                Copy Secret
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Setup Instructions */}
      <Card>
        <CardHeader>
          <CardTitle>TaskMagic Setup Instructions</CardTitle>
          <CardDescription>
            Follow these steps to configure DAT load scraping in TaskMagic
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-sm font-bold flex items-center justify-center mt-0.5">
                1
              </div>
              <div>
                <h4 className="font-medium">Create DAT Login Automation</h4>
                <p className="text-sm text-muted-foreground">
                  Set up TaskMagic to automatically log into DAT using your credentials
                </p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-sm font-bold flex items-center justify-center mt-0.5">
                2
              </div>
              <div>
                <h4 className="font-medium">Configure Load Scraping</h4>
                <p className="text-sm text-muted-foreground">
                  Extract load data including company, rates, equipment type, and routes
                </p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-sm font-bold flex items-center justify-center mt-0.5">
                3
              </div>
              <div>
                <h4 className="font-medium">Set Webhook URLs</h4>
                <p className="text-sm text-muted-foreground">
                  Configure TaskMagic to send scraped data to the webhook endpoints above
                </p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-sm font-bold flex items-center justify-center mt-0.5">
                4
              </div>
              <div>
                <h4 className="font-medium">Test & Monitor</h4>
                <p className="text-sm text-muted-foreground">
                  Verify loads appear in your DAT Loads dashboard and drivers receive notifications
                </p>
              </div>
            </div>
          </div>
          
          <div className="flex gap-2 pt-4">
            <Button asChild>
              <a 
                href="/taskmagic-setup-guide" 
                target="_blank"
                className="flex items-center gap-2"
              >
                <ExternalLink className="h-4 w-4" />
                Detailed Setup Guide
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href="/dat-loads">View DAT Loads</a>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Last Updated */}
      {status?.lastUpdated && (
        <div className="text-center text-sm text-muted-foreground">
          Last updated: {new Date(status.lastUpdated).toLocaleString()}
        </div>
      )}
    </div>
  );
}