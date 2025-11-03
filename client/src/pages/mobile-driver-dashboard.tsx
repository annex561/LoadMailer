import { useState, useRef, useEffect, useMemo } from 'react';
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
  RefreshCw, Zap, Map, Image as ImageIcon, FileCheck, X, HelpCircle,
  Edit2, Trash2, MoreVertical, RotateCcw, Check
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
    const urlDriverId = params.get('driverId');
    
    // If driverId in URL, save it to localStorage for PWA launches
    if (urlDriverId) {
      localStorage.setItem('load-signal-driver-id', urlDriverId);
      return urlDriverId;
    }
    
    // Otherwise, try to get it from localStorage
    return localStorage.getItem('load-signal-driver-id') || '';
  });
  
  // Handle PWA launch redirect in useEffect (cleaner than during render)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlDriverId = params.get('driverId');
    
    // If no driverId in URL but we have one in localStorage, redirect to include it
    if (!urlDriverId && driverId) {
      window.location.href = `/driver-dashboard?driverId=${driverId}`;
    }
  }, [driverId]);
  
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [selectedThread, setSelectedThread] = useState<CommunicationThread | null>(null);
  const [selectedDocType, setSelectedDocType] = useState<string>('bol');
  const [isRecording, setIsRecording] = useState(false);
  const [showAISuggestions, setShowAISuggestions] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  
  // Smart document workflow state
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [pendingFilePreview, setPendingFilePreview] = useState<string | null>(null);
  const [editingDocument, setEditingDocument] = useState<LoadDocument | null>(null);
  const [showEditMenu, setShowEditMenu] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState<LoadDocument | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  
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
    enabled: !!driverId,
    queryFn: async () => {
      const response = await fetch(`/api/drivers/${driverId}`);
      if (!response.ok) throw new Error('Failed to fetch driver profile');
      return response.json() as Promise<Driver>;
    }
  });

  // Fetch current load
  const { data: currentLoad, refetch: refetchCurrentLoad } = useQuery({
    queryKey: ['/api/drivers', driverId, 'current-load'],
    enabled: !!driverId,
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
    enabled: !!driverId,
    queryFn: async () => {
      const response = await fetch(`/api/drivers/${driverId}/earnings`);
      if (!response.ok) throw new Error('Failed to fetch earnings');
      return response.json() as Promise<DriverEarnings>;
    }
  });

  // Fetch load history
  const { data: loadHistory = [] } = useQuery({
    queryKey: ['/api/drivers', driverId, 'load-history'],
    enabled: !!driverId,
    queryFn: async () => {
      const response = await fetch(`/api/drivers/${driverId}/load-history`);
      if (!response.ok) throw new Error('Failed to fetch load history');
      return response.json() as Promise<LoadWithRelations[]>;
    }
  });

  // Fetch communication threads
  const { data: threads = [] } = useQuery({
    queryKey: ['/api/communication/threads'],
    enabled: !!driverId,
    queryFn: async () => {
      const response = await fetch('/api/communication/threads');
      if (!response.ok) throw new Error('Failed to fetch threads');
      const allThreads = await response.json();
      return allThreads.filter((t: any) => t.driverId === driverId);
    },
    refetchInterval: 5000
  });

  // Fetch messages for selected thread
  const { data: messages = [] } = useQuery({
    queryKey: ['/api/communication/messages', selectedThread?.id],
    queryFn: async () => {
      if (!selectedThread?.id) return [];
      const response = await fetch(`/api/communication/messages/${selectedThread.id}`);
      if (!response.ok) throw new Error('Failed to fetch messages');
      return response.json();
    },
    enabled: !!selectedThread?.id,
    refetchInterval: 3000
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

  // Fetch driver's current GPS location (always track while logged in)
  const { data: driverLocation } = useQuery({
    queryKey: ['/api/drivers', driverId, 'current-location'],
    queryFn: async () => {
      const response = await fetch(`/api/drivers/${driverId}/current-location`);
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error('Failed to fetch driver location');
      }
      return response.json() as Promise<{ 
        latitude: number; 
        longitude: number; 
        address: string;
        hasLocation: boolean;
      }>;
    },
    enabled: !!driverId,
    refetchInterval: 6000
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
    onSuccess: (_, variables) => {
      setMessageInput('');
      setShowAISuggestions(false);
      setAiSuggestions([]);
      queryClient.invalidateQueries({ queryKey: ['/api/communication/threads'] });
      queryClient.invalidateQueries({ queryKey: ['/api/communication/messages', variables.threadId] });
      toast({
        title: 'Message Sent',
        description: 'Your message has been sent to dispatch.'
      });
    }
  });

  // AI message assistance mutation
  const getAISuggestionsMutation = useMutation({
    mutationFn: async ({ input, context }: { input: string; context?: string }) => {
      const res = await fetch('/api/ai/message-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input, context, driverId, loadId: currentLoad?.id })
      });
      if (!res.ok) throw new Error('Failed to get AI suggestions');
      return res.json();
    },
    onSuccess: (data) => {
      setAiSuggestions(data.suggestions || []);
      setShowAISuggestions(true);
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

  // Recategorize document mutation (change document type)
  const recategorizeDocumentMutation = useMutation({
    mutationFn: async ({ documentId, category }: { documentId: string; category: string }) => {
      if (!driverId) throw new Error('Driver ID not available');
      
      const res = await fetch(`/api/documents/${documentId}/recategorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, driverId })
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to recategorize document');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/loads', currentLoad?.id, 'documents'] });
      setEditingDocument(null);
      toast({
        title: 'Document Updated',
        description: 'Document type has been changed successfully.'
      });
    },
    onError: (error) => {
      toast({
        title: 'Update Failed',
        description: error instanceof Error ? error.message : 'Failed to update document',
        variant: 'destructive'
      });
    }
  });

  // Delete document mutation
  const deleteDocumentMutation = useMutation({
    mutationFn: async (documentId: string) => {
      if (!driverId) throw new Error('Driver ID not available');
      
      const res = await fetch(`/api/documents/${documentId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverId })
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to delete document');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/loads', currentLoad?.id, 'documents'] });
      setDocumentToDelete(null);
      setShowDeleteConfirm(false);
      toast({
        title: 'Document Deleted',
        description: 'Document has been removed successfully.'
      });
    },
    onError: (error) => {
      toast({
        title: 'Delete Failed',
        description: error instanceof Error ? error.message : 'Failed to delete document',
        variant: 'destructive'
      });
    }
  });

  // Helper function: Calculate distance from driver to address using backend endpoint
  const calculateDistanceToAddress = async (address: string): Promise<number | null> => {
    if (!driverLocation?.hasLocation || !address) return null;
    
    try {
      const response = await fetch('/api/calculate-distance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: driverLocation.latitude,
          lon: driverLocation.longitude,
          targetAddress: address
        })
      });
      
      if (!response.ok) {
        console.error('Distance calculation failed:', response.statusText);
        return null;
      }
      
      const data = await response.json();
      return data.distance;
    } catch (error) {
      console.error('Error calculating distance:', error);
      return null;
    }
  };

  const [isGPSActive, setIsGPSActive] = useState(false);
  const [trackingToken, setTrackingToken] = useState<string | null>(null);
  const gpsWatchId = useRef<number | null>(null);
  
  const handleStartGPSTracking = async () => {
    if (isGPSActive) {
      // Stop GPS tracking
      if (gpsWatchId.current !== null) {
        navigator.geolocation.clearWatch(gpsWatchId.current);
        gpsWatchId.current = null;
      }
      setIsGPSActive(false);
      toast({
        title: 'GPS Tracking Stopped',
        description: 'Location updates have been paused.'
      });
      return;
    }

    try {
      toast({
        title: 'Starting GPS Tracking',
        description: 'Requesting location permissions...'
      });

      // Generate tracking token
      const response = await fetch(`/api/drivers/${driverId}/generate-tracking-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) throw new Error('Failed to generate tracking token');
      const { token } = await response.json();
      setTrackingToken(token);

      // Request location permission and start tracking
      const watchId = navigator.geolocation.watchPosition(
        async (position) => {
          // Send location to backend
          try {
            await fetch('/api/driver-location/update', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                driverId,
                lat: position.coords.latitude,
                lon: position.coords.longitude,
                accuracy: position.coords.accuracy,
                altitude: position.coords.altitude,
                speed: position.coords.speed,
                heading: position.coords.heading,
                timestamp: new Date().toISOString(),
                trackingToken: token
              })
            });
            
            // Refresh location data
            queryClient.invalidateQueries({ queryKey: [`/api/drivers/${driverId}/current-location`] });
          } catch (error) {
            console.error('Failed to update GPS location:', error);
          }
        },
        (error) => {
          console.error('GPS error:', error);
          toast({
            title: 'Location Error',
            description: error.message || 'Failed to access your location.',
            variant: 'destructive'
          });
          setIsGPSActive(false);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      );

      gpsWatchId.current = watchId;
      setIsGPSActive(true);
      
      toast({
        title: 'GPS Tracking Active',
        description: 'Your location is now being tracked automatically.'
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to start GPS tracking. Please try again.',
        variant: 'destructive'
      });
    }
  };

  // Capture file first, then ask for document type
  const handleFileCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentLoad || !driverId) return;

    // Store file and create preview
    setPendingFile(file);
    
    // Create preview URL for image files
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPendingFilePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
    
    // Show type selection modal
    setShowTypeModal(true);
    
    // Reset file input for re-capture
    if (e.target) {
      e.target.value = '';
    }
  };

  // Upload after document type is selected
  const handleDocumentTypeSelected = (documentType: string) => {
    if (!pendingFile || !currentLoad) return;
    
    setShowTypeModal(false);
    
    uploadDocumentMutation.mutate({
      file: pendingFile,
      documentType,
      loadId: currentLoad.id
    });
    
    // Clear pending state
    setPendingFile(null);
    setPendingFilePreview(null);
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
    // Only start pull if we're at the top of the page
    if (window.scrollY === 0) {
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      pullStartY.current = clientY;
      setIsPulling(true);
    }
  };

  const handlePullMove = (e: React.TouchEvent | React.PointerEvent) => {
    if (!isPulling || isRefreshing) return;
    
    // Prevent default scrolling while pulling
    if (window.scrollY === 0) {
      e.preventDefault();
    }
    
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

  // GPS-Proximity-Aware Button for Assigned Status
  const GPSProximityButton = ({ currentLoad, driverLocation, calculateDistanceToAddress, updateLoadStatusMutation }: any) => {
    const [distance, setDistance] = useState<number | null>(null);
    const [isCalculating, setIsCalculating] = useState(false);
    const [calculationFailed, setCalculationFailed] = useState(false);

    useEffect(() => {
      const calcDistance = async () => {
        if (!driverLocation?.hasLocation || !currentLoad?.pickupAddress) {
          setDistance(null);
          return;
        }
        setIsCalculating(true);
        setCalculationFailed(false);
        
        // Set a 5-second timeout for distance calculation
        const timeoutId = setTimeout(() => {
          setIsCalculating(false);
          setCalculationFailed(true);
        }, 5000);
        
        try {
          const dist = await calculateDistanceToAddress(currentLoad.pickupAddress);
          clearTimeout(timeoutId);
          setDistance(dist);
          setIsCalculating(false);
          if (dist === null) {
            setCalculationFailed(true);
          }
        } catch (error) {
          clearTimeout(timeoutId);
          setIsCalculating(false);
          setCalculationFailed(true);
        }
      };
      calcDistance();
    }, [driverLocation, currentLoad?.pickupAddress]);

    const isNearPickup = distance !== null && distance < 0.5;

    // If calculation failed or timed out, show manual fallback button
    if (calculationFailed) {
      return (
        <Button
          onClick={() => updateLoadStatusMutation.mutate({ loadId: currentLoad.id, status: 'in_transit' })}
          className="w-full h-14 text-lg bg-blue-600 hover:bg-blue-700"
          data-testid="button-start-delivery"
        >
          <Navigation className="h-5 w-5 mr-2" />
          Start Delivery
        </Button>
      );
    }

    // Silently calculate distance in the background - show default button immediately
    if (isCalculating) {
      return (
        <Button
          onClick={() => updateLoadStatusMutation.mutate({ loadId: currentLoad.id, status: 'in_transit' })}
          className="w-full h-14 text-lg bg-blue-600 hover:bg-blue-700"
          data-testid="button-start-delivery"
        >
          <Navigation className="h-5 w-5 mr-2" />
          Start Delivery
        </Button>
      );
    }

    if (isNearPickup) {
      return (
        <Button
          onClick={() => updateLoadStatusMutation.mutate({ loadId: currentLoad.id, status: 'in_transit' })}
          className="w-full h-14 text-lg bg-green-600 hover:bg-green-700"
          data-testid="button-arrived-pickup"
        >
          <CheckCircle className="h-5 w-5 mr-2" />
          Arrived at Pickup
        </Button>
      );
    }

    return (
      <div className="space-y-2">
        <Button
          onClick={() => updateLoadStatusMutation.mutate({ loadId: currentLoad.id, status: 'in_transit' })}
          className="w-full h-14 text-lg bg-blue-600 hover:bg-blue-700"
          data-testid="button-en-route-pickup"
        >
          <Navigation className="h-5 w-5 mr-2" />
          En Route to Pickup
        </Button>
        {distance !== null && (
          <div className="text-xs text-center text-gray-500">
            {distance.toFixed(1)} miles from pickup
          </div>
        )}
      </div>
    );
  };

  // GPS-Proximity-Aware Button for In-Transit Status
  const GPSInTransitButton = ({ currentLoad, driverLocation, calculateDistanceToAddress, updateLoadStatusMutation }: any) => {
    const [distance, setDistance] = useState<number | null>(null);
    const [isCalculating, setIsCalculating] = useState(false);
    const [calculationFailed, setCalculationFailed] = useState(false);
    const [arrivedAtDelivery, setArrivedAtDelivery] = useState(false);

    useEffect(() => {
      const calcDistance = async () => {
        if (!driverLocation?.hasLocation || !currentLoad?.deliveryAddress) {
          setDistance(null);
          return;
        }
        setIsCalculating(true);
        setCalculationFailed(false);
        
        // Set a 5-second timeout for distance calculation
        const timeoutId = setTimeout(() => {
          setIsCalculating(false);
          setCalculationFailed(true);
        }, 5000);
        
        try {
          const dist = await calculateDistanceToAddress(currentLoad.deliveryAddress);
          clearTimeout(timeoutId);
          setDistance(dist);
          setIsCalculating(false);
          if (dist === null) {
            setCalculationFailed(true);
          }
        } catch (error) {
          clearTimeout(timeoutId);
          setIsCalculating(false);
          setCalculationFailed(true);
        }
      };
      calcDistance();
    }, [driverLocation, currentLoad?.deliveryAddress]);

    const isNearDelivery = distance !== null && distance < 0.5;

    // If calculation failed, show manual "Mark as Delivered" button as fallback
    if (calculationFailed) {
      return (
        <Button
          onClick={() => updateLoadStatusMutation.mutate({ loadId: currentLoad.id, status: 'delivered' })}
          className="w-full h-14 text-lg bg-emerald-600 hover:bg-emerald-700"
          data-testid="button-mark-delivered"
        >
          <CheckCircle className="h-5 w-5 mr-2" />
          Mark as Delivered
        </Button>
      );
    }

    // Silently calculate distance in the background without showing intrusive UI
    if (isCalculating) {
      return (
        <Button
          onClick={() => updateLoadStatusMutation.mutate({ loadId: currentLoad.id, status: 'delivered' })}
          className="w-full h-14 text-lg bg-emerald-600 hover:bg-emerald-700"
          data-testid="button-mark-delivered"
        >
          <CheckCircle className="h-5 w-5 mr-2" />
          Mark as Delivered
        </Button>
      );
    }

    // If near delivery and driver has clicked "Arrived at Delivery", show "Mark as Delivered" button
    if (isNearDelivery && arrivedAtDelivery) {
      return (
        <Button
          onClick={() => updateLoadStatusMutation.mutate({ loadId: currentLoad.id, status: 'delivered' })}
          className="w-full h-14 text-lg bg-emerald-600 hover:bg-emerald-700"
          data-testid="button-mark-delivered"
        >
          <CheckCircle className="h-5 w-5 mr-2" />
          Mark as Delivered
        </Button>
      );
    }

    // If near delivery but hasn't clicked "Arrived", show "Arrived at Delivery" button
    if (isNearDelivery && !arrivedAtDelivery) {
      return (
        <Button
          onClick={() => setArrivedAtDelivery(true)}
          className="w-full h-14 text-lg bg-green-600 hover:bg-green-700"
          data-testid="button-arrived-delivery"
        >
          <MapPin className="h-5 w-5 mr-2" />
          Arrived at Delivery
        </Button>
      );
    }

    // If not near delivery, show "In Transit" indicator
    return (
      <div className="w-full py-3 px-4 bg-orange-100 rounded-xl text-center">
        <div className="flex items-center justify-center gap-2 text-orange-800">
          <Truck className="h-5 w-5" />
          <span className="font-semibold">In Transit</span>
        </div>
        {distance !== null && (
          <div className="text-xs text-orange-600 mt-1">
            {distance.toFixed(1)} miles from delivery
          </div>
        )}
      </div>
    );
  };

  // Compute first name with useMemo to properly track driver dependency
  const firstName = useMemo(() => {
    if (!driver) {
      return 'Driver'; // Data still loading
    }
    if (!driver.name || driver.name.trim().length === 0) {
      return 'Driver'; // No name available
    }
    const nameParts = driver.name.trim().split(/\s+/);
    const extractedFirstName = nameParts[0];
    return extractedFirstName && extractedFirstName.length > 0 ? extractedFirstName : 'Driver';
  }, [driver]);

  // PWA Install Banner Component
  const PWAInstallBanner = () => {
    const [showBanner, setShowBanner] = useState(false);
    const [isIOS, setIsIOS] = useState(false);
    const [isAndroid, setIsAndroid] = useState(false);

    useEffect(() => {
      // Check if already installed (standalone mode)
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                          (window.navigator as any).standalone === true;
      
      // Check if banner was dismissed
      const wasDismissed = localStorage.getItem('pwa-banner-dismissed') === 'true';
      
      // Detect platform
      const userAgent = window.navigator.userAgent.toLowerCase();
      const iOS = /iphone|ipad|ipod/.test(userAgent);
      const android = /android/.test(userAgent);
      
      setIsIOS(iOS);
      setIsAndroid(android);
      
      // Show banner if not installed and not dismissed
      if (!isStandalone && !wasDismissed && (iOS || android)) {
        setShowBanner(true);
      }
    }, []);

    const handleDismiss = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('🚫 PWA banner dismissed');
      try {
        localStorage.setItem('pwa-banner-dismissed', 'true');
        console.log('✅ localStorage set:', localStorage.getItem('pwa-banner-dismissed'));
      } catch (error) {
        console.error('❌ Failed to set localStorage:', error);
      }
      setShowBanner(false);
    };

    if (!showBanner) return null;

    return (
      <div className="mx-4 mb-4 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-2xl p-4 shadow-lg relative" data-testid="pwa-install-banner">
        <button
          type="button"
          onClick={handleDismiss}
          className="absolute top-2 right-2 text-white/80 hover:text-white p-2 rounded-full hover:bg-white/20 transition-colors z-10 cursor-pointer"
          data-testid="button-dismiss-pwa-banner"
          aria-label="Dismiss install banner"
          style={{ pointerEvents: 'auto' }}
        >
          <X className="h-5 w-5" style={{ pointerEvents: 'none' }} />
        </button>
        
        <div className="pr-6">
          <div className="flex items-center gap-2 mb-2">
            <Download className="h-5 w-5" />
            <h3 className="font-bold text-lg">Install TRAQ IQ App</h3>
          </div>
          
          <p className="text-sm text-white/90 mb-3">
            Add this app to your home screen for quick access and a better experience!
          </p>
          
          {isIOS && (
            <div className="bg-white/20 rounded-xl p-3 text-sm space-y-1.5">
              <p className="font-semibold mb-1">📱 For iPhone/iPad (Safari only):</p>
              <p>1. Open this page in <strong>Safari browser</strong></p>
              <p>2. Tap the <strong>Share</strong> button <span className="inline-block">□↑</span> at the bottom</p>
              <p>3. Scroll down and tap <strong>"Add to Home Screen"</strong></p>
              <p>4. Tap <strong>"Add"</strong> in the top right corner</p>
            </div>
          )}
          
          {isAndroid && (
            <div className="bg-white/20 rounded-xl p-3 text-sm space-y-1.5">
              <p className="font-semibold mb-1">📱 For Android (Chrome recommended):</p>
              <p>1. Look for <strong>"Install app"</strong> popup at the bottom</p>
              <p className="text-xs text-white/80 ml-4">OR if no popup:</p>
              <p>2. Tap the <strong>menu (⋮)</strong> at the top right</p>
              <p>3. Tap <strong>"Add to Home screen"</strong> or <strong>"Install app"</strong></p>
              <p>4. Tap <strong>"Install"</strong> to confirm</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  // HOME TAB
  const HomeTab = () => {
    return (
    <div className="space-y-4 pb-24">
      {/* Welcome Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-6 rounded-b-3xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-welcome-header">Hello, {firstName} 👋</h1>
            <p className="text-blue-100 text-sm">Let's have a great day!</p>
          </div>
          <button 
            onClick={() => setShowMenu(!showMenu)}
            className="bg-white/20 hover:bg-white/30 active:bg-white/40 rounded-full h-14 w-14 p-0 flex items-center justify-center transition-all active:scale-95 touch-manipulation"
            data-testid="button-menu"
            aria-label="Open menu"
          >
            <Menu className="h-6 w-6" />
          </button>
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

      {/* PWA Install Banner */}
      <PWAInstallBanner />

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
                <div className="text-xs text-gray-600 mb-1">Your Pay</div>
                <div className="text-2xl font-bold text-blue-600" data-testid="text-current-pay">
                  {(() => {
                    const rate = Number(currentLoad.rate) || 0;
                    const driverPay = rate * 0.9;
                    return formatCurrency(driverPay);
                  })()}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-600 mb-1">Distance</div>
                <div className="text-2xl font-bold text-gray-900" data-testid="text-current-distance">
                  {(() => {
                    const miles = Number(currentLoad.miles) || 0;
                    return `${miles.toFixed(0)} mi`;
                  })()}
                </div>
              </div>
            </div>

            {/* GPS-Proximity-Aware Action Buttons */}
            <div className="space-y-2">
              {currentLoad.status === 'assigned' && (
                <GPSProximityButton
                  currentLoad={currentLoad}
                  driverLocation={driverLocation}
                  calculateDistanceToAddress={calculateDistanceToAddress}
                  updateLoadStatusMutation={updateLoadStatusMutation}
                />
              )}

              {currentLoad.status === 'in_transit' && (
                <GPSInTransitButton
                  currentLoad={currentLoad}
                  driverLocation={driverLocation}
                  calculateDistanceToAddress={calculateDistanceToAddress}
                  updateLoadStatusMutation={updateLoadStatusMutation}
                />
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
                variant={isGPSActive ? "default" : "outline"}
                onClick={handleStartGPSTracking}
                className={cn(
                  "w-full h-12",
                  isGPSActive && "bg-green-600 hover:bg-green-700 text-white"
                )}
                data-testid="button-gps-tracking"
              >
                {isGPSActive ? (
                  <>
                    <Zap className="h-4 w-4 mr-2 animate-pulse" />
                    GPS Active - Tap to Stop
                  </>
                ) : (
                  <>
                    <MapPin className="h-4 w-4 mr-2" />
                    Enable GPS Tracking
                  </>
                )}
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
  };

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
                        <div className="font-bold text-green-600" data-testid={`text-load-pay-${load.id}`}>
                          {(() => {
                            const rate = Number(load.rate) || 0;
                            const driverPay = rate * 0.9;
                            return formatCurrency(driverPay);
                          })()}
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
    <div className="flex flex-col min-h-screen">
      {!selectedThread ? (
        <div className="space-y-2 p-4">
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
                  handleSwipeStart(e, thread.id);
                }}
                onPointerMove={(e) => {
                  handleSwipeMove(e);
                }}
                onPointerUp={(e) => {
                  // If swiped open, trigger the action
                  if (swipedItemId === thread.id && swipeDistance > 60) {
                    handleMarkAsRead(thread.id);
                    handleSwipeEnd();
                  } else if (swipeDistance < 10) {
                    // Small movement = click
                    closeSwipe();
                    setSelectedThread(thread);
                  } else {
                    // Large movement but not enough for action
                    handleSwipeEnd();
                  }
                }}
                onPointerCancel={(e) => {
                  handleSwipeEnd();
                }}
              >
                <Card
                  className="cursor-pointer hover:bg-gray-50 transition-colors"
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
        <div className="flex flex-col h-screen">
          {/* Chat Header */}
          <div className="bg-blue-600 text-white p-4 flex items-center gap-3 shadow-lg flex-shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                closeSwipe();
                setSelectedThread(null);
              }}
              className="text-white hover:bg-white/20 p-2 rounded-full"
              data-testid="button-back-to-threads"
            >
              <ChevronRight className="h-5 w-5 rotate-180" />
            </Button>
            <div className="flex-1">
              <div className="font-semibold">Dispatch</div>
              <div className="text-xs text-blue-100">TRAQ IQ Team</div>
            </div>
            <Phone className="h-5 w-5" />
          </div>

          {/* Messages */}
          <div className="flex-1 p-4 space-y-3 bg-gray-50 overflow-y-auto">
            {messages.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <MessageSquare className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p>No messages yet. Start the conversation!</p>
              </div>
            ) : (
              messages.map((message: any) => (
                <div
                  key={message.id}
                  className={cn(
                    "flex",
                    message.senderRole === 'driver' ? "justify-end" : "justify-start"
                  )}
                  data-testid={`message-${message.id}`}
                >
                  <div
                    className={cn(
                      "max-w-[80%] rounded-2xl px-4 py-2",
                      message.senderRole === 'driver'
                        ? "bg-blue-600 text-white rounded-br-sm"
                        : "bg-white text-gray-900 rounded-bl-sm shadow"
                    )}
                  >
                    <div className="text-sm">{message.textContent || message.content}</div>
                    <div
                      className={cn(
                        "text-xs mt-1",
                        message.senderRole === 'driver' ? "text-blue-100" : "text-gray-500"
                      )}
                    >
                      {formatDate(message.createdAt)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Message Input Area - Sticky at Bottom */}
          <div className="flex-shrink-0 bg-white border-t border-gray-200">
            {/* AI Quick Suggestions Panel */}
            {showAISuggestions && aiSuggestions.length > 0 && (
              <div className="p-4 bg-gradient-to-r from-purple-50 to-blue-50 border-b border-purple-200">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-purple-600" />
                    <span className="text-sm font-semibold text-purple-900">AI Quick Messages</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAISuggestions(false)}
                    className="h-6 w-6 p-0"
                    data-testid="button-close-ai-suggestions"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="space-y-2">
                  {aiSuggestions.map((suggestion, index) => (
                    <Button
                      key={index}
                      variant="outline"
                      className="w-full text-left justify-start h-auto py-3 px-4 bg-white hover:bg-purple-50 border-purple-200 text-sm"
                      onClick={() => {
                        setMessageInput(suggestion);
                        setShowAISuggestions(false);
                      }}
                      data-testid={`button-ai-suggestion-${index}`}
                    >
                      {suggestion}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Message Input with AI and Microphone */}
            <div className="p-4 pb-20">
            {/* Quick Actions Row */}
            <div className="flex gap-2 mb-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const context = currentLoad ? `Current load: ${currentLoad.loadNumber} from ${currentLoad.pickupCity} to ${currentLoad.deliveryCity}` : '';
                  getAISuggestionsMutation.mutate({ 
                    input: messageInput.trim() || "I need quick message suggestions for a driver", 
                    context 
                  });
                }}
                disabled={getAISuggestionsMutation.isPending}
                className="flex-1 h-9 text-xs bg-gradient-to-r from-purple-50 to-blue-50 border-purple-200 text-purple-700 hover:from-purple-100 hover:to-blue-100"
                data-testid="button-ai-help"
              >
                <Zap className="h-3 w-3 mr-1" />
                {getAISuggestionsMutation.isPending ? 'Thinking...' : 'AI Help'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMessageInput("Arrived at pickup location")}
                className="flex-1 h-9 text-xs"
                data-testid="button-quick-arrived"
              >
                At Pickup
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMessageInput("Running 15 minutes late")}
                className="flex-1 h-9 text-xs"
                data-testid="button-quick-late"
              >
                Running Late
              </Button>
            </div>

            {/* Message Input Row */}
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center bg-gray-100 rounded-full px-4 py-2">
                <Input
                  type="text"
                  placeholder="Type a message or use AI help..."
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
                disabled={!messageInput.trim() || sendMessageMutation.isPending}
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

  // DOCUMENTS TAB - Smart Document Management
  const DocumentsTab = () => (
    <div className="space-y-4 pb-24">
      <div className="p-4">
        <h2 className="text-xl font-bold mb-4">Documents</h2>

        {/* Smart Camera Upload - Capture First Workflow */}
        {currentLoad && (
          <Card className="mb-4 border-2 border-dashed border-teal-300 bg-teal-50">
            <CardContent className="p-6 text-center">
              <Camera className="h-12 w-12 mx-auto mb-3 text-teal-600" />
              <h3 className="font-semibold mb-2">Upload Document</h3>
              <p className="text-sm text-gray-600 mb-4">
                Take a photo or select from gallery
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                capture="environment"
                onChange={handleFileCapture}
                className="hidden"
              />

              <div className="grid grid-cols-2 gap-2">
                <Button
                  onClick={() => {
                    if (fileInputRef.current) {
                      fileInputRef.current.setAttribute('capture', 'environment');
                      fileInputRef.current.click();
                    }
                  }}
                  className="h-12 bg-teal-600 hover:bg-teal-700"
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
                  className="h-12 border-teal-300 text-teal-700 hover:bg-teal-50"
                  data-testid="button-choose-file"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Choose File
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Smart Document Gallery with Edit/Delete */}
        <div>
          <h3 className="font-semibold mb-3">Uploaded Documents</h3>
          <div className="grid grid-cols-2 gap-3">
            {documents.length > 0 ? (
              documents.map((doc) => (
                <Card key={doc.id} className="overflow-hidden relative group">
                  <div className="aspect-video bg-gray-100 flex items-center justify-center relative">
                    {doc.fileUrl && doc.mimeType?.startsWith('image/') ? (
                      <img 
                        src={doc.fileUrl} 
                        alt={doc.documentType}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <FileText className="h-8 w-8 text-gray-400" />
                    )}
                    
                    {/* Edit Menu Button */}
                    <div className="absolute top-2 right-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-8 w-8 p-0 rounded-full bg-white/90 hover:bg-white shadow"
                            data-testid={`button-edit-${doc.id}`}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => setEditingDocument(doc)}
                            data-testid={`menu-change-type-${doc.id}`}
                          >
                            <Edit2 className="h-4 w-4 mr-2" />
                            Change Type
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              setDocumentToDelete(doc);
                              setShowDeleteConfirm(true);
                            }}
                            className="text-red-600"
                            data-testid={`menu-delete-${doc.id}`}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
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
                      data-testid={`badge-status-${doc.id}`}
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
                <p className="text-sm text-gray-400 mt-2">
                  Take a photo to get started
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Document Type Selection Modal - Appears after photo capture */}
      <Dialog open={showTypeModal} onOpenChange={setShowTypeModal}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-select-type">
          <DialogHeader>
            <DialogTitle>What type of document is this?</DialogTitle>
            <DialogDescription>
              Select the document type to categorize your upload
            </DialogDescription>
          </DialogHeader>
          
          {pendingFilePreview && (
            <div className="mt-4 mb-4">
              <img 
                src={pendingFilePreview} 
                alt="Preview" 
                className="w-full h-48 object-cover rounded-lg border-2 border-gray-200"
              />
            </div>
          )}
          
          <div className="grid grid-cols-1 gap-2">
            <Button
              onClick={() => handleDocumentTypeSelected('bol')}
              className="h-14 text-base justify-start"
              variant="outline"
              data-testid="button-type-bol"
            >
              <FileCheck className="h-5 w-5 mr-3" />
              BOL (Bill of Lading)
            </Button>
            <Button
              onClick={() => handleDocumentTypeSelected('pod')}
              className="h-14 text-base justify-start"
              variant="outline"
              data-testid="button-type-pod"
            >
              <Check className="h-5 w-5 mr-3" />
              POD (Proof of Delivery)
            </Button>
            <Button
              onClick={() => handleDocumentTypeSelected('weight_ticket')}
              className="h-14 text-base justify-start"
              variant="outline"
              data-testid="button-type-weight"
            >
              <FileText className="h-5 w-5 mr-3" />
              Weight Ticket
            </Button>
          </div>
          
          <DialogFooter className="sm:justify-start">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowTypeModal(false);
                setPendingFile(null);
                setPendingFilePreview(null);
              }}
              data-testid="button-cancel-upload"
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Document Type Modal */}
      <Dialog open={!!editingDocument} onOpenChange={(open) => !open && setEditingDocument(null)}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-edit-document">
          <DialogHeader>
            <DialogTitle>Change Document Type</DialogTitle>
            <DialogDescription>
              Select the correct document type for this file
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid grid-cols-1 gap-2 mt-4">
            <Button
              onClick={() => recategorizeDocumentMutation.mutate({ 
                documentId: editingDocument!.id, 
                category: 'bol' 
              })}
              variant="outline"
              className="h-12 justify-start"
              data-testid="button-edit-type-bol"
            >
              <FileCheck className="h-5 w-5 mr-3" />
              BOL (Bill of Lading)
            </Button>
            <Button
              onClick={() => recategorizeDocumentMutation.mutate({ 
                documentId: editingDocument!.id, 
                category: 'pod' 
              })}
              variant="outline"
              className="h-12 justify-start"
              data-testid="button-edit-type-pod"
            >
              <Check className="h-5 w-5 mr-3" />
              POD (Proof of Delivery)
            </Button>
            <Button
              onClick={() => recategorizeDocumentMutation.mutate({ 
                documentId: editingDocument!.id, 
                category: 'weight_ticket' 
              })}
              variant="outline"
              className="h-12 justify-start"
              data-testid="button-edit-type-weight"
            >
              <FileText className="h-5 w-5 mr-3" />
              Weight Ticket
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent data-testid="dialog-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this {documentToDelete?.documentType.replace('_', ' ')} document? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => documentToDelete && deleteDocumentMutation.mutate(documentToDelete.id)}
              className="bg-red-600 hover:bg-red-700"
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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

      {/* Slide-out Menu */}
      {showMenu && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 z-40"
            onClick={() => setShowMenu(false)}
            data-testid="menu-backdrop"
          />
          
          {/* Menu Panel */}
          <div className="fixed top-0 right-0 h-full w-80 max-w-[90vw] bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-in-out animate-in slide-in-from-right">
            {/* Menu Header */}
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold">Menu</h2>
                <button
                  onClick={() => setShowMenu(false)}
                  className="text-white hover:bg-white/20 active:bg-white/30 rounded-full h-12 w-12 p-0 flex items-center justify-center transition-all active:scale-95 touch-manipulation"
                  data-testid="button-close-menu"
                  aria-label="Close menu"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>
              
              {/* Driver Profile Info */}
              <div className="flex items-center gap-3 bg-white/10 backdrop-blur-sm rounded-xl p-4">
                <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center">
                  <User className="h-6 w-6" />
                </div>
                <div>
                  <div className="font-semibold">{driver?.name || 'Driver'}</div>
                  <div className="text-xs text-blue-100">
                    {driver?.status === 'on_route' ? '🚚 On Route' : '✅ Available'}
                  </div>
                </div>
              </div>
            </div>

            {/* Menu Items */}
            <div className="p-4 space-y-2">
              <button
                className="w-full flex items-center gap-3 p-4 rounded-xl hover:bg-gray-100 active:bg-gray-200 transition-colors touch-manipulation"
                onClick={() => {
                  setShowMenu(false);
                  setActiveTab('profile');
                }}
                data-testid="menu-item-profile"
              >
                <User className="h-5 w-5 text-gray-600" />
                <span className="font-medium text-gray-900">Profile Settings</span>
              </button>

              <button
                className="w-full flex items-center gap-3 p-4 rounded-xl hover:bg-gray-100 active:bg-gray-200 transition-colors touch-manipulation"
                onClick={() => {
                  setShowMenu(false);
                  toast({
                    title: 'Help & Support',
                    description: 'For assistance, please contact dispatch using the options below.'
                  });
                }}
                data-testid="menu-item-help"
              >
                <HelpCircle className="h-5 w-5 text-gray-600" />
                <span className="font-medium text-gray-900">Help & Support</span>
              </button>

              <div className="border-t border-gray-200 my-2" />

              <div className="px-2 py-1">
                <div className="text-xs text-gray-500 font-semibold mb-2">Contact Dispatch</div>
                <div className="flex gap-2">
                  <button
                    className="flex-1 flex flex-col items-center gap-2 p-4 rounded-xl bg-blue-50 hover:bg-blue-100 active:bg-blue-200 transition-colors touch-manipulation"
                    onClick={() => {
                      setShowMenu(false);
                      const dispatchPhone = process.env.DISPATCH_PHONE || '+1-800-555-0100';
                      window.location.href = `tel:${dispatchPhone}`;
                    }}
                    data-testid="menu-item-call-dispatch"
                  >
                    <Phone className="h-5 w-5 text-blue-600" />
                    <span className="text-xs font-medium text-blue-700">Call</span>
                  </button>
                  <button
                    className="flex-1 flex flex-col items-center gap-2 p-4 rounded-xl bg-green-50 hover:bg-green-100 active:bg-green-200 transition-colors touch-manipulation"
                    onClick={() => {
                      setShowMenu(false);
                      const dispatchPhone = process.env.DISPATCH_PHONE || '+1-800-555-0100';
                      window.location.href = `sms:${dispatchPhone}`;
                    }}
                    data-testid="menu-item-sms-dispatch"
                  >
                    <MessageSquare className="h-5 w-5 text-green-600" />
                    <span className="text-xs font-medium text-green-700">SMS</span>
                  </button>
                </div>
              </div>

              <div className="border-t border-gray-200 my-2" />

              <button
                className="w-full flex items-center gap-3 p-4 rounded-xl hover:bg-red-50 active:bg-red-100 transition-colors text-red-600 touch-manipulation"
                onClick={() => {
                  setShowMenu(false);
                  toast({
                    title: 'Logged Out',
                    description: 'You have been logged out successfully',
                  });
                  setTimeout(() => {
                    localStorage.removeItem('load-signal-driver-id');
                    window.location.href = '/';
                  }, 1000);
                }}
                data-testid="menu-item-logout"
              >
                <LogOut className="h-5 w-5" />
                <span className="font-medium">Logout</span>
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );

  // Show driver selector if no driverId is available
  if (!driverId) {
    return <DriverSelector />;
  }
  
  // Driver Selector Component for Development/Testing
  function DriverSelector() {
    const { data: allDrivers, isLoading } = useQuery({
      queryKey: ['/api/drivers'],
      enabled: true
    });

    const handleSelectDriver = (selectedDriverId: string) => {
      localStorage.setItem('load-signal-driver-id', selectedDriverId);
      window.location.href = `/driver-dashboard?driverId=${selectedDriverId}`;
    };

    if (isLoading) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <RefreshCw className="h-8 w-8 animate-spin mx-auto text-blue-600 mb-2" />
            <p className="text-gray-600">Loading drivers...</p>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-2xl mx-auto">
          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="text-center">Select Driver</CardTitle>
              <CardDescription className="text-center">
                Choose a driver to access their dashboard
              </CardDescription>
            </CardHeader>
          </Card>

          <div className="space-y-2">
            {allDrivers && allDrivers.length > 0 ? (
              allDrivers.map((driver: any) => (
                <Card 
                  key={driver.id}
                  className="cursor-pointer hover:shadow-lg transition-shadow active:scale-95"
                  onClick={() => handleSelectDriver(driver.id)}
                  data-testid={`driver-select-${driver.id}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="bg-blue-100 rounded-full p-3">
                          <User className="h-6 w-6 text-blue-600" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-lg">{driver.name}</h3>
                          <p className="text-sm text-gray-600">{driver.phone}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant={driver.status === 'available' ? 'default' : 'secondary'}>
                              {driver.status}
                            </Badge>
                            <span className="text-xs text-gray-500">
                              {driver.completedLoads || 0} loads
                            </span>
                          </div>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-gray-400" />
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : (
              <Card>
                <CardContent className="p-8 text-center">
                  <AlertCircle className="h-12 w-12 mx-auto text-gray-400 mb-3" />
                  <p className="text-gray-600">No drivers found</p>
                  <p className="text-sm text-gray-500 mt-2">
                    Please create a driver first from the Driver Management page
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Content with Pull-to-Refresh */}
      <div 
        ref={pullContainerRef}
        className="max-w-2xl mx-auto pb-24"
        onTouchStart={handlePullStart}
        onTouchMove={handlePullMove}
        onTouchEnd={handlePullEnd}
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
