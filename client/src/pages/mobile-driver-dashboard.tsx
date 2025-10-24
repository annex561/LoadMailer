import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { 
  Home, Package, MessageSquare, FileText, User, MapPin, Clock, DollarSign, 
  Navigation, CheckCircle, AlertCircle, Phone, Camera, Mic, Send, Plus,
  TrendingUp, Star, Truck, ChevronRight, Upload, ExternalLink, Menu,
  Settings, LogOut, Bell, Filter, Search, Calendar, Download, Share,
  RefreshCw, Zap, Map, Image as ImageIcon, FileCheck, X
} from 'lucide-react';
import type { LoadWithRelations, Driver, LoadDocument } from '@shared/schema';
import { cn } from '@/lib/utils';

interface LoadOffer {
  id: string;
  loadId: string;
  driverId: string;
  status: 'pending' | 'accepted' | 'declined' | 'timeout';
  sentAt: string;
  timeoutAt: string;
  respondedAt?: string;
  load?: LoadWithRelations;
}

interface DriverEarnings {
  totalEarnings: number;
  pendingPayment: number;
  paidThisWeek: number;
  paidThisMonth: number;
  loads: Array<{
    loadNumber: string;
    amount: number;
    status: string;
    completedDate: string;
    paymentStatus: 'pending' | 'paid' | 'processing';
  }>;
}

interface CommunicationThread {
  id: string;
  driverId: string;
  driverName: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadDispatchMessages: number;
  messages?: CommunicationMessage[];
}

interface CommunicationMessage {
  id: string;
  content: string;
  sender: 'driver' | 'dispatch';
  timestamp: string;
  read: boolean;
}

type TabType = 'home' | 'loads' | 'messages' | 'documents' | 'profile';

