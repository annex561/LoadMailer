import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Bot, 
  Play, 
  Square, 
  Settings,
  Clock,
  Truck,
  MessageSquare,
  Phone,
  AlertTriangle,
  CheckCircle,
  Loader2
} from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

export default function LoadMailerControl() {
  const [scrapingStatus, setScrapingStatus] = useState<'idle' | 'running' | 'waiting_2fa'>('idle');
  const [lastScrapingTime, setLastScrapingTime] = useState<string | null>(null);
  const { toast } = useToast();

  // Initialize LoadMailer service
  const initServiceMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('/api/loadmailer-dat/init', 'POST', {});
    },
    onSuccess: () => {
      toast({
        title: "LoadMailer Service Initialized",
        description: "Auto-scraping enabled (8 AM - 6 PM). Browser will open for DAT login.",
      });
      setScrapingStatus('running');
    },
    onError: (error: any) => {
      toast({
        title: "Initialization Failed",
        description: error.message || "Failed to initialize LoadMailer service",
        variant: "destructive",
      });
    }
  });

  // Start manual scraping session
  const startScrapingMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('/api/loadmailer-dat/start', 'POST', {});
    },
    onSuccess: () => {
      toast({
        title: "DAT Scraping Started",
        description: "Browser opened for DAT login. Please complete 2FA verification.",
      });
      setScrapingStatus('waiting_2fa');
      setLastScrapingTime(new Date().toLocaleTimeString());
    },
    onError: (error: any) => {
      toast({
        title: "Scraping Failed",
        description: error.message || "Failed to start DAT scraping",
        variant: "destructive",
      });
    }
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'running':
        return <Badge className="bg-green-100 text-green-800">Active</Badge>;
      case 'waiting_2fa':
        return <Badge className="bg-yellow-100 text-yellow-800">Waiting for 2FA</Badge>;
      default:
        return <Badge variant="outline">Idle</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center">
              <Bot className="w-8 h-8 mr-3 text-blue-600" />
              LoadMailer Bot Control Panel
            </h1>
            <p className="text-gray-600 mt-1">
              Manage DAT scraping with Puppeteer automation and Telegram notifications
            </p>
          </div>
          {getStatusBadge(scrapingStatus)}
        </div>

        {/* Key Features Alert */}
        <Alert className="mb-6 border-blue-200 bg-blue-50">
          <Bot className="h-4 w-4" />
          <AlertDescription className="text-blue-800">
            <strong>LoadMailer Bot Features:</strong> Real DAT scraping with 2FA support, 30-second staggered messaging to drivers, 
            /bookload and /decline commands, automatic dispatcher notifications, and 8 AM - 6 PM active hours.
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Control Panel */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Settings className="w-5 h-5 mr-2" />
                DAT Scraping Controls
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Button
                  onClick={() => initServiceMutation.mutate()}
                  disabled={initServiceMutation.isPending || scrapingStatus === 'running'}
                  className="flex items-center"
                >
                  {initServiceMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 mr-2" />
                  )}
                  Initialize Service
                </Button>

                <Button
                  variant="outline"
                  onClick={() => startScrapingMutation.mutate()}
                  disabled={startScrapingMutation.isPending}
                  className="flex items-center"
                >
                  {startScrapingMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Truck className="w-4 h-4 mr-2" />
                  )}
                  Manual Scrape
                </Button>
              </div>

              <Separator />

              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-700">Service Status</span>
                  {getStatusBadge(scrapingStatus)}
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-700">Active Hours</span>
                  <span className="text-sm text-gray-600">8:00 AM - 6:00 PM</span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-700">Scraping Interval</span>
                  <span className="text-sm text-gray-600">Every 5 minutes</span>
                </div>

                {lastScrapingTime && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-700">Last Session</span>
                    <span className="text-sm text-gray-600">{lastScrapingTime}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Telegram Features */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <MessageSquare className="w-5 h-5 mr-2" />
                Enhanced Telegram Features
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center p-3 bg-green-50 rounded-lg">
                  <CheckCircle className="w-5 h-5 text-green-600 mr-3" />
                  <div>
                    <p className="font-medium text-green-800">Enhanced Commands</p>
                    <p className="text-sm text-green-600">Added /bookload and /decline commands</p>
                  </div>
                </div>

                <div className="flex items-center p-3 bg-blue-50 rounded-lg">
                  <Clock className="w-5 h-5 text-blue-600 mr-3" />
                  <div>
                    <p className="font-medium text-blue-800">Staggered Messaging</p>
                    <p className="text-sm text-blue-600">30-second delays between drivers</p>
                  </div>
                </div>

                <div className="flex items-center p-3 bg-purple-50 rounded-lg">
                  <Phone className="w-5 h-5 text-purple-600 mr-3" />
                  <div>
                    <p className="font-medium text-purple-800">Dispatcher Alerts</p>
                    <p className="text-sm text-purple-600">Auto-notification on bookings</p>
                  </div>
                </div>

                <div className="flex items-center p-3 bg-orange-50 rounded-lg">
                  <AlertTriangle className="w-5 h-5 text-orange-600 mr-3" />
                  <div>
                    <p className="font-medium text-orange-800">Response Timeout</p>
                    <p className="text-sm text-orange-600">3-minute driver response window</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* DAT Configuration */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>DAT Login Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <h4 className="font-medium text-gray-900">Credentials</h4>
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600">
                      <strong>Email:</strong> dispatch@lampslogistics.com<br />
                      <strong>Password:</strong> ••••••••••••
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="font-medium text-gray-900">Scraping Targets</h4>
                  <div className="space-y-2">
                    <Badge variant="outline">Box Trucks</Badge>
                    <Badge variant="outline">Sprinter Vans</Badge>
                    <Badge variant="outline">Dry Vans</Badge>
                  </div>
                </div>
              </div>

              <Separator className="my-4" />

              <div className="space-y-3">
                <h4 className="font-medium text-gray-900">2FA Authentication Process</h4>
                <ol className="text-sm text-gray-600 space-y-1">
                  <li>1. Browser window opens automatically</li>
                  <li>2. Credentials are entered automatically</li>
                  <li>3. System waits for manual 2FA code entry</li>
                  <li>4. Scraping begins after successful authentication</li>
                  <li>5. Loads are sent to drivers with 30-second stagger</li>
                </ol>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Instructions */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Getting Started</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="prose max-w-none text-sm text-gray-600">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">For Automatic Operation:</h4>
                  <ol className="space-y-1">
                    <li>1. Click "Initialize Service" to start auto-scraping</li>
                    <li>2. Complete 2FA authentication in the browser</li>
                    <li>3. System runs automatically during business hours</li>
                    <li>4. Loads are sent to drivers every 5 minutes</li>
                  </ol>
                </div>
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">For Manual Testing:</h4>
                  <ol className="space-y-1">
                    <li>1. Click "Manual Scrape" for one-time session</li>
                    <li>2. Enter 2FA code when prompted</li>
                    <li>3. Check driver Telegram messages</li>
                    <li>4. Test /bookload and /decline commands</li>
                  </ol>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}