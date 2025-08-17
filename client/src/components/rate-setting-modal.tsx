import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Load } from "@shared/schema";

interface RateSettingModalProps {
  isOpen: boolean;
  onClose: () => void;
  load: Load | null;
  driverId: string;
  driverName: string;
  originalRate: number;
}

export function RateSettingModal({ 
  isOpen, 
  onClose, 
  load, 
  driverId, 
  driverName, 
  originalRate 
}: RateSettingModalProps) {
  const [dispatcherRate, setDispatcherRate] = useState(Math.round(originalRate * 0.9));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!load) return;

    setIsSubmitting(true);
    try {
      const result = await apiRequest('POST', `/api/loads/${load.id}/set-dispatcher-rate`, {
        driverId,
        dispatcherRate
      });

      toast({
        title: "Rate Set Successfully",
        description: `Rate of $${dispatcherRate} sent to ${driverName} for confirmation`,
      });

      onClose();
    } catch (error) {
      console.error('Error setting rate:', error);
      toast({
        title: "Error",
        description: "Failed to set rate. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!load) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px] bg-white border border-gray-300 shadow-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">Set Driver Rate</DialogTitle>
          <DialogDescription className="text-gray-600">
            Set the rate for {driverName} and send load details for confirmation
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            <div className="p-4 bg-gray-50 rounded-lg border">
              <h3 className="font-medium text-gray-900 mb-2">Load Information</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-600">Load Number:</span>
                  <p className="font-medium">{load.loadNumber}</p>
                </div>
                <div>
                  <span className="text-gray-600">Equipment:</span>
                  <p className="font-medium">{load.equipmentType}</p>
                </div>
                <div className="col-span-2">
                  <span className="text-gray-600">Route:</span>
                  <p className="font-medium">{load.pickupAddress} → {load.deliveryAddress}</p>
                </div>
                <div>
                  <span className="text-gray-600">Board Rate:</span>
                  <p className="font-medium text-green-600">${originalRate}</p>
                </div>
                <div>
                  <span className="text-gray-600">Distance:</span>
                  <p className="font-medium">{load.miles || 'TBD'} miles</p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dispatcherRate" className="text-sm font-medium">
                Driver Rate ($)
              </Label>
              <Input
                id="dispatcherRate"
                type="text"
                value={dispatcherRate}
                onChange={(e) => {
                  const value = e.target.value.replace(/[^0-9]/g, '');
                  setDispatcherRate(Number(value) || 0);
                }}
                placeholder="Enter amount"
                required
                className="bg-white border border-gray-300"
                data-testid="input-dispatcher-rate"
              />
              <p className="text-xs text-gray-500">
                Default: 90% of board rate (${Math.round(originalRate * 0.9)})
              </p>
            </div>

            <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
              <h4 className="font-medium text-blue-900 mb-2">What happens next?</h4>
              <ol className="text-sm text-blue-800 space-y-1">
                <li>1. Driver receives detailed load information with your rate</li>
                <li>2. Driver can confirm or decline the load</li>
                <li>3. Upon confirmation, load is automatically assigned</li>
                <li>4. Driver status updates to "on route"</li>
              </ol>
            </div>
          </div>

          <DialogFooter className="flex gap-3">
            <Button 
              type="button" 
              variant="outline" 
              onClick={onClose}
              disabled={isSubmitting}
              className="bg-white border border-gray-300"
              data-testid="button-cancel-rate"
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={isSubmitting}
              className="bg-blue-600 hover:bg-blue-700"
              data-testid="button-send-rate"
            >
              {isSubmitting ? "Sending..." : "Send Rate to Driver"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}