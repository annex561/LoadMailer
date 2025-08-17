import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle, XCircle, Clock, Phone, MessageSquare } from 'lucide-react';

interface SMSStatusData {
  sid: string;
  status: string;
  to: string;
  from: string;
  body: string;
  errorCode: number | null;
  errorMessage: string | null;
  dateCreated: string;
  dateSent: string | null;
  price: string;
  direction: string;
}

export default function SMSStatusPage() {
  const [messageId, setMessageId] = useState('');
  const [statusData, setStatusData] = useState<SMSStatusData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const checkStatus = async () => {
    if (!messageId.trim()) {
      setError('Please enter a message ID');
      return;
    }

    setLoading(true);
    setError('');
    
    try {
      const response = await fetch(`/api/sms-status/${messageId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch SMS status');
      }
      
      const data = await response.json();
      setStatusData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check SMS status');
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'delivered':
        return <CheckCircle className="text-green-500 w-5 h-5" />;
      case 'sent':
      case 'queued':
        return <Clock className="text-blue-500 w-5 h-5" />;
      case 'failed':
      case 'undelivered':
        return <XCircle className="text-red-500 w-5 h-5" />;
      default:
        return <AlertTriangle className="text-yellow-500 w-5 h-5" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'delivered':
        return 'bg-green-100 text-green-800';
      case 'sent':
      case 'queued':
        return 'bg-blue-100 text-blue-800';
      case 'failed':
      case 'undelivered':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-yellow-100 text-yellow-800';
    }
  };

  const getErrorExplanation = (errorCode: number) => {
    switch (errorCode) {
      case 30034:
        return {
          title: 'Message Failed to Send',
          description: 'The destination number is unreachable, invalid, or the carrier rejected the message. This often happens with unverified numbers on trial accounts or invalid phone numbers.',
          solution: 'Verify the phone number is correct and active. For trial accounts, ensure the destination number is verified in your Twilio console.'
        };
      case 21608:
        return {
          title: 'Trial Account Restriction',
          description: 'Twilio trial accounts can only send SMS to verified phone numbers.',
          solution: 'Add the destination number to your verified caller IDs in the Twilio console.'
        };
      case 21660:
        return {
          title: 'Invalid From Number',
          description: 'The From number does not belong to your Twilio account or is not properly configured.',
          solution: 'Check that the From number is a valid Twilio phone number in your account.'
        };
      default:
        return {
          title: 'Unknown Error',
          description: 'An unknown error occurred during message delivery.',
          solution: 'Check the Twilio documentation for this specific error code.'
        };
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center space-x-3">
        <MessageSquare className="w-8 h-8 text-blue-600" />
        <div>
          <h1 className="text-3xl font-bold">SMS Status Checker</h1>
          <p className="text-gray-600">Check the delivery status of SMS messages</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Phone className="w-5 h-5" />
            <span>Check SMS Delivery Status</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="messageId">Twilio Message ID (SID)</Label>
            <Input
              id="messageId"
              placeholder="SM..."
              value={messageId}
              onChange={(e) => setMessageId(e.target.value)}
              className="bg-white"
            />
          </div>
          
          <Button 
            onClick={checkStatus} 
            disabled={loading}
            className="w-full"
            data-testid="button-check-status"
          >
            {loading ? 'Checking...' : 'Check Status'}
          </Button>

          {error && (
            <div className="bg-red-50 border border-red-200 p-3 rounded-lg">
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {statusData && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              {getStatusIcon(statusData.status)}
              <span>Message Status</span>
              <Badge className={getStatusColor(statusData.status)}>
                {statusData.status.toUpperCase()}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium text-gray-500">Message ID</Label>
                <p className="font-mono text-sm">{statusData.sid}</p>
              </div>
              
              <div>
                <Label className="text-sm font-medium text-gray-500">Status</Label>
                <p className="font-semibold">{statusData.status}</p>
              </div>
              
              <div>
                <Label className="text-sm font-medium text-gray-500">To</Label>
                <p>{statusData.to}</p>
              </div>
              
              <div>
                <Label className="text-sm font-medium text-gray-500">From</Label>
                <p>{statusData.from}</p>
              </div>
              
              <div>
                <Label className="text-sm font-medium text-gray-500">Created</Label>
                <p>{new Date(statusData.dateCreated).toLocaleString()}</p>
              </div>
              
              <div>
                <Label className="text-sm font-medium text-gray-500">Sent</Label>
                <p>{statusData.dateSent ? new Date(statusData.dateSent).toLocaleString() : 'Not sent'}</p>
              </div>
              
              <div>
                <Label className="text-sm font-medium text-gray-500">Price</Label>
                <p>${Math.abs(parseFloat(statusData.price || '0')).toFixed(4)}</p>
              </div>
              
              <div>
                <Label className="text-sm font-medium text-gray-500">Direction</Label>
                <p>{statusData.direction}</p>
              </div>
            </div>

            {statusData.body && (
              <div>
                <Label className="text-sm font-medium text-gray-500">Message Body</Label>
                <div className="bg-gray-50 p-3 rounded border text-sm mt-1">
                  {statusData.body}
                </div>
              </div>
            )}

            {statusData.errorCode && (
              <div className="bg-red-50 border border-red-200 p-4 rounded-lg">
                <div className="flex items-start space-x-3">
                  <XCircle className="text-red-500 w-5 h-5 mt-0.5" />
                  <div className="space-y-2">
                    <h4 className="font-medium text-red-800">
                      Error {statusData.errorCode}: {getErrorExplanation(statusData.errorCode).title}
                    </h4>
                    <p className="text-sm text-red-700">
                      {getErrorExplanation(statusData.errorCode).description}
                    </p>
                    <div className="bg-red-100 p-3 rounded text-sm">
                      <strong>Solution:</strong> {getErrorExplanation(statusData.errorCode).solution}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent Test Message IDs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="bg-gray-50 p-2 rounded">
              <strong>Latest:</strong> SM2e4f4a9c81fa5115f5ed9a03fff16c4c (to +1 205 861 4115)
            </div>
            <div className="bg-gray-50 p-2 rounded">
              <strong>Previous:</strong> SMc77e117fabb9cc984e260136477b92dd (to +1 205 861 4115)
            </div>
            <div className="bg-blue-50 p-2 rounded">
              <strong>Testing verified number:</strong> Try sending to +1 855 599 9983 (your other verified number)
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}