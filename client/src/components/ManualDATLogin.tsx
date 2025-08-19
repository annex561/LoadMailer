import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, Clock, Play, RotateCcw, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface LoginStep {
  step: number;
  description: string;
  action: string;
  instructions?: string;
  completed: boolean;
}

interface LoginStatus {
  success: boolean;
  currentStep: LoginStep;
  allSteps: LoginStep[];
  isComplete: boolean;
  screenshot?: string;
  error?: string;
}

export function ManualDATLogin() {
  const [loginStatus, setLoginStatus] = useState<LoginStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      const response = await fetch('/api/dat/manual-login/status');
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setLoginStatus(data);
        }
      }
    } catch (err) {
      // Status not available yet - not an error
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const startManualLogin = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/dat/manual-login/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const data = await response.json();
      
      if (data.success) {
        setLoginStatus(data);
      } else {
        setError(data.error || 'Failed to start manual login');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setIsLoading(false);
    }
  };

  const nextStep = async () => {
    setIsLoading(true);
    
    try {
      const response = await fetch('/api/dat/manual-login/next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const data = await response.json();
      
      if (data.success) {
        setLoginStatus(data);
      } else {
        setError(data.error || 'Failed to advance to next step');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setIsLoading(false);
    }
  };

  const cleanup = async () => {
    try {
      await fetch('/api/dat/manual-login/cleanup', { method: 'POST' });
      setLoginStatus(null);
      setError(null);
    } catch (err) {
      console.error('Error cleaning up:', err);
    }
  };

  const getStepIcon = (step: LoginStep, isCurrent: boolean) => {
    if (step.completed) {
      return <CheckCircle className="h-5 w-5 text-green-600" />;
    } else if (isCurrent) {
      return <Clock className="h-5 w-5 text-blue-600" />;
    } else {
      return <div className="h-5 w-5 rounded-full border-2 border-gray-300" />;
    }
  };

  const getStepStatus = (step: LoginStep, isCurrent: boolean) => {
    if (step.completed) {
      return <Badge variant="default" className="bg-green-100 text-green-800">Completed</Badge>;
    } else if (isCurrent) {
      return <Badge variant="default" className="bg-blue-100 text-blue-800">Current</Badge>;
    } else {
      return <Badge variant="secondary">Pending</Badge>;
    }
  };

  return (
    <Card className="w-full max-w-4xl mx-auto">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Manual DAT Login Process</CardTitle>
            <CardDescription>
              Step-by-step guided login to DAT LoadLink with manual verification
            </CardDescription>
          </div>
          {loginStatus && (
            <Button 
              onClick={cleanup} 
              variant="outline" 
              size="sm"
              data-testid="button-cleanup-login"
            >
              <X className="h-4 w-4 mr-2" />
              Close
            </Button>
          )}
        </div>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {error && (
          <Alert variant="destructive" data-testid="alert-error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!loginStatus ? (
          <div className="text-center py-8">
            <Button 
              onClick={startManualLogin} 
              disabled={isLoading}
              size="lg"
              data-testid="button-start-manual-login"
            >
              <Play className="h-5 w-5 mr-2" />
              {isLoading ? 'Starting...' : 'Start Manual DAT Login'}
            </Button>
            <p className="text-sm text-gray-600 mt-2">
              This will open a browser window where you can manually complete the login process
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Progress Overview */}
            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="font-medium mb-3">Login Progress</h3>
              <div className="space-y-3">
                {loginStatus.allSteps.map((step, index) => {
                  const isCurrent = index === loginStatus.allSteps.findIndex(s => !s.completed);
                  return (
                    <div key={step.step} className="flex items-center gap-3">
                      {getStepIcon(step, isCurrent)}
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`font-medium ${isCurrent ? 'text-blue-600' : step.completed ? 'text-green-600' : 'text-gray-500'}`}>
                            Step {step.step}: {step.description}
                          </span>
                          {getStepStatus(step, isCurrent)}
                        </div>
                        {step.instructions && (isCurrent || step.action === 'wait_for_user') && (
                          <p className="text-sm text-gray-600 mt-1">{step.instructions}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Current Step Actions */}
            {!loginStatus.isComplete && (
              <div className="flex items-center gap-3">
                {loginStatus.currentStep.action === 'wait_for_user' || 
                 loginStatus.currentStep.action === 'wait_for_verification' ? (
                  <Button 
                    onClick={nextStep} 
                    disabled={isLoading}
                    data-testid="button-continue-next-step"
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    {isLoading ? 'Processing...' : 'I\'ve Completed This Step'}
                  </Button>
                ) : (
                  <Button 
                    onClick={nextStep} 
                    disabled={isLoading}
                    data-testid="button-next-step"
                  >
                    <Play className="h-4 w-4 mr-2" />
                    {isLoading ? 'Processing...' : 'Continue'}
                  </Button>
                )}
                
                <Button 
                  onClick={() => fetchStatus()} 
                  variant="outline"
                  data-testid="button-refresh-status"
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Refresh Status
                </Button>
              </div>
            )}

            {/* Screenshot Display */}
            {loginStatus.screenshot && (
              <div className="border rounded-lg p-4">
                <h4 className="font-medium mb-2">Current Browser View:</h4>
                <img 
                  src={loginStatus.screenshot} 
                  alt="Browser screenshot"
                  className="w-full border rounded"
                  data-testid="img-browser-screenshot"
                />
              </div>
            )}

            {/* Completion Message */}
            {loginStatus.isComplete && (
              <Alert className="bg-green-50 border-green-200" data-testid="alert-login-complete">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-800">
                  DAT login process completed successfully! You can now access DAT LoadLink data.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}