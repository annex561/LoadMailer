import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Radio, CheckCircle, AlertCircle, Mic, FileText, Users, Hash } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface ZelloStatus {
  initialized: boolean;
  channels: Array<{
    name: string;
    userCount: number;
    active: boolean;
  }>;
  totalUsers: number;
}

interface TestResult {
  test: string;
  status: 'success' | 'error' | 'pending';
  message: string;
  timestamp: Date;
}

export default function ZelloIntegrationTest() {
  const [status, setStatus] = useState<ZelloStatus | null>(null);
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [selectedChannel, setSelectedChannel] = useState('all-drivers');
  const [testMessage, setTestMessage] = useState('Test message from Zello integration test page');
  const [loadId, setLoadId] = useState('LOAD-TEST-001');
  const [documentTypes, setDocumentTypes] = useState('pod,bol');
  const [driverId, setDriverId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchZelloStatus();
  }, []);

  const fetchZelloStatus = async () => {
    try {
      const response = await fetch('/api/zello/status');
      const data = await response.json();
      setStatus(data);
    } catch (error) {
      toast({
        title: 'Error fetching Zello status',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const addTestResult = (test: string, status: TestResult['status'], message: string) => {
    setTestResults(prev => [{
      test,
      status,
      message,
      timestamp: new Date()
    }, ...prev]);
  };

  const testAuthentication = async () => {
    setIsLoading(true);
    addTestResult('Authentication Test', 'pending', 'Testing Zello authentication...');
    
    try {
      const response = await fetch('/api/zello/test-auth', { method: 'POST' });
      const data = await response.json();
      
      if (data.success) {
        addTestResult('Authentication Test', 'success', `✅ Authentication successful! Session ID: ${data.sessionId}`);
        toast({
          title: 'Authentication Successful',
          description: 'Zello API authentication is working correctly',
        });
      } else {
        addTestResult('Authentication Test', 'error', `❌ Authentication failed: ${data.message}`);
        toast({
          title: 'Authentication Failed',
          description: data.message,
          variant: 'destructive',
        });
      }
    } catch (error) {
      addTestResult('Authentication Test', 'error', `❌ Error: ${error.message}`);
      toast({
        title: 'Test Failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const testBroadcast = async () => {
    setIsLoading(true);
    addTestResult('Broadcast Test', 'pending', `Broadcasting to ${selectedChannel}...`);
    
    try {
      const response = await fetch('/api/zello/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: selectedChannel,
          message: testMessage
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        addTestResult('Broadcast Test', 'success', `✅ Broadcast sent to ${selectedChannel}: "${testMessage}"`);
        toast({
          title: 'Broadcast Sent',
          description: `Message sent to ${selectedChannel} channel`,
        });
      } else {
        addTestResult('Broadcast Test', 'error', `❌ Broadcast failed: ${data.error || 'Unknown error'}`);
        toast({
          title: 'Broadcast Failed',
          description: data.error || 'Unknown error',
          variant: 'destructive',
        });
      }
    } catch (error) {
      addTestResult('Broadcast Test', 'error', `❌ Error: ${error.message}`);
      toast({
        title: 'Test Failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const testDocumentRequest = async () => {
    if (!driverId) {
      toast({
        title: 'Driver ID Required',
        description: 'Please enter a driver ID to request documents',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    addTestResult('Document Request', 'pending', `Requesting documents from driver ${driverId}...`);
    
    try {
      const response = await fetch('/api/zello/request-documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driverId,
          loadId,
          documentTypes: documentTypes.split(',').map(t => t.trim())
        })
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        addTestResult('Document Request', 'success', `✅ Document request sent to ${data.username || driverId}`);
        toast({
          title: 'Document Request Sent',
          description: `Requested ${documentTypes} for load ${loadId}`,
        });
      } else {
        addTestResult('Document Request', 'error', `❌ Request failed: ${data.error || 'Unknown error'}`);
        toast({
          title: 'Request Failed',
          description: data.error || 'Unknown error',
          variant: 'destructive',
        });
      }
    } catch (error) {
      addTestResult('Document Request', 'error', `❌ Error: ${error.message}`);
      toast({
        title: 'Test Failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const testInitialize = async () => {
    setIsLoading(true);
    addTestResult('Initialize Service', 'pending', 'Initializing Zello service...');
    
    try {
      const response = await fetch('/api/zello/initialize', { method: 'POST' });
      const data = await response.json();
      
      if (data.initialized) {
        addTestResult('Initialize Service', 'success', `✅ Service initialized with ${data.totalUsers} users`);
        toast({
          title: 'Service Initialized',
          description: `Zello service is ready with ${data.totalUsers} users`,
        });
        await fetchZelloStatus(); // Refresh status
      } else {
        addTestResult('Initialize Service', 'error', `❌ Initialization failed: Service not initialized`);
        toast({
          title: 'Initialization Failed',
          description: 'Service could not be initialized',
          variant: 'destructive',
        });
      }
    } catch (error) {
      addTestResult('Initialize Service', 'error', `❌ Error: ${error.message}`);
      toast({
        title: 'Test Failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const testWebhook = async () => {
    setIsLoading(true);
    addTestResult('Webhook Test', 'pending', 'Simulating incoming Zello webhook...');
    
    try {
      const simulatedWebhookData = {
        channel: 'test-channel',
        from: 'test_driver_1234',
        type: 'text',
        text: 'This is a simulated webhook test message',
        timestamp: new Date().toISOString()
      };

      const response = await fetch('/api/zello/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(simulatedWebhookData)
      });
      
      const data = await response.json();
      
      if (response.ok) {
        addTestResult('Webhook Test', 'success', `✅ Webhook processed successfully`);
        toast({
          title: 'Webhook Test Successful',
          description: 'Webhook endpoint is working correctly',
        });
      } else {
        addTestResult('Webhook Test', 'error', `❌ Webhook processing failed`);
        toast({
          title: 'Webhook Failed',
          description: 'Webhook endpoint returned an error',
          variant: 'destructive',
        });
      }
    } catch (error) {
      addTestResult('Webhook Test', 'error', `❌ Error: ${error.message}`);
      toast({
        title: 'Test Failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="zello-test-page">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Radio className="h-8 w-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold">Zello Integration Test Suite</h1>
            <p className="text-muted-foreground">Test and verify Zello Work API integration</p>
          </div>
        </div>
        <Button onClick={fetchZelloStatus} variant="outline" data-testid="button-refresh-status">
          Refresh Status
        </Button>
      </div>

      {/* Status Overview */}
      <Card data-testid="status-overview">
        <CardHeader>
          <CardTitle>System Status</CardTitle>
          <CardDescription>Current Zello service status and configuration</CardDescription>
        </CardHeader>
        <CardContent>
          {status ? (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  {status.initialized ? (
                    <CheckCircle className="h-5 w-5 text-green-600" />
                  ) : (
                    <AlertCircle className="h-5 w-5 text-red-600" />
                  )}
                  <span className="font-medium">
                    Service: {status.initialized ? 'Initialized' : 'Not Initialized'}
                  </span>
                </div>
                <Badge variant="secondary">
                  <Users className="h-3 w-3 mr-1" />
                  {status.totalUsers} Users
                </Badge>
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Active Channels:</p>
                <div className="flex flex-wrap gap-2">
                  {status.channels.map(channel => (
                    <Badge
                      key={channel.name}
                      variant={channel.active ? 'default' : 'secondary'}
                      className="flex items-center gap-1"
                      data-testid={`channel-${channel.name}`}
                    >
                      <Hash className="h-3 w-3" />
                      {channel.name}
                      <span className="text-xs">({channel.userCount})</span>
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">Loading status...</p>
          )}
        </CardContent>
      </Card>

      {/* Test Controls */}
      <Tabs defaultValue="basic" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="basic">Basic Tests</TabsTrigger>
          <TabsTrigger value="messaging">Messaging</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        <TabsContent value="basic" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Basic Functionality Tests</CardTitle>
              <CardDescription>Test core Zello service operations</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Button 
                  onClick={testAuthentication} 
                  disabled={isLoading}
                  className="w-full"
                  data-testid="button-test-auth"
                >
                  <Mic className="mr-2 h-4 w-4" />
                  Test Authentication
                </Button>
                <Button 
                  onClick={testInitialize} 
                  disabled={isLoading}
                  className="w-full"
                  data-testid="button-test-initialize"
                >
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Initialize Service
                </Button>
                <Button 
                  onClick={testWebhook} 
                  disabled={isLoading}
                  className="w-full"
                  data-testid="button-test-webhook"
                >
                  <FileText className="mr-2 h-4 w-4" />
                  Test Webhook
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="messaging" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Broadcast Testing</CardTitle>
              <CardDescription>Send test messages to Zello channels</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Channel</label>
                <Select value={selectedChannel} onValueChange={setSelectedChannel}>
                  <SelectTrigger data-testid="select-channel">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {status?.channels.map(channel => (
                      <SelectItem key={channel.name} value={channel.name}>
                        {channel.name} ({channel.userCount} users)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Message</label>
                <Textarea
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                  placeholder="Enter test message..."
                  rows={3}
                  data-testid="input-message"
                />
              </div>

              <Button 
                onClick={testBroadcast} 
                disabled={isLoading || !testMessage}
                className="w-full"
                data-testid="button-broadcast"
              >
                <Radio className="mr-2 h-4 w-4" />
                Send Broadcast
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Document Request Testing</CardTitle>
              <CardDescription>Test document request functionality</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Driver ID</label>
                <Input
                  value={driverId}
                  onChange={(e) => setDriverId(e.target.value)}
                  placeholder="Enter driver ID..."
                  data-testid="input-driver-id"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Load ID</label>
                <Input
                  value={loadId}
                  onChange={(e) => setLoadId(e.target.value)}
                  placeholder="Enter load ID..."
                  data-testid="input-load-id"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Document Types (comma-separated)</label>
                <Input
                  value={documentTypes}
                  onChange={(e) => setDocumentTypes(e.target.value)}
                  placeholder="e.g., pod,bol,inspection_report"
                  data-testid="input-doc-types"
                />
              </div>

              <Button 
                onClick={testDocumentRequest} 
                disabled={isLoading || !driverId}
                className="w-full"
                data-testid="button-request-docs"
              >
                <FileText className="mr-2 h-4 w-4" />
                Request Documents
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Test Results */}
      <Card>
        <CardHeader>
          <CardTitle>Test Results</CardTitle>
          <CardDescription>History of test executions</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[300px] w-full pr-4">
            <div className="space-y-2">
              {testResults.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  No tests executed yet. Run tests above to see results.
                </p>
              ) : (
                testResults.map((result, index) => (
                  <div 
                    key={index} 
                    className="flex items-start gap-3 p-3 rounded-lg bg-muted/50"
                    data-testid={`test-result-${index}`}
                  >
                    {result.status === 'success' && (
                      <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
                    )}
                    {result.status === 'error' && (
                      <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
                    )}
                    {result.status === 'pending' && (
                      <Radio className="h-5 w-5 text-blue-600 mt-0.5 animate-pulse" />
                    )}
                    <div className="flex-1">
                      <p className="font-medium text-sm">{result.test}</p>
                      <p className="text-sm text-muted-foreground">{result.message}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {result.timestamp.toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Configuration Info */}
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Zello Configuration</AlertTitle>
        <AlertDescription>
          <div className="mt-2 space-y-1 text-sm">
            <p>• Workspace: lamp1.zellowork.com</p>
            <p>• API User: annexAPI</p>
            <p>• Channels: all-drivers, southeast-region, box-truck-ops, hotshot-expedite, dispatch-priority</p>
            <p>• Webhook Endpoint: /api/zello/webhook</p>
          </div>
        </AlertDescription>
      </Alert>
    </div>
  );
}