import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { 
  DollarSign, CheckCircle, Clock, AlertTriangle, Download, 
  FileText, Camera, Upload, CreditCard, Star 
} from 'lucide-react';

interface Payment {
  id: string;
  loadId: string;
  driverId: string;
  amount: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  processedAt?: string;
  notes?: string;
  documents: string[];
  load?: any;
  driver?: any;
}

interface LoadDocument {
  id: string;
  loadId: string;
  type: 'bill_of_lading' | 'delivery_receipt' | 'proof_of_delivery' | 'invoice';
  fileName: string;
  uploadedAt: string;
  url: string;
}

export default function PaymentWorkflow() {
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [notes, setNotes] = useState('');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch pending payments
  const { data: payments = [] } = useQuery({
    queryKey: ['/api/payments'],
    queryFn: async () => {
      const response = await fetch('/api/payments?status=pending,processing');
      if (!response.ok) throw new Error('Failed to fetch payments');
      return response.json();
    },
    refetchInterval: 30000 // Refresh every 30 seconds
  });

  // Fetch completed deliveries awaiting payment
  const { data: completedLoads = [] } = useQuery({
    queryKey: ['/api/loads/completed'],
    queryFn: async () => {
      const response = await fetch('/api/loads?status=delivered&paymentStatus=pending');
      if (!response.ok) throw new Error('Failed to fetch completed loads');
      return response.json();
    },
    refetchInterval: 15000 // Refresh every 15 seconds
  });

  // Process payment
  const processPaymentMutation = useMutation({
    mutationFn: async ({ paymentId, amount, notes }: { 
      paymentId: string; 
      amount: number; 
      notes?: string; 
    }) => {
      const response = await fetch(`/api/payments/${paymentId}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, notes })
      });
      if (!response.ok) throw new Error('Failed to process payment');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/payments'] });
      queryClient.invalidateQueries({ queryKey: ['/api/loads/completed'] });
      toast({
        title: 'Payment Processed',
        description: 'Payment has been successfully processed and sent to the driver.'
      });
      setSelectedPayment(null);
      setNotes('');
    }
  });

  // Generate payment for completed load
  const generatePaymentMutation = useMutation({
    mutationFn: async (loadId: string) => {
      const response = await fetch(`/api/loads/${loadId}/generate-payment`, {
        method: 'POST'
      });
      if (!response.ok) throw new Error('Failed to generate payment');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/payments'] });
      queryClient.invalidateQueries({ queryKey: ['/api/loads/completed'] });
      toast({
        title: 'Payment Generated',
        description: 'Payment has been generated and is ready for processing.'
      });
    }
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-500';
      case 'processing': return 'bg-blue-500';
      case 'completed': return 'bg-green-500';
      case 'failed': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getDriverRate = (fullRate: number) => {
    return fullRate * 0.9; // Drivers get 90% of load board rate
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold">Payment Processing</h1>
          <p className="text-muted-foreground">
            Process payments for completed loads and manage driver earnings
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Completed Loads Awaiting Payment */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              Completed Loads ({completedLoads.length})
            </CardTitle>
            <CardDescription>
              Delivered loads ready for payment processing
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {completedLoads.length > 0 ? (
                completedLoads.map((load: any) => (
                  <div key={load.id} className="border rounded-lg p-4 space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-semibold">{load.loadNumber}</h4>
                        <p className="text-sm text-muted-foreground">
                          Driver: {load.driver?.name || 'Unknown'}
                        </p>
                      </div>
                      <Badge className="bg-green-500 text-white">
                        Delivered
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <div className="text-muted-foreground">From</div>
                        <div className="font-medium">{load.pickupAddress}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">To</div>
                        <div className="font-medium">{load.deliveryAddress}</div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                      <div>
                        <div className="text-sm text-muted-foreground">Driver Payment</div>
                        <div className="font-bold text-lg text-green-600">
                          {formatCurrency(getDriverRate(load.rate || 0))}
                        </div>
                      </div>
                      <div className="text-sm text-right">
                        <div className="text-muted-foreground">Delivered</div>
                        <div className="font-medium">
                          {load.actualDeliveryDate ? formatDate(load.actualDeliveryDate) : 'Recently'}
                        </div>
                      </div>
                    </div>

                    <Button
                      onClick={() => generatePaymentMutation.mutate(load.id)}
                      disabled={generatePaymentMutation.isPending}
                      className="w-full"
                      data-testid={`button-generate-payment-${load.id}`}
                    >
                      <DollarSign className="h-4 w-4 mr-2" />
                      Generate Payment
                    </Button>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No completed loads awaiting payment</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Pending Payments */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-yellow-500" />
              Pending Payments ({payments.length})
            </CardTitle>
            <CardDescription>
              Payments ready for processing and approval
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {payments.length > 0 ? (
                payments.map((payment: Payment) => (
                  <div key={payment.id} className="border rounded-lg p-4 space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-semibold">{payment.load?.loadNumber}</h4>
                        <p className="text-sm text-muted-foreground">
                          Driver: {payment.driver?.name || 'Unknown'}
                        </p>
                      </div>
                      <Badge className={`${getStatusColor(payment.status)} text-white`}>
                        {payment.status}
                      </Badge>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                      <div>
                        <div className="text-sm text-muted-foreground">Payment Amount</div>
                        <div className="font-bold text-lg text-blue-600">
                          {formatCurrency(payment.amount)}
                        </div>
                      </div>
                      <div className="text-sm text-right">
                        <div className="text-muted-foreground">Created</div>
                        <div className="font-medium">
                          {formatDate(payment.load?.actualDeliveryDate || new Date().toISOString())}
                        </div>
                      </div>
                    </div>

                    {payment.documents && payment.documents.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-sm font-medium">Documents</div>
                        <div className="flex flex-wrap gap-2">
                          {payment.documents.map((doc, index) => (
                            <Badge key={index} variant="outline" className="text-xs">
                              <FileText className="h-3 w-3 mr-1" />
                              Document {index + 1}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Button
                        onClick={() => setSelectedPayment(payment)}
                        variant="outline"
                        className="flex-1"
                        data-testid={`button-review-payment-${payment.id}`}
                      >
                        Review & Process
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No pending payments</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Payment Review Modal */}
      {selectedPayment && (
        <Card className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <CardHeader>
              <CardTitle>Process Payment</CardTitle>
              <CardDescription>
                Review and approve payment for {selectedPayment.load?.loadNumber}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Driver</Label>
                  <div className="font-medium">{selectedPayment.driver?.name}</div>
                </div>
                <div>
                  <Label>Load Number</Label>
                  <div className="font-medium">{selectedPayment.load?.loadNumber}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Route</Label>
                  <div className="text-sm">
                    {selectedPayment.load?.pickupAddress} → {selectedPayment.load?.deliveryAddress}
                  </div>
                </div>
                <div>
                  <Label>Distance</Label>
                  <div className="font-medium">{selectedPayment.load?.miles || 0} miles</div>
                </div>
              </div>

              <div className="p-4 bg-green-50 rounded-lg">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="text-sm text-muted-foreground">Payment Amount</div>
                    <div className="font-bold text-2xl text-green-600">
                      {formatCurrency(selectedPayment.amount)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-muted-foreground">Payment Method</div>
                    <div className="font-medium flex items-center gap-1">
                      <CreditCard className="h-4 w-4" />
                      Direct Deposit
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="payment-notes">Processing Notes (Optional)</Label>
                <Textarea
                  id="payment-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add any notes about this payment..."
                  className="bg-white border border-gray-300"
                  data-testid="textarea-payment-notes"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <Button
                  onClick={() => {
                    setSelectedPayment(null);
                    setNotes('');
                  }}
                  variant="outline"
                  className="flex-1"
                  data-testid="button-cancel-payment"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => processPaymentMutation.mutate({
                    paymentId: selectedPayment.id,
                    amount: selectedPayment.amount,
                    notes
                  })}
                  disabled={processPaymentMutation.isPending}
                  className="flex-1 bg-green-600 hover:bg-green-700"
                  data-testid="button-approve-payment"
                >
                  {processPaymentMutation.isPending ? 'Processing...' : 'Approve & Send Payment'}
                </Button>
              </div>
            </CardContent>
          </div>
        </Card>
      )}
    </div>
  );
}