import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, AlertCircle, CheckCircle, ExternalLink } from 'lucide-react';

export default function ZelloTest() {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<any>(null);

  const testAuthentication = async () => {
    setTesting(true);
    setResult(null);
    
    try {
      const response = await fetch('/api/zello/test-auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      const data = await response.json();
      setResult(data);
    } catch (error: any) {
      setResult({
        success: false,
        error: error.message,
        message: 'Failed to connect to server'
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Zello Work Authentication Test</CardTitle>
          <CardDescription>
            Test the Zello Work API authentication for your workspace
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="font-semibold text-blue-900 mb-2">Current Configuration:</h3>
            <ul className="space-y-1 text-sm text-blue-800">
              <li>• Workspace: lamp1.zellowork.com</li>
              <li>• API User: annexAPI</li>
              <li>• API Key: 9TRA0D2GBV1OCOC657BFSPIH4QBDICH5</li>
            </ul>
          </div>

          <Button 
            onClick={testAuthentication}
            disabled={testing}
            className="w-full"
            data-testid="button-test-auth"
          >
            {testing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Testing Authentication...
              </>
            ) : (
              'Test Zello Authentication'
            )}
          </Button>

          {result && (
            <Alert variant={result.success ? "default" : "destructive"}>
              {result.success ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              <AlertTitle>{result.success ? 'Success!' : 'Authentication Failed'}</AlertTitle>
              <AlertDescription>
                {result.message}
                
                {result.captchaRequired && (
                  <div className="mt-4 space-y-3">
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                      <p className="font-semibold text-yellow-900 mb-2">
                        CAPTCHA Required - {result.failedAttempts} failed attempts
                      </p>
                      <p className="text-sm text-yellow-800 mb-3">
                        Too many failed login attempts have triggered CAPTCHA protection. 
                        You need to manually clear this by logging into the Zello Work console.
                      </p>
                    </div>
                    
                    {result.instructions && (
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="font-semibold text-gray-900 mb-2">Steps to Fix:</p>
                        <ol className="space-y-2 text-sm text-gray-700">
                          {result.instructions.map((instruction: string, idx: number) => (
                            <li key={idx} className="flex items-start">
                              {instruction}
                              {idx === 0 && (
                                <a 
                                  href="https://lamp1.zellowork.com" 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="ml-2 text-blue-600 hover:text-blue-800 inline-flex items-center"
                                  data-testid="link-zello-console"
                                >
                                  <ExternalLink className="h-3 w-3 ml-1" />
                                </a>
                              )}
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                    
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <p className="text-sm text-blue-800">
                        <strong>Note:</strong> After clearing the CAPTCHA, wait a minute before testing again 
                        to ensure the system has reset the lockout.
                      </p>
                    </div>
                  </div>
                )}
                
                {result.error && !result.captchaRequired && (
                  <div className="mt-3">
                    <details className="text-sm">
                      <summary className="cursor-pointer font-semibold">Error Details</summary>
                      <pre className="mt-2 bg-gray-100 p-2 rounded text-xs overflow-auto">
                        {JSON.stringify(result.error, null, 2)}
                      </pre>
                    </details>
                  </div>
                )}
                
                {result.loginData && (
                  <div className="mt-3">
                    <details className="text-sm">
                      <summary className="cursor-pointer font-semibold text-green-700">
                        Authentication Details
                      </summary>
                      <pre className="mt-2 bg-green-50 p-2 rounded text-xs overflow-auto text-green-800">
                        {JSON.stringify(result.loginData, null, 2)}
                      </pre>
                    </details>
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}

          <div className="text-sm text-gray-500 space-y-2">
            <p>
              This test verifies that your Zello Work API credentials are properly configured 
              and can authenticate with the lamp1 workspace.
            </p>
            <p>
              If authentication fails due to incorrect credentials, you'll need to verify 
              the API user settings in your Zello Work admin console.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}