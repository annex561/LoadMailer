import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle, AlertCircle, Clock, Globe, Lock, Eye, EyeOff } from "lucide-react";

interface DATLoginStep {
  step: number;
  description: string;
  action: string;
  url?: string;
  instructions?: string;
  completed: boolean;
}

interface DATLoginStatus {
  success: boolean;
  currentStep: DATLoginStep;
  allSteps: DATLoginStep[];
  isComplete: boolean;
  screenshot?: string;
  error?: string;
}

export default function DATLogin() {
  const [status, setStatus] = useState<DATLoginStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [userInput, setUserInput] = useState("");

  // Poll for status updates
  useEffect(() => {
    const pollStatus = async () => {
      try {
        const response = await fetch('/api/dat/manual-login/status');
        const data = await response.json();
        setStatus(data);
      } catch (error) {
        console.error('Error polling DAT login status:', error);
      }
    };

    const interval = setInterval(pollStatus, 2000);
    pollStatus();

    return () => clearInterval(interval);
  }, []);

  const startLogin = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/dat/manual-login/start', {
        method: 'POST'
      });
      const data = await response.json();
      setStatus(data);
    } catch (error) {
      console.error('Error starting DAT login:', error);
    } finally {
      setLoading(false);
    }
  };

  const proceedToNextStep = async () => {
    setLoading(true);
    try {
      const payload: any = {};
      
      if (getCurrentInputType() === 'password') {
        payload.password = password;
      } else if (getCurrentInputType() === 'verification') {
        payload.verificationCode = verificationCode;
      } else if (getCurrentInputType() === 'user_input') {
        payload.userInput = userInput;
      }

      const response = await fetch('/api/dat/manual-login/next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      setStatus(data);

      // Clear input fields after successful submission
      setPassword("");
      setVerificationCode("");
      setUserInput("");
    } catch (error) {
      console.error('Error proceeding to next step:', error);
    } finally {
      setLoading(false);
    }
  };

  const resetLogin = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/dat/manual-login/reset', {
        method: 'POST'
      });
      const data = await response.json();
      setStatus(data);
      setPassword("");
      setVerificationCode("");
      setUserInput("");
    } catch (error) {
      console.error('Error resetting DAT login:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStepIcon = (step: DATLoginStep) => {
    if (step.completed) {
      return <CheckCircle className="w-6 h-6 text-green-600" />;
    } else if (status?.currentStep?.step === step.step) {
      return <Clock className="w-6 h-6 text-blue-600 animate-pulse" />;
    } else {
      return <AlertCircle className="w-6 h-6 text-gray-400" />;
    }
  };

  const getStepStatus = (step: DATLoginStep) => {
    if (step.completed) {
      return <Badge variant="default" className="bg-green-100 text-green-800">Completed</Badge>;
    } else if (status?.currentStep?.step === step.step) {
      return <Badge variant="default" className="bg-blue-100 text-blue-800">In Progress</Badge>;
    } else {
      return <Badge variant="outline" className="text-gray-500">Pending</Badge>;
    }
  };

  const isWaitingForInput = () => {
    return status?.currentStep?.action === 'wait_for_user' && !status.isComplete;
  };

  const getCurrentInputType = () => {
    if (!status?.currentStep?.instructions) return 'user_input';
    
    const instructions = status.currentStep.instructions.toLowerCase();
    if (instructions.includes('password')) return 'password';
    if (instructions.includes('verification') || instructions.includes('2fa') || instructions.includes('code')) return 'verification';
    return 'user_input';
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <Card className="max-w-4xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <Globe className="w-8 h-8 text-blue-600" />
            DAT LoadLink Manual Login
          </CardTitle>
          <CardDescription>
            Complete guided login process for DAT LoadLink integration using dispatch@lampslogistics.com credentials
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!status && (
            <div className="text-center py-8 space-y-4">
              <Button 
                onClick={startLogin} 
                disabled={loading}
                size="lg"
                className="w-full max-w-md"
              >
                {loading ? "Starting Login Process..." : "Start DAT Login Process"}
              </Button>
              
              <div className="text-center">
                <p className="text-sm text-gray-600 mb-3">Already logged into DAT manually?</p>
                <Button 
                  onClick={async () => {
                    setLoading(true);
                    try {
                      // Try session-based first
                      const sessionResponse = await fetch('/api/session-dat/start', { method: 'POST' });
                      const sessionData = await sessionResponse.json();
                      
                      if (sessionData.success) {
                        alert('Session-based DAT scraping started! Real loads will appear in the dashboard.');
                        window.location.href = '/dashboard';
                      } else {
                        // Fallback to simple DAT connector
                        const simpleResponse = await fetch('/api/simple-dat/start', { method: 'POST' });
                        const simpleData = await simpleResponse.json();
                        
                        if (simpleData.success) {
                          alert('Started Tennessee freight data feed! Real loads will appear shortly.');
                          window.location.href = '/dashboard';
                        } else {
                          alert('Unable to start DAT connection. Please try the manual login process.');
                        }
                      }
                    } catch (error) {
                      alert('Error starting DAT connection');
                    } finally {
                      setLoading(false);
                    }
                  }}
                  disabled={loading}
                  variant="outline"
                  size="lg"
                  className="w-full max-w-md"
                >
                  {loading ? "Starting DAT Connection..." : "Start Real Load Feed"}
                </Button>
              </div>
            </div>
          )}

          {status && (
            <div className="space-y-6">
              {/* Current Status */}
              <Alert className={status.success ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}>
                <AlertCircle className={`w-4 h-4 ${status.success ? "text-green-600" : "text-red-600"}`} />
                <AlertDescription className={status.success ? "text-green-700" : "text-red-700"}>
                  {status.isComplete ? (
                    "✅ DAT login completed successfully! You can now scrape loads from DAT LoadLink."
                  ) : status.error ? (
                    `❌ Error: ${status.error}`
                  ) : (
                    `🔄 ${status.currentStep?.description || 'Processing...'}`
                  )}
                </AlertDescription>
              </Alert>

              {/* Progress Steps */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Login Progress</h3>
                {status.allSteps?.map((step) => (
                  <div key={step.step} className="flex items-center gap-4 p-4 rounded-lg border bg-card">
                    <div className="flex-shrink-0">
                      {getStepIcon(step)}
                    </div>
                    <div className="flex-grow">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium">
                          Step {step.step}: {step.description}
                        </h4>
                        {getStepStatus(step)}
                      </div>
                      {step.instructions && (
                        <p className="text-sm text-muted-foreground mt-1">
                          {step.instructions}
                        </p>
                      )}
                      {step.url && (
                        <p className="text-sm text-blue-600 mt-1 truncate">
                          {step.url}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* User Input Section */}
              {isWaitingForInput() && !status.isComplete && (
                <Card className="border-orange-200 bg-orange-50">
                  <CardHeader>
                    <CardTitle className="text-orange-800 flex items-center gap-2">
                      <Lock className="w-5 h-5" />
                      Action Required
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {getCurrentInputType() === 'password' && (
                      <div className="space-y-2">
                        <Label htmlFor="password">DAT Password</Label>
                        <div className="relative">
                          <Input
                            id="password"
                            type={showPassword ? "text" : "password"}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter your DAT password"
                            className="pr-10"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                            onClick={() => setShowPassword(!showPassword)}
                          >
                            {showPassword ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                    )}

                    {getCurrentInputType() === 'verification' && (
                      <div className="space-y-2">
                        <Label htmlFor="verification">Verification Code</Label>
                        <Input
                          id="verification"
                          value={verificationCode}
                          onChange={(e) => setVerificationCode(e.target.value)}
                          placeholder="Enter verification code from SMS/email"
                        />
                      </div>
                    )}

                    {getCurrentInputType() === 'user_input' && (
                      <div className="space-y-2">
                        <Label htmlFor="userInput">Additional Information</Label>
                        <Textarea
                          id="userInput"
                          value={userInput}
                          onChange={(e) => setUserInput(e.target.value)}
                          placeholder="Please provide any additional information as requested"
                          rows={3}
                        />
                      </div>
                    )}

                    <div className="flex gap-3">
                      <Button 
                        onClick={proceedToNextStep} 
                        disabled={loading}
                        className="flex-1"
                      >
                        {loading ? "Processing..." : "Continue"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Screenshot */}
              {status.screenshot && (
                <Card>
                  <CardHeader>
                    <CardTitle>Current Browser View</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <img 
                      src={`data:image/png;base64,${status.screenshot}`} 
                      alt="Browser screenshot"
                      className="w-full border rounded-lg shadow-sm"
                    />
                  </CardContent>
                </Card>
              )}

              {/* Action Buttons */}
              {status && !status.isComplete && (
                <div className="flex gap-3 pt-4">
                  <Button 
                    variant="outline" 
                    onClick={resetLogin} 
                    disabled={loading}
                  >
                    Reset Login
                  </Button>
                </div>
              )}

              {/* Success Actions */}
              {status.isComplete && (
                <Card className="border-green-200 bg-green-50">
                  <CardHeader>
                    <CardTitle className="text-green-800">
                      ✅ Login Successful!
                    </CardTitle>
                    <CardDescription className="text-green-700">
                      DAT LoadLink integration is now active. The system can now scrape real loads from the DAT load board.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex gap-3">
                      <Button asChild>
                        <a href="/dat-loads">View DAT Loads</a>
                      </Button>
                      <Button variant="outline" onClick={resetLogin}>
                        Start New Login Session
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}