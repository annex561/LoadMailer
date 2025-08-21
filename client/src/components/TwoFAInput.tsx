import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { Loader2, Shield } from "lucide-react";

export function TwoFAInput() {
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  return (
    <div className="flex items-center gap-2">
      <Input
        type="text"
        placeholder="2FA Code"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        className="w-32"
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
            Submit
          </>
        )}
      </Button>
    </div>
  );
}