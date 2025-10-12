import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Copy, CheckCircle2, ExternalLink, Settings } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

export default function TwilioSettings() {
  const { toast } = useToast();
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);

  // Get app URL from environment or current location
  const appUrl = window.location.origin;
  const webhookUrl = `${appUrl}/api/sms/webhook`;
  
  // Get Twilio phone number from API
  const { data: twilioStatus } = useQuery({
    queryKey: ['/api/communication/debug'],
  });

  const copyToClipboard = async (text: string, type: 'url' | 'phone') => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'url') {
        setCopiedUrl(true);
        setTimeout(() => setCopiedUrl(false), 2000);
      } else {
        setCopiedPhone(true);
        setTimeout(() => setCopiedPhone(false), 2000);
      }
      toast({
        title: "Copied!",
        description: `${type === 'url' ? 'Webhook URL' : 'Phone number'} copied to clipboard`,
      });
    } catch (err) {
      toast({
        title: "Failed to copy",
        description: "Please copy manually",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Settings className="h-8 w-8" />
          Twilio SMS Configuration
        </h1>
        <p className="text-muted-foreground mt-2">
          Configure Twilio to receive driver SMS replies in your Communication Dashboard
        </p>
      </div>

      <div className="space-y-6">
        {/* Status Card */}
        <Card>
          <CardHeader>
            <CardTitle>Current Status</CardTitle>
            <CardDescription>Twilio SMS service configuration status</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                <span className="font-medium">SMS Service</span>
                <span className={`px-3 py-1 rounded-full text-sm ${
                  twilioStatus?.smsConfigured 
                    ? 'bg-green-100 text-green-800' 
                    : 'bg-yellow-100 text-yellow-800'
                }`}>
                  {twilioStatus?.smsConfigured ? 'Configured' : 'Needs Setup'}
                </span>
              </div>
              <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                <span className="font-medium">Communication Type</span>
                <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm">
                  {twilioStatus?.communicationType || 'SMS'}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Webhook URL Card */}
        <Card>
          <CardHeader>
            <CardTitle>Webhook URL</CardTitle>
            <CardDescription>
              Copy this URL and configure it in your Twilio console
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="flex-1 p-3 bg-muted rounded-lg font-mono text-sm break-all">
                {webhookUrl}
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyToClipboard(webhookUrl, 'url')}
                data-testid="button-copy-webhook-url"
                aria-label={copiedUrl ? "Webhook URL copied" : "Copy webhook URL"}
              >
                {copiedUrl ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            
            <Alert>
              <AlertDescription>
                <strong>Important:</strong> This webhook URL must be configured in your Twilio console 
                for driver SMS replies to appear in the Communication Dashboard.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>

        {/* Setup Instructions */}
        <Card>
          <CardHeader>
            <CardTitle>Setup Instructions</CardTitle>
            <CardDescription>Follow these steps to configure Twilio</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-4 list-decimal list-inside">
              <li className="text-sm">
                <strong>Log into Twilio Console</strong>
                <p className="ml-6 mt-1 text-muted-foreground">
                  Go to{" "}
                  <a 
                    href="https://console.twilio.com" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline inline-flex items-center gap-1"
                  >
                    console.twilio.com
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </p>
              </li>
              
              <li className="text-sm">
                <strong>Navigate to Phone Numbers</strong>
                <p className="ml-6 mt-1 text-muted-foreground">
                  Click: Phone Numbers → Manage → Active Numbers
                </p>
              </li>
              
              <li className="text-sm">
                <strong>Select Your Twilio Number</strong>
                <p className="ml-6 mt-1 text-muted-foreground">
                  Click on the phone number you're using for driver communication
                </p>
              </li>
              
              <li className="text-sm">
                <strong>Configure Messaging Webhook</strong>
                <p className="ml-6 mt-1 text-muted-foreground">
                  Scroll to "Messaging Configuration" section
                </p>
                <div className="ml-6 mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm font-medium text-blue-900 mb-2">Under "A MESSAGE COMES IN":</p>
                  <div className="space-y-1 text-sm text-blue-800">
                    <div>• Set to: <strong>Webhook</strong></div>
                    <div>• URL: <code className="bg-blue-100 px-2 py-1 rounded">{webhookUrl}</code></div>
                    <div>• HTTP Method: <strong>POST</strong></div>
                  </div>
                </div>
              </li>
              
              <li className="text-sm">
                <strong>Save Configuration</strong>
                <p className="ml-6 mt-1 text-muted-foreground">
                  Click the "Save" button at the bottom of the page
                </p>
              </li>
              
              <li className="text-sm">
                <strong>Test It</strong>
                <p className="ml-6 mt-1 text-muted-foreground">
                  Send a test SMS from a driver's phone to your Twilio number. The message should 
                  appear in your Communication Dashboard within seconds.
                </p>
              </li>
            </ol>
          </CardContent>
        </Card>

        {/* Testing Section */}
        <Card>
          <CardHeader>
            <CardTitle>Testing & Verification</CardTitle>
            <CardDescription>How to verify your setup is working</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <h4 className="font-medium text-sm">Method 1: Send Test Message</h4>
              <p className="text-sm text-muted-foreground">
                Have a driver send an SMS to your Twilio number. The message should appear in the 
                Communication Dashboard immediately.
              </p>
            </div>
            
            <div className="space-y-2">
              <h4 className="font-medium text-sm">Method 2: Check Logs</h4>
              <p className="text-sm text-muted-foreground">
                When a message is received, you'll see logs in your application console:
              </p>
              <div className="p-3 bg-muted rounded-lg font-mono text-xs">
                📱 Twilio SMS webhook received: {"{...}"}<br />
                📲 SMS from 2058614115: "Test message"<br />
                👤 Driver identified: Annex Luberisse<br />
                ✅ SMS stored in thread...
              </div>
            </div>

            <Alert>
              <AlertDescription>
                <strong>Troubleshooting:</strong> If messages aren't appearing, check that:
                <ul className="mt-2 ml-4 list-disc text-sm">
                  <li>The webhook URL in Twilio exactly matches the one above</li>
                  <li>HTTP method is set to POST (not GET)</li>
                  <li>The driver's phone number is registered in your system</li>
                  <li>Your application is running and accessible</li>
                </ul>
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
