import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';

interface VerificationStatus {
  isWaitingForVerification: boolean;
  status: string;
}

export function DATVerificationDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const checkVerificationStatus = async () => {
      try {
        const response = await fetch('/api/dat/verification-status', {
          credentials: 'include',
          headers: {
            'Accept': 'application/json',
          },
        });
        if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
          const status: VerificationStatus = await response.json();
          setIsOpen(status.isWaitingForVerification);
        }
      } catch (error) {
        console.log('DAT verification status check skipped - not critical for operations');
        // Silently handle verification status errors - this is not critical
        // Load processing works independently of this dialog
      }
    };

    // Check immediately and then every 5 seconds
    checkVerificationStatus();
    const interval = setInterval(checkVerificationStatus, 5000);

    return () => clearInterval(interval);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!verificationCode.trim()) {
      toast({
        title: "Error",
        description: "Please enter the verification code",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/dat/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          verificationCode: verificationCode.trim(),
        }),
      });

      const result = await response.json();

      if (response.ok) {
        toast({
          title: "Success",
          description: result.message || "Verification code submitted successfully",
        });
        setIsOpen(false);
        setVerificationCode('');
      } else {
        throw new Error(result.error || 'Failed to submit verification code');
      }
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to submit verification code",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>DAT LoadLink Verification Required</DialogTitle>
          <DialogDescription>
            DAT has sent a verification code. Please check your email or phone and enter the code below to continue the login process.
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="verification-code">Verification Code</Label>
            <Input
              id="verification-code"
              type="text"
              placeholder="Enter verification code"
              value={verificationCode}
              onChange={(e) => setVerificationCode(e.target.value)}
              disabled={isSubmitting}
              data-testid="input-verification-code"
            />
          </div>
          
          <div className="flex justify-end space-x-2">
            <Button 
              type="submit" 
              disabled={isSubmitting || !verificationCode.trim()}
              data-testid="button-submit-verification"
            >
              {isSubmitting ? 'Submitting...' : 'Submit Code'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}