import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { Loader2, Shield, LogIn } from "lucide-react";

export function TwoFAInput() {
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isStartingLogin, setIsStartingLogin] = useState(false);
  const [needsCode, setNeedsCode] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(false);

  const handleStartLogin = async () => {
    setIsStartingLogin(true);

    try {
      const response = await fetch('/api/dat/start-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const result = await response.json();

      if (result.status === 'needs_2fa') {
        setNeedsCode(true);
        toast({
          title: "2FA Required",
          description: "A browser window opened for DAT login. Please complete 2FA verification there, then click 'Check Authentication' below.",
          variant: "default",
        });
        
        // Start checking for authentication completion
        startAuthCheck();
      } else if (result.status === 'authenticated') {
        toast({
          title: "Login Successful",
          description: `Found ${result.loadsFound} real DAT loads`,
          variant: "default",
        });
        setTimeout(() => window.location.reload(), 1500);
      } else {
        toast({
          title: "Login Failed",
          description: result.message,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Start login error:', error);
      toast({
        title: "Error",
        description: "Failed to start login process",
        variant: "destructive",
      });
    } finally {
      setIsStartingLogin(false);
    }
  };

  const startAuthCheck = () => {
    const checkInterval = setInterval(async () => {
      try {
        const response = await fetch('/api/dat/check-auth');
        const result = await response.json();
        
        if (result.authenticated) {
          clearInterval(checkInterval);
          setNeedsCode(false);
          toast({
            title: "Authentication Successful!",
            description: `Found ${result.loadsFound} real DAT loads`,
            variant: "default",
          });
          setTimeout(() => window.location.reload(), 1500);
        }
      } catch (error) {
        console.error('Auth check error:', error);
      }
    }, 3000);
    
    // Stop checking after 10 minutes
    setTimeout(() => clearInterval(checkInterval), 600000);
  };

  const handleCheckAuth = async () => {
    setIsCheckingAuth(true);

    try {
      const response = await fetch('/api/dat/check-auth');
      const result = await response.json();

      if (result.authenticated) {
        setNeedsCode(false);
        toast({
          title: "Authentication Successful!",
          description: `Found ${result.loadsFound} real DAT loads`,
          variant: "default",
        });
        setTimeout(() => window.location.reload(), 1500);
      } else {
        toast({
          title: "Still Waiting",
          description: "Please complete 2FA verification in the browser window",
          variant: "default",
        });
      }
    } catch (error) {
      console.error('Auth check error:', error);
      toast({
        title: "Error",
        description: "Failed to check authentication status",
        variant: "destructive",
      });
    } finally {
      setIsCheckingAuth(false);
    }
  };

  const handleSubmit = async () => {
    if (!code || code.length < 4) {
      toast({
        title: "Invalid Code",
        description: "Please enter a valid 2FA code",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/dat/submit-2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });

      const result = await response.json();

      if (result.success) {
        toast({
          title: "2FA Successful",
          description: result.message,
          variant: "default",
        });
        setCode("");
        
        // Refresh the page to show new loads
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } else {
        toast({
          title: "2FA Failed",
          description: result.error,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('2FA submission error:', error);
      toast({
        title: "Error",
        description: "Failed to submit 2FA code",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!needsCode) {
    return (
      <Button
        onClick={handleStartLogin}
        disabled={isStartingLogin}
        size="sm"
        className="bg-blue-600 hover:bg-blue-700"
      >
        {isStartingLogin ? (
          <Loader2 className="h-4 w-4 animate-spin mr-1" />
        ) : (
          <LogIn className="h-4 w-4 mr-1" />
        )}
        Start DAT Login
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        onClick={handleCheckAuth}
        disabled={isCheckingAuth}
        size="sm"
        className="bg-green-600 hover:bg-green-700"
      >
        {isCheckingAuth ? (
          <Loader2 className="h-4 w-4 animate-spin mr-1" />
        ) : (
          <Shield className="mr-1 h-4 w-4" />
        )}
        Check Authentication
      </Button>
    </div>
  );
}