export default function MobileDriverDashboard() {
  const [activeTab, setActiveTab] = useState<TabType>('home');
  const [driverId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('driverId') || '';
  });
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [selectedThread, setSelectedThread] = useState<CommunicationThread | null>(null);
  const [selectedDocType, setSelectedDocType] = useState<string>('bol');
  const [isRecording, setIsRecording] = useState(false);
  
  // Pull-to-refresh state
  const [isPulling, setIsPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pullStartY = useRef(0);
  const pullContainerRef = useRef<HTMLDivElement>(null);
  
  // Swipe gesture state
  const [swipedItemId, setSwipedItemId] = useState<string | null>(null);
  const [swipeDistance, setSwipeDistance] = useState(0);
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);
  const currentSwipeId = useRef<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch driver profile
  const { data: driver } = useQuery({
    queryKey: ['/api/drivers', driverId],
    queryFn: async () => {
      const response = await fetch(`/api/drivers/${driverId}`);
      if (!response.ok) throw new Error('Failed to fetch driver profile');
      return response.json() as Promise<Driver>;
    }
  });

  // Fetch current load
  const { data: currentLoad, refetch: refetchCurrentLoad } = useQuery({
    queryKey: ['/api/drivers', driverId, 'current-load'],
    queryFn: async () => {
      const response = await fetch(`/api/loads?driverId=${driverId}&status=assigned,in_transit`);
      if (!response.ok) throw new Error('Failed to fetch current load');
      const loads = await response.json();
      return loads[0] || null;
    },
    refetchInterval: 10000
  });

  // Fetch driver earnings
  const { data: earnings } = useQuery({
    queryKey: ['/api/drivers', driverId, 'earnings'],
    queryFn: async () => {
      const response = await fetch(`/api/drivers/${driverId}/earnings`);
      if (!response.ok) throw new Error('Failed to fetch earnings');
      return response.json() as Promise<DriverEarnings>;
    }
  });

  // Fetch load history
  const { data: loadHistory = [] } = useQuery({
    queryKey: ['/api/drivers', driverId, 'load-history'],
    queryFn: async () => {
      const response = await fetch(`/api/drivers/${driverId}/load-history`);
      if (!response.ok) throw new Error('Failed to fetch load history');
      return response.json() as Promise<LoadWithRelations[]>;
    }
  });

  // Fetch communication threads
  const { data: threads = [] } = useQuery({
    queryKey: ['/api/communication/threads'],
    queryFn: async () => {
      const response = await fetch('/api/communication/threads');
      if (!response.ok) throw new Error('Failed to fetch threads');
      const allThreads = await response.json();
      return allThreads.filter((t: any) => t.driverId === driverId);
    },
    refetchInterval: 5000
  });

  // Fetch documents for current load
  const { data: documents = [] } = useQuery({
    queryKey: ['/api/loads', currentLoad?.id, 'documents'],
    queryFn: async () => {
      if (!currentLoad?.id) return [];
      const response = await fetch(`/api/loads/${currentLoad.id}/documents`);
      if (!response.ok) throw new Error('Failed to fetch documents');
      return response.json() as Promise<LoadDocument[]>;
    },
    enabled: !!currentLoad?.id
  });

  // Update load status mutation
  const updateLoadStatusMutation = useMutation({
    mutationFn: async ({ loadId, status }: { loadId: string; status: string }) => {
      const res = await fetch(`/api/loads/${loadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (!res.ok) throw new Error('Failed to update load status');
      return res.json();
    },
    onSuccess: () => {
      refetchCurrentLoad();
      queryClient.invalidateQueries({ queryKey: ['/api/drivers', driverId, 'earnings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/drivers', driverId, 'load-history'] });
      toast({
        title: 'Load Status Updated',
        description: 'Load status has been updated successfully.'
      });
    }
  });

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async ({ threadId, content }: { threadId: string; content: string }) => {
      const res = await fetch(`/api/communication/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId, content, sender: 'driver' })
      });
      if (!res.ok) throw new Error('Failed to send message');
      return res.json();
    },
    onSuccess: () => {
      setMessageInput('');
      queryClient.invalidateQueries({ queryKey: ['/api/communication/threads'] });
      toast({
        title: 'Message Sent',
        description: 'Your message has been sent to dispatch.'
      });
    }
  });

  // Upload document mutation
  const uploadDocumentMutation = useMutation({
    mutationFn: async ({ file, documentType, loadId }: { file: File; documentType: string; loadId: string }) => {
      // Step 1: Get upload URL
      const uploadUrlRes = await fetch('/api/documents/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!uploadUrlRes.ok) throw new Error('Failed to get upload URL');
      const { uploadUrl } = await uploadUrlRes.json();

      // Step 2: Upload file directly to object storage
      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file
      });
      if (!uploadRes.ok) throw new Error('Failed to upload file to storage');

      // Step 3: Create document record
      const createDocRes = await fetch(`/api/loads/${loadId}/upload-document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loadId,
          driverId,
          documentType,
          fileName: file.name,
          fileUrl: uploadUrl.split('?')[0],
          fileSize: file.size,
          mimeType: file.type
        })
      });
      if (!createDocRes.ok) {
        const errorData = await createDocRes.json();
        throw new Error(errorData.error || 'Failed to create document record');
      }
      return createDocRes.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/loads', currentLoad?.id, 'documents'] });
      toast({
        title: 'Document Uploaded',
        description: 'Your document has been uploaded successfully.'
      });
    },
    onError: (error) => {
      toast({
        title: 'Upload Failed',
        description: error instanceof Error ? error.message : 'Failed to upload document',
        variant: 'destructive'
      });
    }
  });

  const handleStartGPSTracking = async () => {
    try {
      toast({
        title: 'Initializing GPS Tracking',
        description: 'Generating secure authentication token...'
      });

      const response = await fetch(`/api/drivers/${driverId}/generate-tracking-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) throw new Error('Failed to generate tracking token');
      const { token } = await response.json();
      
      window.location.href = `/driver-tracker?driver=${driverId}&token=${token}`;
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to start GPS tracking. Please try again.',
        variant: 'destructive'
      });
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentLoad || !driverId) return;

    uploadDocumentMutation.mutate({
      file,
      documentType: selectedDocType,
      loadId: currentLoad.id
    });
  };

  const handleSendMessage = () => {
    if (!messageInput.trim() || !selectedThread) return;
    sendMessageMutation.mutate({
      threadId: selectedThread.id,
      content: messageInput
    });
  };

  const openNavigation = (address: string, app: 'google' | 'waze') => {
    const encodedAddress = encodeURIComponent(address);
    const url = app === 'google' 
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodedAddress}`
      : `https://www.waze.com/ul?q=${encodedAddress}&navigate=yes`;
    window.open(url, '_blank');
  };

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
      case 'assigned': return 'bg-blue-500';
      case 'in_transit': return 'bg-orange-500';
      case 'delivered': return 'bg-green-500';
      case 'completed': return 'bg-emerald-600';
      case 'available': return 'bg-gray-500';
      default: return 'bg-gray-500';
    }
  };

  const getPaymentStatusColor = (status: string) => {
    switch (status) {
      case 'paid': return 'text-green-600 bg-green-50';
      case 'pending': return 'text-yellow-600 bg-yellow-50';
      case 'processing': return 'text-blue-600 bg-blue-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  // Pull-to-refresh handlers
  const handlePullStart = (e: React.TouchEvent | React.PointerEvent) => {
    const container = pullContainerRef.current;
    if (!container) return;
    
    // Only start pull if we're at the top of the scroll container
    if (container.scrollTop === 0) {
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      pullStartY.current = clientY;
      setIsPulling(true);
    }
  };

  const handlePullMove = (e: React.TouchEvent | React.PointerEvent) => {
    if (!isPulling || isRefreshing) return;
    
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const distance = Math.max(0, clientY - pullStartY.current);
    
    // Apply resistance to make it feel natural
    const resistance = 0.5;
    const adjustedDistance = Math.min(distance * resistance, 120);
    
    setPullDistance(adjustedDistance);
  };

  const handlePullEnd = async () => {
    if (!isPulling) return;
    
    setIsPulling(false);
    
    // Trigger refresh if pulled far enough (80px threshold)
    if (pullDistance > 80 && !isRefreshing) {
      setIsRefreshing(true);
      
      try {
        // Refetch all queries
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['/api/drivers', driverId] }),
          queryClient.invalidateQueries({ queryKey: ['/api/drivers', driverId, 'current-load'] }),
          queryClient.invalidateQueries({ queryKey: ['/api/drivers', driverId, 'earnings'] }),
          queryClient.invalidateQueries({ queryKey: ['/api/drivers', driverId, 'load-history'] }),
          queryClient.invalidateQueries({ queryKey: ['/api/communication/threads'] }),
          queryClient.invalidateQueries({ queryKey: ['/api/loads', currentLoad?.id, 'documents'] }),
        ]);
        
        toast({
          title: 'Refreshed',
          description: 'All data has been updated successfully.'
        });
      } catch (error) {
        toast({
          title: 'Refresh Failed',
          description: 'Unable to refresh data. Please try again.',
          variant: 'destructive'
        });
      } finally {
        setTimeout(() => {
          setIsRefreshing(false);
          setPullDistance(0);
        }, 500);
      }
    } else {
      setPullDistance(0);
    }
  };

  // Swipe gesture handlers
  const handleSwipeStart = (e: React.PointerEvent, itemId: string) => {
    swipeStartX.current = e.clientX;
    swipeStartY.current = e.clientY;
    currentSwipeId.current = itemId;
  };

  const handleSwipeMove = (e: React.PointerEvent) => {
    if (!currentSwipeId.current) return;
    
    const deltaX = swipeStartX.current - e.clientX;
    const deltaY = Math.abs(swipeStartY.current - e.clientY);
    
    // Only allow horizontal swipe if it's mostly horizontal movement
    if (deltaY < 30 && deltaX > 0) {
      setSwipeDistance(Math.min(deltaX, 120));
      setSwipedItemId(currentSwipeId.current);
    }
  };

  const handleSwipeEnd = () => {
    // If swiped more than 60px, keep it open, otherwise close
    if (swipeDistance > 60) {
      setSwipeDistance(120);
    } else {
      setSwipeDistance(0);
      setSwipedItemId(null);
    }
    currentSwipeId.current = null;
  };

  const closeSwipe = () => {
    setSwipeDistance(0);
    setSwipedItemId(null);
  };

  const handleCallCustomer = (load: LoadWithRelations) => {
    closeSwipe();
    if (load.customerPhone) {
      window.location.href = `tel:${load.customerPhone}`;
    } else {
      toast({
        title: 'No Phone Number',
        description: 'Customer phone number not available.',
        variant: 'destructive'
      });
    }
  };

  const handleArchiveThread = (threadId: string) => {
    closeSwipe();
    toast({
      title: 'Archived',
      description: 'Message thread has been archived.'
    });
  };

  const handleMarkAsRead = (threadId: string) => {
    closeSwipe();
    toast({
      title: 'Marked as Read',
      description: 'All messages marked as read.'
    });
  };

  // HOME TAB
  const HomeTab = () => (
    <div className="space-y-4 pb-24">
      {/* Welcome Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-6 rounded-b-3xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold">Hello, {driver?.name?.split(' ')[0] || 'Driver'} 👋</h1>
            <p className="text-blue-100 text-sm">Let's have a great day!</p>
          </div>
          <Button 
            onClick={() => setShowQuickActions(!showQuickActions)}
            className="bg-white/20 hover:bg-white/30 rounded-full h-12 w-12 p-0"
            data-testid="button-menu"
          >
            <Menu className="h-6 w-6" />
          </Button>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-3 text-center">
            <div className="text-3xl font-bold">{driver?.completedLoads || 0}</div>
            <div className="text-xs text-blue-100">Loads</div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-3 text-center">
            <div className="text-3xl font-bold">{formatCurrency(earnings?.totalEarnings || 0)}</div>
            <div className="text-xs text-blue-100">Earned</div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-3 text-center">
            <div className="text-3xl font-bold">{driver?.averageRating?.toFixed(1) || '0.0'}</div>
            <div className="text-xs text-blue-100">Rating</div>
          </div>
        </div>
      </div>

      {/* Current Load Card */}
      {currentLoad ? (
        <Card className="mx-4 border-2 border-blue-100 shadow-lg">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Truck className="h-5 w-5 text-blue-600" />
                <CardTitle className="text-lg">Current Load</CardTitle>
              </div>
              <Badge className={cn(getStatusColor(currentLoad.status), "text-white text-xs")}>
                {currentLoad.status.replace('_', ' ')}
              </Badge>
            </div>
            <CardDescription className="text-base font-semibold text-gray-900">
              {currentLoad.loadNumber}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Route */}
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="bg-green-100 rounded-full p-2 mt-1">
                  <MapPin className="h-4 w-4 text-green-600" />
                </div>
                <div className="flex-1">
                  <div className="text-xs text-gray-500">Pickup</div>
                  <div className="font-semibold text-sm">{currentLoad.pickupAddress}</div>
                  <div className="text-xs text-gray-600">
                    {formatDate(currentLoad.pickupDate)} • {currentLoad.pickupTime}
                  </div>
                </div>
              </div>
              
              <div className="flex items-start gap-3">
                <div className="bg-red-100 rounded-full p-2 mt-1">
                  <MapPin className="h-4 w-4 text-red-600" />
                </div>
                <div className="flex-1">
                  <div className="text-xs text-gray-500">Delivery</div>
                  <div className="font-semibold text-sm">{currentLoad.deliveryAddress}</div>
                  <div className="text-xs text-gray-600">
                    {formatDate(currentLoad.deliveryDate)} • {currentLoad.deliveryTime}
                  </div>
                </div>
              </div>
            </div>

            {/* Earnings & Distance */}
            <div className="grid grid-cols-2 gap-3 bg-blue-50 rounded-xl p-3">
              <div>
                <div className="text-xs text-gray-600">Your Pay</div>
                <div className="text-2xl font-bold text-blue-600">
                  {formatCurrency(currentLoad.rate ? currentLoad.rate * 0.9 : 0)}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-600">Distance</div>
                <div className="text-2xl font-bold text-gray-900">{currentLoad.miles || 0} mi</div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-2">
              {currentLoad.status === 'assigned' && (
                <Button
                  onClick={() => updateLoadStatusMutation.mutate({ 
                    loadId: currentLoad.id, 
                    status: 'in_transit' 
                  })}
                  className="w-full h-14 text-lg bg-green-600 hover:bg-green-700"
                  data-testid="button-start-delivery"
                >
                  <Navigation className="h-5 w-5 mr-2" />
                  Start Delivery
                </Button>
              )}

              {currentLoad.status === 'in_transit' && (
                <Button
                  onClick={() => updateLoadStatusMutation.mutate({ 
                    loadId: currentLoad.id, 
                    status: 'delivered' 
                  })}
                  className="w-full h-14 text-lg bg-emerald-600 hover:bg-emerald-700"
                  data-testid="button-mark-delivered"
                >
                  <CheckCircle className="h-5 w-5 mr-2" />
                  Mark as Delivered
                </Button>
              )}

              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  onClick={() => openNavigation(
                    currentLoad.status === 'assigned' ? currentLoad.pickupAddress : currentLoad.deliveryAddress,
                    'google'
                  )}
                  className="h-12"
                  data-testid="button-navigate-google"
                >
                  <Map className="h-4 w-4 mr-2" />
                  Google Maps
                </Button>
                <Button
                  variant="outline"
                  onClick={() => openNavigation(
                    currentLoad.status === 'assigned' ? currentLoad.pickupAddress : currentLoad.deliveryAddress,
                    'waze'
                  )}
                  className="h-12"
                  data-testid="button-navigate-waze"
                >
                  <Navigation className="h-4 w-4 mr-2" />
                  Waze
                </Button>
              </div>

              <Button
                variant="outline"
                onClick={handleStartGPSTracking}
                className="w-full h-12"
                data-testid="button-gps-tracking"
              >
                <MapPin className="h-4 w-4 mr-2" />
                Enable GPS Tracking
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="mx-4">
          <CardContent className="py-12 text-center">
            <Truck className="h-16 w-16 mx-auto mb-4 text-gray-300" />
            <p className="text-gray-500 font-medium">No Active Load</p>
            <p className="text-sm text-gray-400">You'll see your next load here</p>
          </CardContent>
        </Card>
      )}

      {/* Required Documents */}
      {currentLoad && (
        <div className="mx-4">
          <h3 className="text-lg font-bold mb-3">Required Documents</h3>
          <div className="grid grid-cols-3 gap-3">
            {['bol', 'pod', 'weight_ticket'].map((docType) => {
              const hasDoc = documents.some(d => d.documentType === docType && d.approvalStatus === 'approved');
              return (
                <div
                  key={docType}
                  className={cn(
                    "p-4 rounded-xl border-2 text-center",
                    hasDoc ? "border-green-500 bg-green-50" : "border-gray-200 bg-white"
                  )}
                >
                  {hasDoc ? (
                    <CheckCircle className="h-6 w-6 mx-auto mb-2 text-green-600" />
                  ) : (
                    <FileCheck className="h-6 w-6 mx-auto mb-2 text-gray-400" />
                  )}
                  <div className="text-xs font-medium uppercase">
                    {docType.replace('_', ' ')}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  // LOADS TAB
  const LoadsTab = () => (
    <div className="space-y-4 pb-24">
      {/* Earnings Summary */}
      <div className="bg-gradient-to-br from-green-600 to-green-700 text-white p-6 rounded-b-3xl">
        <h2 className="text-lg font-semibold mb-4">Earnings Overview</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4">
            <div className="text-xs text-green-100">Pending Payment</div>
            <div className="text-2xl font-bold mt-1">{formatCurrency(earnings?.pendingPayment || 0)}</div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4">
            <div className="text-xs text-green-100">This Month</div>
            <div className="text-2xl font-bold mt-1">{formatCurrency(earnings?.paidThisMonth || 0)}</div>
          </div>
        </div>
      </div>

      {/* Load History */}
      <div className="mx-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold">Recent Loads</h3>
          <Button variant="ghost" size="sm" data-testid="button-filter-loads">
            <Filter className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-3">
          {loadHistory.length > 0 ? (
            loadHistory.slice(0, 10).map((load) => (
              <div 
                key={load.id} 
                className="relative overflow-hidden"
              >
                {/* Swipe Action Background */}
                <div className="absolute inset-0 bg-blue-600 flex items-center justify-end px-6">
                  <div className="flex items-center gap-2 text-white">
                    <Phone className="h-5 w-5" />
                    <span className="font-semibold">Call Customer</span>
                  </div>
                </div>

                {/* Main Card */}
                <div
                  className="relative bg-white"
                  style={{
                    transform: swipedItemId === load.id 
                      ? `translateX(-${swipeDistance}px)` 
                      : 'translateX(0)',
                    transition: currentSwipeId.current === load.id ? 'none' : 'transform 0.3s ease-out'
                  }}
                  onPointerDown={(e) => handleSwipeStart(e, load.id)}
                  onPointerMove={handleSwipeMove}
                  onPointerUp={handleSwipeEnd}
                  onPointerCancel={handleSwipeEnd}
                  onClick={() => {
                    if (swipedItemId === load.id && swipeDistance > 60) {
                      handleCallCustomer(load);
                    }
                  }}
                >
                  <Card className="border-l-4 border-l-blue-500">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-bold">{load.loadNumber}</div>
                        <Badge className={cn(getStatusColor(load.status), "text-white text-xs")}>
                          {load.status}
                        </Badge>
                      </div>
                      <div className="text-sm text-gray-600 mb-3">
                        {load.pickupAddress?.split(',')[0]} → {load.deliveryAddress?.split(',')[0]}
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="text-sm text-gray-500">
                          {formatDate(load.deliveryDate)}
                        </div>
                        <div className="font-bold text-green-600">
                          {formatCurrency(load.rate ? load.rate * 0.9 : 0)}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-12">
              <Package className="h-16 w-16 mx-auto mb-4 text-gray-300" />
              <p className="text-gray-500">No load history yet</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // MESSAGES TAB
  const MessagesTab = () => (
    <div className="flex flex-col h-[calc(100vh-80px)]">
      {!selectedThread ? (
        <div className="space-y-2 p-4 overflow-y-auto pb-24">
          <h2 className="text-xl font-bold mb-4">Messages</h2>
          {threads.map((thread) => (
            <div 
              key={thread.id} 
              className="relative overflow-hidden"
            >
              {/* Swipe Action Background */}
              <div className="absolute inset-0 bg-gradient-to-l from-red-600 via-orange-600 to-yellow-600 flex items-center justify-end px-6 gap-4">
                <div className="flex items-center gap-2 text-white">
                  <CheckCircle className="h-5 w-5" />
                  <span className="font-semibold">Mark Read</span>
                </div>
              </div>

              {/* Main Card */}
              <div
                className="relative bg-white"
                style={{
                  transform: swipedItemId === thread.id 
                    ? `translateX(-${swipeDistance}px)` 
                    : 'translateX(0)',
                  transition: currentSwipeId.current === thread.id ? 'none' : 'transform 0.3s ease-out'
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  handleSwipeStart(e, thread.id);
                }}
                onPointerMove={(e) => {
                  e.stopPropagation();
                  handleSwipeMove(e);
                }}
                onPointerUp={(e) => {
                  e.stopPropagation();
                  handleSwipeEnd();
                }}
                onPointerCancel={(e) => {
                  e.stopPropagation();
                  handleSwipeEnd();
                }}
              >
                <Card
                  className="cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => {
                    if (swipedItemId === thread.id && swipeDistance > 60) {
                      handleMarkAsRead(thread.id);
                    } else if (swipeDistance === 0) {
                      setSelectedThread(thread);
                    }
                  }}
                  data-testid={`thread-${thread.id}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="font-semibold flex items-center gap-2">
                          Dispatch
                          {thread.unreadDispatchMessages > 0 && (
                            <Badge className="bg-red-500 text-white text-xs">
                              {thread.unreadDispatchMessages}
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-gray-600 truncate">
                          {thread.lastMessage || 'No messages yet'}
                        </div>
                        <div className="text-xs text-gray-400 mt-1">
                          {formatDate(thread.lastMessageAt)}
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-gray-400 flex-shrink-0 mt-1" />
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col h-full">
          {/* Chat Header */}
          <div className="bg-blue-600 text-white p-4 flex items-center gap-3 shadow-lg">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedThread(null)}
              className="text-white hover:bg-white/20 p-2 rounded-full"
              data-testid="button-back-to-threads"
            >
              <ChevronRight className="h-5 w-5 rotate-180" />
            </Button>
            <div className="flex-1">
              <div className="font-semibold">Dispatch</div>
              <div className="text-xs text-blue-100">Load Signal Team</div>
            </div>
            <Phone className="h-5 w-5" />
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
            {selectedThread.messages?.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "flex",
                  message.sender === 'driver' ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-4 py-2",
                    message.sender === 'driver'
                      ? "bg-blue-600 text-white rounded-br-sm"
                      : "bg-white text-gray-900 rounded-bl-sm shadow"
                  )}
                >
                  <div className="text-sm">{message.content}</div>
                  <div
                    className={cn(
                      "text-xs mt-1",
                      message.sender === 'driver' ? "text-blue-100" : "text-gray-500"
                    )}
                  >
                    {formatDate(message.timestamp)}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Message Input with Microphone */}
          <div className="p-4 bg-white border-t border-gray-200 pb-20">
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center bg-gray-100 rounded-full px-4 py-2">
                <Input
                  type="text"
                  placeholder="Type a message..."
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                  className="border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-base"
                  data-testid="input-message"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "rounded-full p-2 h-auto",
                    isRecording && "bg-red-100"
                  )}
                  onClick={() => setIsRecording(!isRecording)}
                  data-testid="button-voice-input"
                >
                  <Mic className={cn("h-5 w-5", isRecording && "text-red-600")} />
                </Button>
              </div>
              <Button
                onClick={handleSendMessage}
                disabled={!messageInput.trim()}
                className="rounded-full h-12 w-12 p-0 bg-blue-600 hover:bg-blue-700"
                data-testid="button-send-message"
              >
                <Send className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // DOCUMENTS TAB
  const DocumentsTab = () => (
    <div className="space-y-4 pb-24">
      <div className="p-4">
        <h2 className="text-xl font-bold mb-4">Documents</h2>

        {/* Camera Upload */}
        {currentLoad && (
          <Card className="mb-4 border-2 border-dashed border-blue-300 bg-blue-50">
            <CardContent className="p-6 text-center">
              <Camera className="h-12 w-12 mx-auto mb-3 text-blue-600" />
              <h3 className="font-semibold mb-2">Upload Document</h3>
              <p className="text-sm text-gray-600 mb-4">
                Take a photo or select from gallery
              </p>

              {/* Document Type Selector */}
              <div className="flex gap-2 mb-4 justify-center">
                {['bol', 'pod', 'weight_ticket'].map((type) => (
                  <Button
                    key={type}
                    variant={selectedDocType === type ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedDocType(type)}
                    data-testid={`button-select-${type}`}
                  >
                    {type.toUpperCase().replace('_', ' ')}
                  </Button>
                ))}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileUpload}
                className="hidden"
              />

              <div className="grid grid-cols-2 gap-2">
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  className="h-12"
                  data-testid="button-take-photo"
                >
                  <Camera className="h-4 w-4 mr-2" />
                  Take Photo
                </Button>
                <Button
                  onClick={() => {
                    if (fileInputRef.current) {
                      fileInputRef.current.removeAttribute('capture');
                      fileInputRef.current.click();
                    }
                  }}
                  variant="outline"
                  className="h-12"
                  data-testid="button-choose-file"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Choose File
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Document Gallery */}
        <div>
          <h3 className="font-semibold mb-3">Uploaded Documents</h3>
          <div className="grid grid-cols-2 gap-3">
            {documents.length > 0 ? (
              documents.map((doc) => (
                <Card key={doc.id} className="overflow-hidden">
                  <div className="aspect-video bg-gray-100 flex items-center justify-center">
                    <ImageIcon className="h-8 w-8 text-gray-400" />
                  </div>
                  <CardContent className="p-3">
                    <div className="text-xs font-medium uppercase text-gray-600 mb-1">
                      {doc.documentType.replace('_', ' ')}
                    </div>
                    <Badge
                      className={cn(
                        "text-xs",
                        doc.approvalStatus === 'approved' && "bg-green-100 text-green-700",
                        doc.approvalStatus === 'pending' && "bg-yellow-100 text-yellow-700",
                        doc.approvalStatus === 'rejected' && "bg-red-100 text-red-700"
                      )}
                    >
                      {doc.approvalStatus}
                    </Badge>
                  </CardContent>
                </Card>
              ))
            ) : (
              <div className="col-span-2 text-center py-12">
                <FileText className="h-16 w-16 mx-auto mb-4 text-gray-300" />
                <p className="text-gray-500">No documents uploaded yet</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  // PROFILE TAB
  const ProfileTab = () => (
    <div className="space-y-4 pb-24">
      {/* Profile Header */}
      <div className="bg-gradient-to-br from-gray-800 to-gray-900 text-white p-6 rounded-b-3xl">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center">
            <User className="h-8 w-8" />
          </div>
          <div>
            <h2 className="text-xl font-bold">{driver?.name || 'Driver'}</h2>
            <p className="text-sm text-gray-300">{driver?.email}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-4">
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3">
            <div className="text-xs text-gray-300">Equipment</div>
            <div className="font-semibold mt-1">
              {driver?.equipmentType?.replace('_', ' ') || 'Not Set'}
            </div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3">
            <div className="text-xs text-gray-300">Status</div>
            <div className="font-semibold mt-1 capitalize">{driver?.status || 'Unknown'}</div>
          </div>
        </div>
      </div>

      {/* Settings */}
      <div className="mx-4 space-y-2">
        <h3 className="text-lg font-bold mb-3">Settings</h3>

        <Card className="cursor-pointer hover:bg-gray-50" data-testid="card-gps-settings">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MapPin className="h-5 w-5 text-gray-600" />
              <div>
                <div className="font-semibold">GPS Tracking</div>
                <div className="text-sm text-gray-500">Manage location sharing</div>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-gray-400" />
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:bg-gray-50" data-testid="card-notifications">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Bell className="h-5 w-5 text-gray-600" />
              <div>
                <div className="font-semibold">Notifications</div>
                <div className="text-sm text-gray-500">SMS and push alerts</div>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-gray-400" />
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:bg-gray-50" data-testid="card-support">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Phone className="h-5 w-5 text-gray-600" />
              <div>
                <div className="font-semibold">Contact Support</div>
                <div className="text-sm text-gray-500">Get help from dispatch</div>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-gray-400" />
          </CardContent>
        </Card>
      </div>
    </div>
  );

  // Floating Action Button
  const QuickActionsFAB = () => (
    <>
      {showQuickActions && (
        <div
          className="fixed inset-0 bg-black/20 z-40"
          onClick={() => setShowQuickActions(false)}
        />
      )}
      <div className="fixed bottom-24 right-6 z-50">
        {showQuickActions && (
          <div className="mb-4 space-y-2 animate-in slide-in-from-bottom-4">
            <Button
              onClick={() => {
                setActiveTab('documents');
                setShowQuickActions(false);
              }}
              className="w-full h-12 bg-white text-gray-900 hover:bg-gray-100 shadow-lg"
              data-testid="quick-action-upload"
            >
              <Camera className="h-5 w-5 mr-2" />
              Upload Photo
            </Button>
            <Button
              onClick={() => {
                setActiveTab('messages');
                setShowQuickActions(false);
              }}
              className="w-full h-12 bg-white text-gray-900 hover:bg-gray-100 shadow-lg"
              data-testid="quick-action-message"
            >
              <MessageSquare className="h-5 w-5 mr-2" />
              Message Dispatch
            </Button>
            <Button
              onClick={() => {
                handleStartGPSTracking();
                setShowQuickActions(false);
              }}
              className="w-full h-12 bg-white text-gray-900 hover:bg-gray-100 shadow-lg"
              data-testid="quick-action-gps"
            >
              <MapPin className="h-5 w-5 mr-2" />
              Update Location
            </Button>
          </div>
        )}
        <Button
          onClick={() => setShowQuickActions(!showQuickActions)}
          className="w-14 h-14 rounded-full shadow-2xl bg-blue-600 hover:bg-blue-700"
          data-testid="button-quick-actions"
        >
          {showQuickActions ? (
            <X className="h-6 w-6" />
          ) : (
            <Plus className="h-6 w-6" />
          )}
        </Button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Content with Pull-to-Refresh */}
      <div 
        ref={pullContainerRef}
        className="max-w-2xl mx-auto overflow-y-auto h-screen"
        onTouchStart={handlePullStart}
        onTouchMove={handlePullMove}
        onTouchEnd={handlePullEnd}
        onPointerDown={handlePullStart}
        onPointerMove={handlePullMove}
        onPointerUp={handlePullEnd}
        style={{
          transform: isPulling || isRefreshing ? `translateY(${pullDistance}px)` : 'translateY(0)',
          transition: isPulling ? 'none' : 'transform 0.3s ease-out'
        }}
      >
        {/* Pull-to-Refresh Indicator */}
        {(pullDistance > 0 || isRefreshing) && (
          <div 
            className="flex items-center justify-center py-4"
            style={{
              opacity: Math.min(pullDistance / 80, 1),
              transform: `translateY(-${60 - pullDistance}px)`
            }}
          >
            <div className="flex items-center gap-2 text-blue-600">
              <RefreshCw 
                className={cn(
                  "h-5 w-5",
                  isRefreshing && "animate-spin"
                )}
                style={{
                  transform: !isRefreshing ? `rotate(${pullDistance * 3}deg)` : undefined
                }}
              />
              <span className="font-semibold text-sm">
                {isRefreshing ? 'Refreshing...' : pullDistance > 80 ? 'Release to refresh' : 'Pull to refresh'}
              </span>
            </div>
          </div>
        )}

        {activeTab === 'home' && <HomeTab />}
        {activeTab === 'loads' && <LoadsTab />}
        {activeTab === 'messages' && <MessagesTab />}
        {activeTab === 'documents' && <DocumentsTab />}
        {activeTab === 'profile' && <ProfileTab />}
      </div>

      {/* Quick Actions FAB */}
      <QuickActionsFAB />

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-30 shadow-lg">
        <div className="max-w-2xl mx-auto grid grid-cols-5 h-20">
          <button
            onClick={() => setActiveTab('home')}
            className={cn(
              "flex flex-col items-center justify-center gap-1 transition-colors",
              activeTab === 'home' ? "text-blue-600" : "text-gray-500"
            )}
            data-testid="tab-home"
          >
            <Home className="h-6 w-6" />
            <span className="text-xs font-medium">Home</span>
          </button>
          
          <button
            onClick={() => setActiveTab('loads')}
            className={cn(
              "flex flex-col items-center justify-center gap-1 transition-colors",
              activeTab === 'loads' ? "text-blue-600" : "text-gray-500"
            )}
            data-testid="tab-loads"
          >
            <Package className="h-6 w-6" />
            <span className="text-xs font-medium">Loads</span>
          </button>
          
          <button
            onClick={() => setActiveTab('messages')}
            className={cn(
              "flex flex-col items-center justify-center gap-1 transition-colors relative",
              activeTab === 'messages' ? "text-blue-600" : "text-gray-500"
            )}
            data-testid="tab-messages"
          >
            {threads.some(t => t.unreadDispatchMessages > 0) && (
              <div className="absolute top-2 right-6 w-2 h-2 bg-red-500 rounded-full" />
            )}
            <MessageSquare className="h-6 w-6" />
            <span className="text-xs font-medium">Messages</span>
          </button>
          
          <button
            onClick={() => setActiveTab('documents')}
            className={cn(
              "flex flex-col items-center justify-center gap-1 transition-colors",
              activeTab === 'documents' ? "text-blue-600" : "text-gray-500"
            )}
            data-testid="tab-documents"
          >
            <FileText className="h-6 w-6" />
            <span className="text-xs font-medium">Documents</span>
          </button>
          
          <button
            onClick={() => setActiveTab('profile')}
            className={cn(
              "flex flex-col items-center justify-center gap-1 transition-colors",
              activeTab === 'profile' ? "text-blue-600" : "text-gray-500"
            )}
            data-testid="tab-profile"
          >
            <User className="h-6 w-6" />
            <span className="text-xs font-medium">Profile</span>
          </button>
        </div>
      </div>
    </div>
  );
}
