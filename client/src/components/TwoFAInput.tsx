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
          description: "DAT has sent a verification code to your device. Please enter it below.",
          variant: "default",
        });
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
      <Input
        type="text"
        placeholder="Enter 2FA Code"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        className="w-36"
        maxLength={6}
        disabled={isSubmitting}
      />
      <Button
        onClick={handleSubmit}
        disabled={!code || isSubmitting}
        size="sm"
        className="bg-green-600 hover:bg-green-700"
      >
        {isSubmitting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <Shield className="mr-1 h-4 w-4" />
            Verify
          </>
        )}
      </Button>
    </div>
  );
}