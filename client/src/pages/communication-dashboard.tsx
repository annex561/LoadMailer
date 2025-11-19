import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { 
  MessageSquare, 
  MessageCircle,
  Send, 
  Phone, 
  Mail, 
  MapPin, 
  Clock, 
  Truck, 
  User, 
  Search,
  RefreshCw,
  CheckCircle,
  Circle,
  AlertCircle,
  Camera,
  Paperclip,
  Mic,
  MoreVertical,
  Brain,
  Lightbulb,
  Zap,
  ThumbsUp,
  ThumbsDown,
  Settings,
  Sparkles,
  TrendingUp,
  Target,
  UserPlus,
  AlertTriangle,
  X,
  Upload,
  FileText,
  Image,
  File,
  Download,
  Eye,
  Check,
  XCircle,
  Package
} from "lucide-react";
import { format } from "date-fns";
import { Radio } from "lucide-react";

// Types
interface LoadCommunicationThread {
  id: string;
  threadType?: 'unified' | 'general' | 'load'; // Support legacy types during migration
  loadId?: string;
  driverId: string;
  driverName: string;
  driverPhone?: string;
  loadNumber?: string;
  loadOrigin?: string;
  loadDestination?: string;
  status: 'active' | 'closed' | 'archived';
  messageCount: number;
  unreadDriverMessages: number;
  unreadDispatchMessages: number;
  lastMessageAt: string;
  lastMessageText?: string;
  lastMessageSender?: 'driver' | 'dispatch';
  assistantEnabled?: boolean;
  assistantMode?: 'suggest' | 'autosend' | 'off';
  loadOfferStatus?: 'pending' | 'accepted' | 'declined' | 'expired';
  loadOfferId?: string;
  createdAt: string;
  updatedAt: string;
}

interface Driver {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  status: string;
  equipmentType?: string;
  currentMood?: string;
}

interface LoadMessage {
  id: string;
  threadId: string;
  content: string;
  sender: 'driver' | 'dispatch';
  isRead: boolean;
  isSuggested?: boolean;
  isSent?: boolean;
  approvedBy?: string;
  approvedAt?: string;
  mediaUrl?: string;
  mediaType?: string;
  createdAt: string;
}

interface QuickReplyTemplate {
  id: string;
  templateKey: string;
  displayText: string;
  messageTemplate: string;
  category: string;
  order: number;
  isActive: boolean;
  isForDriver: boolean;
  isForDispatch: boolean;
}

interface AiMessageSuggestion {
  id: string;
  threadId: string;
  suggestedText: string;
  confidence: number;
  reasoning: string;
  messageType: string;
  tone: string;
  autoSend: boolean;
  createdAt: string;
}

interface AiThreadSettings {
  assistantEnabled: boolean;
  assistantMode: 'suggest' | 'autosend' | 'off';
  autoSendConfidence: number;
  systemPrompt?: string;
}

interface ConversationInsight {
  sentiment: string;
  urgency: string;
  nextAction: string;
  estimatedResponseTime: string;
  driverMood: string;
}

interface MessageAttachment {
  id: string;
  messageId?: string;
  loadId: string;
  driverId?: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  fileType: string;
  documentCategory: 'pod' | 'bol' | 'inspection_report' | 'damage_photos' | 'weight_ticket' | 'lumper_receipt' | 'other';
  documentDescription?: string;
  documentStatus: 'pending_review' | 'approved' | 'rejected';
  uploadedBy: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
  createdAt: string;
}

interface UnassignedLoad {
  id: string;
  loadNumber: string;
  pickupAddress: string;
  deliveryAddress: string;
  status: string;
  rate?: number;
  miles?: number;
  equipmentType: string;
  priority: string;
  createdAt: string;
}

interface Driver {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  status: 'available' | 'on_route' | 'unavailable';
  equipmentType: string;
}

export default function CommunicationDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const [selectedThread, setSelectedThread] = useState<LoadCommunicationThread | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [showAiPanel, setShowAiPanel] = useState(true);
  const [aiComposing, setAiComposing] = useState(false);
  const [showAiSettings, setShowAiSettings] = useState(false);
  const [showUnassignedLoads, setShowUnassignedLoads] = useState(false);
  const [selectedLoadForAssignment, setSelectedLoadForAssignment] = useState<UnassignedLoad | null>(null);
  const [activeTab, setActiveTab] = useState<'general' | 'loads'>('general');
  const [loadSearchQuery, setLoadSearchQuery] = useState("");
  const [showDriverDropdown, setShowDriverDropdown] = useState(false);
  
  // Document upload states
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [documentCategory, setDocumentCategory] = useState<MessageAttachment['documentCategory']>('other');
  const [documentDescription, setDocumentDescription] = useState('');
  const [showDocumentGallery, setShowDocumentGallery] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Track previous threads for notification detection
  const previousThreadsRef = useRef<LoadCommunicationThread[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const isAudioUnlockedRef = useRef(false);
  
  // Initialize audio context on first user interaction
  useEffect(() => {
    const unlockAudio = async () => {
      if (isAudioUnlockedRef.current) return;
      
      try {
        // Create AudioContext if not exists
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        
        // Resume the AudioContext (required for autoplay policy)
        if (audioContextRef.current.state === 'suspended') {
          await audioContextRef.current.resume();
        }
        
        isAudioUnlockedRef.current = true;
        console.log('🔊 Audio notifications enabled');
      } catch (error) {
        console.error('Failed to unlock audio:', error);
      }
    };
    
    // Unlock audio on any user interaction
    const events = ['click', 'touchstart', 'keydown'];
    events.forEach(event => {
      document.addEventListener(event, unlockAudio, { once: true });
    });
    
    return () => {
      events.forEach(event => {
        document.removeEventListener(event, unlockAudio);
      });
    };
  }, []);
  
  // Fetch communication threads
  const { data: threads = [], isLoading: threadsLoading, refetch: refetchThreads, error: threadsError } = useQuery<LoadCommunicationThread[]>({
    queryKey: ['/api/communication/threads'],
    refetchInterval: 2000, // Refresh every 2 seconds for real-time updates
  });
  
  // Debug logging for threads query
  useEffect(() => {
    console.log('🔍 Threads Query State:', {
      threadsCount: threads.length,
      isLoading: threadsLoading,
      hasError: !!threadsError,
      error: threadsError
    });
    if (threads.length > 0) {
      console.log('🔍 First thread:', threads[0]);
    }
  }, [threads, threadsLoading, threadsError]);
  
  // Monitor for new messages and play notification sound
  useEffect(() => {
    if (!threads || threads.length === 0) {
      previousThreadsRef.current = threads;
      return;
    }
    
    const previousThreads = previousThreadsRef.current;
    
    // Only check if we have previous data (skip first load)
    if (previousThreads.length > 0) {
      let hasNewMessages = false;
      
      // Check each thread for new messages
      threads.forEach(currentThread => {
        const previousThread = previousThreads.find(t => t.id === currentThread.id);
        
        if (previousThread) {
          // Check if there are new unread dispatch messages
          if (currentThread.unreadDispatchMessages > previousThread.unreadDispatchMessages) {
            hasNewMessages = true;
            console.log(`🔔 New message from ${currentThread.driverName}`);
          }
        } else {
          // New thread appeared (new conversation started)
          if (currentThread.unreadDispatchMessages > 0) {
            hasNewMessages = true;
            console.log(`🔔 New conversation with ${currentThread.driverName}`);
          }
        }
      });
      
      // Play notification sound if there are new messages
      if (hasNewMessages && isAudioUnlockedRef.current && audioContextRef.current) {
        try {
          const context = audioContextRef.current;
          const oscillator = context.createOscillator();
          const gainNode = context.createGain();
          
          oscillator.connect(gainNode);
          gainNode.connect(context.destination);
          
          oscillator.frequency.value = 800; // Frequency in Hz
          gainNode.gain.setValueAtTime(0.3, context.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.5);
          
          oscillator.start(context.currentTime);
          oscillator.stop(context.currentTime + 0.5);
        } catch (error) {
          console.error('Failed to play notification sound:', error);
        }
      }
    }
    
    // Update the reference with current threads
    previousThreadsRef.current = threads;
  }, [threads]);

  // Fetch all drivers for search
  const { data: allDrivers = [], isLoading: driversLoading } = useQuery<Driver[]>({
    queryKey: ['/api/drivers'],
  });
  
  // Filter drivers based on search term (focusing on first name)
  const filteredDrivers = useMemo(() => {
    if (!searchTerm) return [];
    
    const query = searchTerm.toLowerCase();
    return allDrivers.filter(driver => {
      // Primary focus on first name
      const firstName = driver.name.split(' ')[0].toLowerCase();
      if (firstName.includes(query)) return true;
      
      // Also check full name
      return driver.name.toLowerCase().includes(query);
    });
  }, [allDrivers, searchTerm]);

  // Start general conversation with driver
  const startGeneralChatMutation = useMutation({
    mutationFn: async (driverId: string) => {
      const response = await fetch('/api/communication/general-thread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverId })
      });
      if (!response.ok) throw new Error('Failed to start conversation');
      return response.json();
    },
    onSuccess: (thread) => {
      setSelectedThread(thread);
      setSearchTerm("");
      setShowDriverDropdown(false);
      refetchThreads();
      toast({ title: "Conversation started", description: `You can now chat with ${thread.driverName}` });
    },
    onError: (error) => {
      toast({ title: "Failed to start conversation", description: error.message, variant: "destructive" });
    }
  });

  // Offer load to driver in general conversation
  const offerLoadMutation = useMutation({
    mutationFn: async ({ threadId, loadId }: { threadId: string; loadId: string }) => {
      const response = await fetch('/api/communication/offer-load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId, loadId })
      });
      if (!response.ok) throw new Error('Failed to offer load');
      return response.json();
    },
    onSuccess: () => {
      refetchThreads();
      refetchMessages();
      setShowUnassignedLoads(false);
      toast({ title: "Load offered", description: "Load has been offered to the driver" });
    },
    onError: (error) => {
      toast({ title: "Failed to offer load", description: error.message, variant: "destructive" });
    }
  });

  // Accept load offer in general conversation
  const acceptLoadOfferMutation = useMutation({
    mutationFn: async (threadId: string) => {
      const response = await fetch('/api/communication/accept-load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId })
      });
      if (!response.ok) throw new Error('Failed to accept load offer');
      return response.json();
    },
    onSuccess: () => {
      refetchThreads();
      refetchMessages();
      toast({ title: "Load accepted", description: "Load has been attached to this conversation" });
    },
    onError: (error) => {
      toast({ title: "Failed to accept load", description: error.message, variant: "destructive" });
    }
  });

  // Decline load offer in general conversation
  const declineLoadOfferMutation = useMutation({
    mutationFn: async (threadId: string) => {
      const response = await fetch('/api/communication/decline-load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId })
      });
      if (!response.ok) throw new Error('Failed to decline load offer');
      return response.json();
    },
    onSuccess: () => {
      refetchThreads();
      refetchMessages();
      toast({ title: "Load declined", description: "You can offer a different load to this driver" });
    },
    onError: (error) => {
      toast({ title: "Failed to decline load", description: error.message, variant: "destructive" });
    }
  });

  // Debug logging
  useEffect(() => {
    console.log('🔍 Communication Dashboard - Threads data:', threads);
    console.log('🔍 Communication Dashboard - Threads count:', threads.length);
    console.log('🔍 Communication Dashboard - Search term:', searchTerm);
    console.log('🔍 Communication Dashboard - Filter status:', filterStatus);
    if (threads.length > 0) {
      console.log('🔍 Communication Dashboard - First thread:', threads[0]);
    }
  }, [threads, searchTerm, filterStatus]);

  // Fetch messages for selected thread
  const { data: rawMessages = [], isLoading: messagesLoading, refetch: refetchMessages } = useQuery<any[]>({
    queryKey: ['/api/communication/messages', selectedThread?.id],
    queryFn: async () => {
      if (!selectedThread?.id) return [];
      const response = await fetch(`/api/communication/messages/${selectedThread.id}`);
      if (!response.ok) throw new Error('Failed to fetch messages');
      return response.json();
    },
    enabled: !!selectedThread?.id,
    refetchInterval: 2000, // Refresh every 2 seconds for real-time chat
  });

  // Transform API response to frontend format
  const messages: LoadMessage[] = rawMessages.map(msg => ({
    id: msg.id,
    threadId: msg.threadId,
    content: msg.textContent, // ✅ Map textContent to content
    sender: msg.senderRole, // ✅ Map senderRole to sender  
    isRead: msg.isRead,
    isSuggested: msg.isSuggested,
    isSent: msg.isSent,
    approvedBy: msg.approvedBy,
    approvedAt: msg.approvedAt,
    mediaUrl: msg.mediaUrl,
    mediaType: msg.mediaType,
    createdAt: msg.createdAt
  }));

  // Fetch quick reply templates
  const { data: templates = [] } = useQuery<QuickReplyTemplate[]>({
    queryKey: ['/api/communication/quick-replies'],
    queryFn: async () => {
      const response = await fetch('/api/communication/quick-replies?role=dispatch');
      if (!response.ok) {
        console.warn('Quick replies endpoint failed, using fallback empty array');
        return []; // Return empty array if endpoint fails
      }
      const data = await response.json();
      return data.templates || data; // Handle both response formats
    },
  });

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async ({ threadId, content }: { threadId: string; content: string }) => {
      const response = await fetch(`/api/communication/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId, content, sender: 'dispatch' })
      });
      
      const data = await response.json();
      
      // Check if response indicates partial success (SMS failed but Zello might work)
      if (response.status === 409 && data.error) {
        // Show warning instead of error for partial failures
        toast({ 
          title: "⚠️ Limited Delivery", 
          description: "Message saved but couldn't be sent to driver. Zello channels may need configuration.",
          variant: "default" 
        });
        return data; // Still return data to update UI
      }
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to send message');
      }
      
      return data;
    },
    onSuccess: (data) => {
      setNewMessage("");
      refetchMessages();
      refetchThreads();
      
      // Only show success toast if message was actually delivered
      if (!data.error && data.success !== false) {
        toast({ title: "✅ Message sent successfully" });
      }
    },
    onError: (error) => {
      // Don't show duplicate errors for already-handled cases
      if (!error.message.includes('Limited Delivery')) {
        toast({ 
          title: "❌ Message delivery failed", 
          description: "Please check driver contact information and try again.", 
          variant: "destructive" 
        });
      }
    }
  });

  // Mark messages as read mutation
  const markAsReadMutation = useMutation({
    mutationFn: async ({ threadId, role }: { threadId: string; role: 'dispatch' | 'driver' }) => {
      const response = await fetch(`/api/communication/threads/${threadId}/mark-read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role })
      });
      if (!response.ok) throw new Error('Failed to mark as read');
      return response.json();
    },
    onSuccess: () => {
      refetchThreads();
    }
  });

  // Send portal link mutation
  const sendPortalLinkMutation = useMutation({
    mutationFn: async (driverId: string) => {
      const response = await fetch(`/api/drivers/${driverId}/send-dashboard-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      // Safely parse JSON response
      let data;
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        // Handle non-JSON responses
        const text = await response.text();
        data = { success: response.ok, message: text };
      }
      
      if (!response.ok) {
        throw new Error(data.error || data.message || 'Failed to send portal link');
      }
      
      return data;
    },
    onSuccess: (data) => {
      toast({ 
        title: "✅ Portal link sent", 
        description: `Dashboard access link sent to ${data.driverName || 'driver'}` 
      });
    },
    onError: (error: Error) => {
      toast({ 
        title: "❌ Failed to send portal link", 
        description: error.message, 
        variant: "destructive" 
      });
    }
  });

  // Fetch AI suggestions for selected thread
  const { data: aiSuggestions = [], isLoading: aiSuggestionsLoading, refetch: refetchAiSuggestions } = useQuery<AiMessageSuggestion[]>({
    queryKey: ['/api/ai/suggestions', selectedThread?.id],
    queryFn: async () => {
      if (!selectedThread?.id) return [];
      const response = await fetch(`/api/ai/suggestions/${selectedThread.id}`);
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!selectedThread?.id && selectedThread?.assistantEnabled,
    refetchInterval: 5000, // Refresh AI suggestions every 5 seconds
  });

  // Fetch document attachments for selected load
  const { data: attachments = [], isLoading: attachmentsLoading, refetch: refetchAttachments } = useQuery<MessageAttachment[]>({
    queryKey: ['/api/communication/attachments/load', selectedThread?.loadId],
    queryFn: async () => {
      if (!selectedThread?.loadId) return [];
      const response = await fetch(`/api/communication/attachments/load/${selectedThread.loadId}`);
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!selectedThread?.loadId,
  });

  // Upload document attachment mutation
  const uploadAttachmentMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const response = await fetch('/api/communication/attachments', {
        method: 'POST',
        body: formData
      });
      if (!response.ok) throw new Error('Failed to upload attachment');
      return response.json();
    },
    onSuccess: () => {
      setShowUploadDialog(false);
      setUploadFile(null);
      setDocumentCategory('other');
      setDocumentDescription('');
      refetchAttachments();
      toast({ title: "Document uploaded successfully" });
    },
    onError: (error) => {
      toast({ title: "Failed to upload document", description: error.message, variant: "destructive" });
    }
  });

  // Approve document mutation
  const approveDocumentMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes?: string }) => {
      const response = await fetch(`/api/communication/attachments/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes })
      });
      if (!response.ok) throw new Error('Failed to approve document');
      return response.json();
    },
    onSuccess: () => {
      refetchAttachments();
      toast({ title: "Document approved successfully" });
    },
    onError: (error) => {
      toast({ title: "Failed to approve document", description: error.message, variant: "destructive" });
    }
  });

  // Reject document mutation
  const rejectDocumentMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      const response = await fetch(`/api/communication/attachments/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes })
      });
      if (!response.ok) throw new Error('Failed to reject document');
      return response.json();
    },
    onSuccess: () => {
      refetchAttachments();
      toast({ title: "Document rejected" });
    },
    onError: (error) => {
      toast({ title: "Failed to reject document", description: error.message, variant: "destructive" });
    }
  });

  // Get conversation insights
  const { data: conversationInsights, isLoading: insightsLoading } = useQuery<ConversationInsight>({
    queryKey: ['/api/ai/conversation-insights', selectedThread?.id],
    queryFn: async () => {
      if (!selectedThread?.id) return null;
      const response = await fetch(`/api/ai/conversation-insights/${selectedThread.id}`);
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!selectedThread?.id && selectedThread?.assistantEnabled,
    refetchInterval: 10000, // Refresh insights every 10 seconds
  });

  // Generate AI suggestion mutation
  const generateAiSuggestionMutation = useMutation({
    mutationFn: async ({ threadId, context, messageType, tone }: { 
      threadId: string; 
      context?: string; 
      messageType?: string; 
      tone?: string; 
    }) => {
      const response = await fetch('/api/ai/suggest-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId, context, messageType, tone })
      });
      if (!response.ok) throw new Error('Failed to generate AI suggestion');
      return response.json();
    },
    onSuccess: () => {
      refetchAiSuggestions();
      toast({ title: "AI suggestion generated", description: "New suggestion available below" });
    },
    onError: (error) => {
      toast({ title: "Failed to generate AI suggestion", description: error.message, variant: "destructive" });
    }
  });

  // Approve AI suggestion mutation
  const approveAiSuggestionMutation = useMutation({
    mutationFn: async (messageId: string) => {
      const response = await fetch(`/api/ai/approve/${messageId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approverId: 'dispatcher' })
      });
      if (!response.ok) throw new Error('Failed to approve suggestion');
      return response.json();
    },
    onSuccess: () => {
      refetchAiSuggestions();
      refetchMessages();
      refetchThreads();
      toast({ title: "Message sent", description: "AI suggestion approved and sent" });
    },
    onError: (error) => {
      toast({ title: "Failed to send message", description: error.message, variant: "destructive" });
    }
  });

  // Reject AI suggestion mutation
  const rejectAiSuggestionMutation = useMutation({
    mutationFn: async (messageId: string) => {
      const response = await fetch(`/api/ai/reject/${messageId}`, {
        method: 'POST'
      });
      if (!response.ok) throw new Error('Failed to reject suggestion');
      return response.json();
    },
    onSuccess: () => {
      refetchAiSuggestions();
      toast({ title: "Suggestion dismissed" });
    }
  });

  // Fetch unassigned loads
  const { data: unassignedLoads = [], isLoading: unassignedLoadsLoading, refetch: refetchUnassignedLoads } = useQuery<UnassignedLoad[]>({
    queryKey: ['/api/loads/unassigned'],
    queryFn: async () => {
      const response = await fetch('/api/loads?status=available');
      if (!response.ok) return [];
      const data = await response.json();
      // Filter for loads that don't have a driver assigned
      return data.filter((load: any) => !load.driverId && load.status === 'available').slice(0, 50); // Limit to 50 for performance
    },
    refetchInterval: 30000, // Refresh every 30 seconds
    enabled: showUnassignedLoads && !loadSearchQuery // Don't fetch when searching
  });

  // Search for loads by load number
  const { data: searchedLoads = [], isLoading: searchedLoadsLoading } = useQuery<UnassignedLoad[]>({
    queryKey: ['/api/loads/search', loadSearchQuery],
    queryFn: async () => {
      const response = await fetch('/api/loads');
      if (!response.ok) return [];
      const data = await response.json();
      // Filter loads by search query (search in load number)
      const query = loadSearchQuery.toLowerCase();
      return data.filter((load: any) => 
        load.loadNumber && load.loadNumber.toLowerCase().includes(query)
      ).slice(0, 50); // Limit results
    },
    enabled: showUnassignedLoads && loadSearchQuery.length > 0
  });

  // Fetch all drivers
  const { data: availableDrivers = [] } = useQuery<Driver[]>({
    queryKey: ['/api/drivers'],
    queryFn: async () => {
      const response = await fetch('/api/drivers');
      if (!response.ok) return [];
      const data = await response.json();
      return data.filter((driver: any) => driver.status === 'available');
    },
  });

  // Assign driver to load mutation
  const assignDriverMutation = useMutation({
    mutationFn: async ({ loadId, driverId }: { loadId: string; driverId: string }) => {
      const response = await fetch(`/api/loads/${loadId}/book-for-driver/${driverId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!response.ok) throw new Error('Failed to assign driver');
      return response.json();
    },
    onSuccess: (data) => {
      toast({ title: "Driver assigned successfully", description: `${data.driverName} assigned to load ${data.loadNumber}` });
      refetchUnassignedLoads();
      refetchThreads();
      setSelectedLoadForAssignment(null);
    },
    onError: (error) => {
      toast({ title: "Failed to assign driver", description: error.message, variant: "destructive" });
    }
  });

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Mark messages as read when thread is selected
  useEffect(() => {
    if (selectedThread && selectedThread.unreadDispatchMessages > 0) {
      markAsReadMutation.mutate({ threadId: selectedThread.id, role: 'dispatch' });
    }
  }, [selectedThread]);

  // Filter and search threads - UNIFIED VIEW (no tab filtering)
  const filteredThreads = threads.filter(thread => {
    const matchesSearch = searchTerm === "" || 
      thread.driverName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (thread.loadNumber && thread.loadNumber.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (thread.loadOrigin && thread.loadOrigin.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (thread.loadDestination && thread.loadDestination.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesStatus = filterStatus === "all" || 
      (filterStatus === "active" && thread.status === "active") ||
      (filterStatus === "unread" && thread.unreadDispatchMessages > 0) ||
      (filterStatus === "archived" && thread.status === "archived");
    
    return matchesSearch && matchesStatus;
  });

  // Sort threads by most recent activity for unified view
  const sortedThreads = [...filteredThreads].sort((a, b) => 
    new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
  );
  
  // Debug logging for filtering
  useEffect(() => {
    console.log('🔍 Filtered threads count:', filteredThreads.length);
    console.log('🔍 Sorted threads count:', sortedThreads.length);
    if (filteredThreads.length > 0) {
      console.log('🔍 First filtered thread:', filteredThreads[0]);
    }
  }, [filteredThreads.length, sortedThreads.length]);

  const handleSendMessage = () => {
    if (!selectedThread || !newMessage.trim()) return;
    sendMessageMutation.mutate({ threadId: selectedThread.id, content: newMessage.trim() });
  };

  const handleQuickReply = (template: QuickReplyTemplate) => {
    if (!selectedThread) return;
    sendMessageMutation.mutate({ threadId: selectedThread.id, content: template.messageTemplate });
  };

  const handleQuickMessage = (content: string) => {
    if (!selectedThread) return;
    sendMessageMutation.mutate({ threadId: selectedThread.id, content });
  };

  const formatMessageTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
    
    if (diffInHours < 24) {
      return format(date, 'HH:mm');
    } else {
      return format(date, 'MMM dd, HH:mm');
    }
  };

  const getThreadStatusBadge = (thread: LoadCommunicationThread) => {
    if (thread.unreadDispatchMessages > 0) {
      return <Badge className="bg-red-100 text-red-800 border-red-200 text-[10px] px-1.5 py-0.5">{thread.unreadDispatchMessages} unread</Badge>;
    }
    if (thread.status === 'active') {
      return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300 text-[10px] px-1.5 py-0.5">Active</Badge>;
    }
    return <Badge className="bg-gray-100 text-gray-800 border-gray-200 text-[10px] px-1.5 py-0.5">Archived</Badge>;
  };

  const handleFileUpload = async () => {
    if (!uploadFile || !selectedThread) return;

    // Create FormData for binary file upload simulation
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64Data = e.target?.result?.toString().split(',')[1];
      
      const attachmentData = {
        loadId: selectedThread.loadId,
        driverId: selectedThread.driverId,
        fileName: uploadFile.name,
        fileUrl: `data:${uploadFile.type};base64,${base64Data}`, // Simulating file storage
        fileSize: uploadFile.size,
        fileType: uploadFile.type,
        documentCategory,
        documentDescription,
        uploadedBy: 'dispatcher'
      };

      const response = await fetch('/api/communication/attachments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(attachmentData)
      });

      if (response.ok) {
        setShowUploadDialog(false);
        setUploadFile(null);
        setDocumentCategory('other');
        setDocumentDescription('');
        refetchAttachments();
        toast({ title: "Document uploaded successfully" });
      } else {
        toast({ title: "Failed to upload document", variant: "destructive" });
      }
    };

    reader.readAsDataURL(uploadFile);
  };

  const getCategoryIcon = (category: MessageAttachment['documentCategory']) => {
    switch (category) {
      case 'pod': return <FileText className="w-4 h-4 text-green-600" />;
      case 'bol': return <FileText className="w-4 h-4 text-blue-600" />;
      case 'inspection_report': return <FileText className="w-4 h-4 text-orange-600" />;
      case 'damage_photos': return <Image className="w-4 h-4 text-red-600" />;
      case 'weight_ticket': return <FileText className="w-4 h-4 text-purple-600" />;
      case 'lumper_receipt': return <FileText className="w-4 h-4 text-indigo-600" />;
      default: return <File className="w-4 h-4 text-gray-600" />;
    }
  };

  const getCategoryLabel = (category: MessageAttachment['documentCategory']) => {
    switch (category) {
      case 'pod': return 'Proof of Delivery';
      case 'bol': return 'Bill of Lading';
      case 'inspection_report': return 'Inspection Report';
      case 'damage_photos': return 'Damage Photos';
      case 'weight_ticket': return 'Weight Ticket';
      case 'lumper_receipt': return 'Lumper Receipt';
      default: return 'Other Document';
    }
  };

  const getStatusDotColor = (thread: LoadCommunicationThread) => {
    if (thread.loadOfferStatus === 'pending') {
      return 'bg-amber-500';
    }
    if (thread.status === 'active') {
      return 'bg-emerald-500';
    }
    return 'bg-gray-400';
  };

  const getStatusColor = (status: MessageAttachment['documentStatus']) => {
    switch (status) {
      case 'approved': return 'bg-green-100 text-green-800 border-green-200';
      case 'rejected': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-amber-100 text-amber-700 border-amber-300';
    }
  };

  const handleRequestDocuments = async (documentTypes: string[]) => {
    if (!selectedThread) return;
    
    const documentNames = documentTypes.map(type => getCategoryLabel(type)).join(', ');
    const message = `📄 Please send the following documents via SMS/MMS: ${documentNames}. You can take photos and send them directly to this number.`;
    
    sendMessageMutation.mutate({ threadId: selectedThread.id, content: message });
  };

  // Document Gallery Component
  const DocumentGallery = ({ 
    attachments, 
    loadId, 
    onApprove, 
    onReject,
    onRequestDocuments 
  }: {
    attachments: MessageAttachment[];
    loadId: string;
    onApprove: (id: string) => void;
    onReject: (id: string, notes: string) => void;
    onRequestDocuments: (types: string[]) => void;
  }) => {
    const [selectedCategory, setSelectedCategory] = useState<string>('all');
    const [rejectNotes, setRejectNotes] = useState('');
    const [rejectingId, setRejectingId] = useState<string | null>(null);

    const filteredAttachments = selectedCategory === 'all' 
      ? attachments 
      : attachments.filter(a => a.documentCategory === selectedCategory);

    const requiredDocuments = ['pod', 'bol', 'inspection_report'];
    const missingDocuments = requiredDocuments.filter(
      type => !attachments.some(a => a.documentCategory === type && a.documentStatus === 'approved')
    );

    return (
      <div className="space-y-4">
        {/* Document Request Section */}
        {missingDocuments.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium text-yellow-900">Missing Documents</h4>
              <MessageSquare className="w-4 h-4 text-yellow-600 animate-pulse" />
            </div>
            <p className="text-sm text-yellow-800 mb-3">
              Request the following documents from driver via SMS:
            </p>
            <div className="flex flex-wrap gap-2">
              {missingDocuments.map(type => (
                <Badge key={type} className="bg-amber-100 text-amber-700 border-amber-300">
                  {getCategoryLabel(type)}
                </Badge>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 w-full border-yellow-300 hover:bg-yellow-100"
              onClick={() => onRequestDocuments(missingDocuments)}
              data-testid="button-request-documents"
            >
              <MessageSquare className="w-4 h-4 mr-2" />
              Request via SMS
            </Button>
          </div>
        )}

        {/* Category Filter */}
        <div className="flex gap-2 flex-wrap">
          <Button
            variant={selectedCategory === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSelectedCategory('all')}
          >
            All ({attachments.length})
          </Button>
          {['pod', 'bol', 'inspection_report', 'damage_photos', 'weight_ticket', 'lumper_receipt', 'other'].map(category => {
            const count = attachments.filter(a => a.documentCategory === category).length;
            if (count === 0) return null;
            return (
              <Button
                key={category}
                variant={selectedCategory === category ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedCategory(category)}
              >
                {getCategoryIcon(category as MessageAttachment['documentCategory'])}
                <span className="ml-1">{getCategoryLabel(category)} ({count})</span>
              </Button>
            );
          })}
        </div>

        {/* Document Grid */}
        <div className="grid grid-cols-2 gap-4">
          {filteredAttachments.map(attachment => (
            <Card key={attachment.id} className="overflow-hidden">
              <div className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {getCategoryIcon(attachment.documentCategory)}
                    <div>
                      <p className="text-sm font-medium">{attachment.fileName}</p>
                      <p className="text-xs text-gray-500">
                        {attachment.uploadedBy.includes('zello') ? (
                          <span className="flex items-center gap-1">
                            <Radio className="w-3 h-3" />
                            Via Zello
                          </span>
                        ) : (
                          `Uploaded by ${attachment.uploadedBy}`
                        )}
                      </p>
                    </div>
                  </div>
                  <Badge className={getStatusColor(attachment.documentStatus)}>
                    {attachment.documentStatus}
                  </Badge>
                </div>

                {attachment.documentDescription && (
                  <p className="text-sm text-gray-600 mb-2">{attachment.documentDescription}</p>
                )}

                <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
                  <span>{(attachment.fileSize / 1024).toFixed(1)} KB</span>
                  <span>{format(new Date(attachment.createdAt), 'MMM dd, HH:mm')}</span>
                </div>

                {/* Preview */}
                {attachment.fileType.startsWith('image/') && (
                  <div className="mb-3 bg-gray-100 rounded-lg p-2">
                    <img 
                      src={attachment.fileUrl} 
                      alt={attachment.fileName}
                      className="w-full h-32 object-contain"
                    />
                  </div>
                )}

                {/* Actions */}
                {attachment.documentStatus === 'pending_review' && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => onApprove(attachment.id)}
                    >
                      <Check className="w-3 h-3 mr-1" />
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => {
                        setRejectingId(attachment.id);
                        setRejectNotes('');
                      }}
                    >
                      <XCircle className="w-3 h-3 mr-1" />
                      Reject
                    </Button>
                  </div>
                )}

                {attachment.documentStatus === 'approved' && attachment.reviewedBy && (
                  <div className="text-xs text-green-600">
                    <Check className="w-3 h-3 inline mr-1" />
                    Approved by {attachment.reviewedBy}
                    {attachment.reviewedAt && ` on ${format(new Date(attachment.reviewedAt), 'MMM dd')}`}
                  </div>
                )}

                {attachment.documentStatus === 'rejected' && attachment.reviewNotes && (
                  <div className="text-xs text-red-600">
                    <XCircle className="w-3 h-3 inline mr-1" />
                    Rejected: {attachment.reviewNotes}
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>

        {/* Reject Dialog */}
        {rejectingId && (
          <Dialog open={!!rejectingId} onOpenChange={() => setRejectingId(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Reject Document</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Rejection Notes (Required)</Label>
                  <Textarea
                    placeholder="Please provide a reason for rejection..."
                    value={rejectNotes}
                    onChange={(e) => setRejectNotes(e.target.value)}
                    rows={3}
                  />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setRejectingId(null)}>
                    Cancel
                  </Button>
                  <Button 
                    onClick={() => {
                      if (rejectNotes.trim()) {
                        onReject(rejectingId, rejectNotes);
                        setRejectingId(null);
                        setRejectNotes('');
                      }
                    }}
                    disabled={!rejectNotes.trim()}
                  >
                    Reject Document
                  </Button>
                </DialogFooter>
              </div>
            </DialogContent>
          </Dialog>
        )}

        {filteredAttachments.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No documents uploaded yet</p>
            <p className="text-sm mt-2">Documents uploaded via Zello will appear here</p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] bg-background" data-testid="communication-dashboard">
      {/* Thread List Sidebar */}
      <div className="w-80 min-w-80 max-w-80 flex-shrink-0 border-r border-border bg-card flex flex-col shadow-sm">
        {/* Header */}
        <div className="p-4 border-b border-border bg-card shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold text-foreground">Message Center</h2>
              {threads.reduce((sum, thread) => sum + thread.unreadDispatchMessages, 0) > 0 && (
                <Badge className="bg-destructive text-destructive-foreground" data-testid="badge-unread-count">
                  {threads.reduce((sum, thread) => sum + thread.unreadDispatchMessages, 0)}
                </Badge>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                refetchThreads();
                refetchMessages();
                refetchUnassignedLoads();
              }}
              disabled={threadsLoading}
              className="hover:shadow-sm hover:border-primary/50 transition-all duration-200"
              data-testid="button-refresh"
            >
              <RefreshCw className={`w-4 h-4 transition-transform ${threadsLoading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
          
          {/* Search and Filter */}
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search drivers, loads, routes..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setShowDriverDropdown(e.target.value.length > 0);
                }}
                onFocus={() => setShowDriverDropdown(searchTerm.length > 0)}
                onBlur={() => setTimeout(() => setShowDriverDropdown(false), 200)}
                className="pl-10 bg-input border-border text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                data-testid="input-search"
              />
              
              {/* Driver Dropdown */}
              {showDriverDropdown && filteredDrivers.length > 0 && (
                <div className="absolute z-[100] w-full mt-1 bg-card border border-border rounded-md shadow-xl max-h-60 overflow-y-auto">
                  {filteredDrivers.map((driver) => (
                    <button
                      key={driver.id}
                      className="w-full text-left px-4 py-3 hover:bg-muted/50 focus:bg-muted/50 flex items-center justify-between transition-all"
                      onClick={() => {
                        startGeneralChatMutation.mutate(driver.id);
                        setSearchTerm("");
                        setShowDriverDropdown(false);
                      }}
                      data-testid={`button-select-driver-${driver.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <User className="w-5 h-5 text-muted-foreground" />
                        <div>
                          <div className="text-sm font-semibold text-foreground">{driver.name}</div>
                          <div className="text-sm text-muted-foreground">{driver.phone || 'No phone'}</div>
                        </div>
                      </div>
                      <Badge 
                        className={
                          driver.status === 'available' 
                            ? "bg-success/10 text-success border border-success/30" 
                            : driver.status === 'on_route'
                            ? "bg-primary/10 text-primary border border-primary/30"
                            : "bg-muted/10 text-muted-foreground border border-muted/30"
                        }
                      >
                        {driver.status}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="bg-input border-border text-foreground" data-testid="select-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border shadow-lg">
                <SelectItem value="all">All Conversations</SelectItem>
                <SelectItem value="active">Active Only</SelectItem>
                <SelectItem value="unread">Unread Messages</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Thread List - Unified Conversations */}
        <ScrollArea className="flex-1">
          <div className="p-2">
            {/* Loading Skeleton */}
            {threadsLoading && (
              <div className="p-2 space-y-1.5">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="bg-card border border-border rounded-lg p-2.5 animate-pulse">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-muted rounded w-1/2"></div>
                        <div className="h-3 bg-muted/50 rounded w-1/3"></div>
                      </div>
                      <div className="w-7 h-7 bg-muted rounded-full"></div>
                    </div>
                    <div className="h-3 bg-muted/50 rounded w-3/4"></div>
                  </div>
                ))}
              </div>
            )}
            
            {/* Actual Threads */}
            {!threadsLoading && sortedThreads.map((thread) => (
              <button
                key={thread.id}
                className={`w-full mb-2 text-left cursor-pointer transition-all duration-200 ease-in-out hover:bg-muted/50 hover:border-primary/30 hover:shadow-md rounded-lg border ${
                  selectedThread?.id === thread.id ? 'ring-2 ring-primary border-primary/50 shadow-lg bg-muted/30' : 'border-border bg-card'
                }`}
                onClick={() => setSelectedThread(thread)}
                data-testid={`button-thread-${thread.id}`}
              >
                <div className="p-3 space-y-2">
                  {/* Top row: Driver name + Avatar */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${getStatusDotColor(thread)}`}></div>
                      <h4 className="font-semibold text-sm text-foreground truncate">{thread.driverName}</h4>
                    </div>
                    <Avatar className="w-8 h-8 flex-shrink-0">
                      <AvatarFallback className="text-xs bg-muted text-muted-foreground">
                        {thread.driverName.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                  
                  {/* Phone number */}
                  <div className="text-[11px] text-muted-foreground">{thread.driverPhone || 'No phone'}</div>
                  
                  {/* Badges row: Status + Load Number */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {getThreadStatusBadge(thread)}
                    {thread.loadNumber && (
                      <Badge className="bg-primary/10 text-primary border border-primary/30 text-[10px] px-1.5 py-0.5">
                        {thread.loadNumber}
                      </Badge>
                    )}
                    {thread.loadOfferStatus === 'pending' && (
                      <Badge className="bg-warning/10 text-warning border border-warning/30 text-[10px] px-1.5 py-0.5">
                        Load Offer
                      </Badge>
                    )}
                  </div>
                  
                  {/* Route (if available) */}
                  {thread.loadOrigin && thread.loadDestination && (
                    <div className="text-[11px] text-muted-foreground truncate">
                      {thread.loadOrigin} → {thread.loadDestination}
                    </div>
                  )}
                  
                  {/* Last message */}
                  {thread.lastMessageText && (
                    <div className="space-y-1 pt-1 border-t border-border/50">
                      <p className="text-xs text-muted-foreground truncate">
                        {thread.lastMessageSender === 'dispatch' ? 'You: ' : ''}
                        {thread.lastMessageText}
                      </p>
                      <p className="text-[10px] text-muted-foreground/70">
                        {formatMessageTime(thread.lastMessageAt)}
                      </p>
                    </div>
                  )}
                </div>
              </button>
            ))}
            
            {/* Empty State */}
            {!threadsLoading && filteredThreads.length === 0 && (
              <div className="bg-muted/30 rounded-lg p-8 m-4">
                <div className="text-center">
                  <MessageSquare className="w-16 h-16 mx-auto mb-4 text-muted-foreground" data-testid="icon-empty-conversations" />
                  <p className="text-foreground font-medium mb-2" data-testid="text-empty-primary">No conversations yet</p>
                  <p className="text-sm text-muted-foreground" data-testid="text-empty-secondary">Search for a driver above to start a conversation</p>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Chat Interface */}
      <div className="flex-1 flex flex-col">
        {selectedThread ? (
          <>
            {/* Chat Header */}
            <div className="p-4 border-b border-border bg-card shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Avatar className="w-10 h-10">
                    <AvatarFallback className="bg-primary/10 text-primary">
                      {selectedThread.driverName.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h3 className="font-medium text-foreground">{selectedThread.driverName}</h3>
                    <p className="text-sm text-muted-foreground">
                      {selectedThread.driverPhone || 'No phone'} 
                      {selectedThread.loadNumber && ` • Load ${selectedThread.loadNumber}`}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  {selectedThread.driverPhone && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(`tel:${selectedThread.driverPhone}`, '_self')}
                      className="hover:shadow-sm hover:border-primary/50 transition-all duration-200"
                      data-testid="button-call-driver"
                    >
                      <Phone className="w-4 h-4" />
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="hover:shadow-sm hover:border-primary/50 transition-all duration-200"
                    data-testid="button-more-actions"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              
              {/* Load Info & AI Controls */}
              <div className="mt-3 p-3 bg-muted/30 rounded-lg">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    {selectedThread.loadOrigin && selectedThread.loadDestination ? (
                      <div className="flex items-center gap-1">
                        <MapPin className="w-4 h-4" />
                        <span>{selectedThread.loadOrigin} → {selectedThread.loadDestination}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <MessageSquare className="w-4 h-4" />
                        <span>General Discussion</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      <MessageCircle className="w-4 h-4" />
                      <span>{selectedThread.messageCount} messages</span>
                    </div>
                  </div>
                  
                  {/* AI Assistant Controls */}
                  <div className="flex items-center gap-2">
                    <Button
                      variant={selectedThread?.assistantEnabled ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        // Toggle AI assistant for this thread
                        toast({ title: "AI Assistant", description: selectedThread?.assistantEnabled ? "Disabled" : "Enabled" });
                      }}
                      className="hover:shadow-sm transition-all duration-200"
                      data-testid="toggle-ai-assistant"
                    >
                      <Brain className="w-4 h-4 mr-1" />
                      AI {selectedThread?.assistantEnabled ? 'On' : 'Off'}
                    </Button>
                  </div>
                </div>
                
                {/* Conversation Insights */}
                {selectedThread?.assistantEnabled && conversationInsights && !insightsLoading && (
                  <div className="border-t pt-2 mt-2">
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                      <span>AI Insights</span>
                      <Sparkles className="w-3 h-3" />
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="flex items-center gap-1">
                        <TrendingUp className="w-3 h-3 text-blue-500" />
                        <span>Sentiment: {conversationInsights.sentiment}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Target className="w-3 h-3 text-orange-500" />
                        <span>Urgency: {conversationInsights.urgency}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-green-500" />
                        <span>Response: {conversationInsights.estimatedResponseTime}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <User className="w-3 h-3 text-purple-500" />
                        <span>Mood: {conversationInsights.driverMood}</span>
                      </div>
                    </div>
                    {conversationInsights.nextAction && (
                      <div className="mt-2 p-2 bg-blue-50 rounded text-xs text-blue-700">
                        <strong>Suggested Action:</strong> {conversationInsights.nextAction}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 p-4 bg-background">
              <div className="space-y-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.sender === 'dispatch' ? 'justify-end' : 'justify-start'}`}
                    data-testid={`message-${message.id}`}
                  >
                    <div
                      className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                        message.sender === 'dispatch'
                          ? 'bg-primary/10 text-foreground border border-primary/30'
                          : 'bg-muted text-foreground'
                      }`}
                    >
                      {message.mediaUrl && message.mediaType?.startsWith('image/') && (
                        <div className="mb-2">
                          <img 
                            src={`/api/communication/media-proxy?url=${encodeURIComponent(message.mediaUrl)}`}
                            alt="MMS attachment"
                            className="rounded-lg max-w-full h-auto max-h-64 object-contain"
                            data-testid={`message-image-${message.id}`}
                          />
                        </div>
                      )}
                      {message.content && <p className="text-sm">{message.content}</p>}
                      <div className={`flex items-center justify-between mt-1 text-xs ${
                        message.sender === 'dispatch' ? 'text-primary/70' : 'text-muted-foreground'
                      }`}>
                        <span>{formatMessageTime(message.createdAt)}</span>
                        {message.sender === 'dispatch' && (
                          <div className="flex items-center gap-1">
                            {message.isRead ? (
                              <CheckCircle className="w-3 h-3" />
                            ) : (
                              <Circle className="w-3 h-3" />
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* AI Suggestions Panel */}
            {selectedThread?.assistantEnabled && showAiPanel && aiSuggestions.length > 0 && (
              <div className="border-t border-border bg-primary/5 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-warning" />
                    <h4 className="text-sm font-medium text-foreground">AI Suggestions</h4>
                    <Badge variant="outline" className="text-xs">
                      {aiSuggestions.length} available
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAiPanel(false)}
                    data-testid="close-ai-panel"
                  >
                    ×
                  </Button>
                </div>
                
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {aiSuggestions.slice(0, 3).map((suggestion) => (
                    <div key={suggestion.id} className="bg-card rounded-lg p-3 border border-border">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <p className="text-sm text-foreground mb-1">{suggestion.suggestedText}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Badge className="bg-primary/10 text-primary border border-primary/30 text-xs">
                              {suggestion.confidence}% confident
                            </Badge>
                            <span>{suggestion.messageType}</span>
                            <span>•</span>
                            <span>{suggestion.tone}</span>
                          </div>
                          {suggestion.reasoning && (
                            <p className="text-xs text-muted-foreground mt-1 italic">{suggestion.reasoning}</p>
                          )}
                        </div>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => approveAiSuggestionMutation.mutate(suggestion.id)}
                            disabled={approveAiSuggestionMutation.isPending}
                            data-testid={`approve-suggestion-${suggestion.id}`}
                          >
                            <ThumbsUp className="w-3 h-3 mr-1" />
                            Send
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => rejectAiSuggestionMutation.mutate(suggestion.id)}
                            disabled={rejectAiSuggestionMutation.isPending}
                            data-testid={`reject-suggestion-${suggestion.id}`}
                          >
                            <ThumbsDown className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Load Offer Section for General Conversations */}
            {selectedThread?.threadType === 'general' && (
              <div className="p-3 border-t border-border bg-primary/5">
                <div className="mb-3">
                  {selectedThread.loadOfferStatus === 'pending' && selectedThread.loadId && (
                    <Alert className="border-yellow-300 bg-yellow-50">
                      <AlertTriangle className="h-4 w-4 text-yellow-600" />
                      <AlertDescription className="text-sm">
                        <strong>Load Offered:</strong> {selectedThread.loadNumber} - {selectedThread.loadOrigin} → {selectedThread.loadDestination}
                        <br />
                        <span className="text-xs text-gray-600">Waiting for driver response...</span>
                      </AlertDescription>
                    </Alert>
                  )}
                  {selectedThread.loadOfferStatus === 'accepted' && selectedThread.loadId && (
                    <Alert className="border-green-300 bg-green-50">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <AlertDescription className="text-sm">
                        <strong>Load Accepted:</strong> {selectedThread.loadNumber} - {selectedThread.loadOrigin} → {selectedThread.loadDestination}
                        <br />
                        <span className="text-xs text-gray-600">Load is now attached to this conversation</span>
                      </AlertDescription>
                    </Alert>
                  )}
                  {selectedThread.loadOfferStatus === 'declined' && (
                    <Alert className="border-red-300 bg-red-50">
                      <XCircle className="h-4 w-4 text-red-600" />
                      <AlertDescription className="text-sm">
                        <strong>Load Declined:</strong> Driver declined the offered load
                        <br />
                        <span className="text-xs text-gray-600">You can offer a different load</span>
                      </AlertDescription>
                    </Alert>
                  )}
                  {(!selectedThread.loadOfferStatus || selectedThread.loadOfferStatus === 'declined') && (
                    <Button 
                      variant="default"
                      className="w-full bg-blue-600 hover:bg-blue-700"
                      onClick={() => setShowUnassignedLoads(true)}
                      data-testid="button-offer-load"
                    >
                      <Package className="w-4 h-4 mr-2" />
                      Offer Load to Driver
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Quick Replies */}
            <div className="p-3 border-t border-border bg-muted/30">
              <h4 className="text-xs font-medium text-foreground mb-2">Quick Messages</h4>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {/* Common Dispatcher Messages */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleQuickMessage('Hi! Just a friendly reminder about your pickup today. Please confirm when you arrive at the pickup location. Thanks!')}
                  className="whitespace-nowrap text-xs"
                  data-testid="quick-reply-pickup-reminder"
                >
                  📍 Pickup Reminder
                </Button>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleQuickMessage('Please provide an ETA for delivery. Customer is asking for updates. Thank you!')}
                  className="whitespace-nowrap text-xs"
                  data-testid="quick-reply-delivery-update"
                >
                  🚚 Delivery ETA
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleQuickMessage('Hi! Can you please provide a quick status update on this load? Thanks!')}
                  className="whitespace-nowrap text-xs"
                  data-testid="quick-reply-status-check"
                >
                  ❓ Status Check
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleQuickMessage('Great! Load confirmed. Please proceed to pickup location and keep me updated. Safe travels!')}
                  className="whitespace-nowrap text-xs"
                  data-testid="quick-reply-load-confirmed"
                >
                  ✅ Load Confirmed
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleQuickMessage('Please remember to get all required paperwork signed and send photos when pickup/delivery is complete.')}
                  className="whitespace-nowrap text-xs"
                  data-testid="quick-reply-paperwork"
                >
                  📋 Paperwork
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleQuickMessage('Please contact the customer before arrival. Their contact info is in the load details. Thanks!')}
                  className="whitespace-nowrap text-xs"
                  data-testid="quick-reply-contact-customer"
                >
                  📞 Call Customer
                </Button>
              </div>

              {/* Show existing templates if any */}
              {templates.filter(t => t.isForDispatch && t.isActive).length > 0 && (
                <div>
                  <h5 className="text-xs font-medium text-gray-600 mb-2">Saved Templates</h5>
                  <div className="flex gap-2 overflow-x-auto">
                    {templates
                      .filter(t => t.isForDispatch && t.isActive)
                      .map((template) => (
                      <Button
                        key={template.id}
                        variant="outline"
                        size="sm"
                        onClick={() => handleQuickReply(template)}
                        className="whitespace-nowrap text-xs"
                        data-testid={`quick-reply-${template.templateKey}`}
                      >
                        {template.displayText}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Message Input with AI Smart Compose */}
            <div className="border-t border-border bg-card">
              {/* AI Quick Actions */}
              {selectedThread?.assistantEnabled && (
                <div className="px-4 pt-3 pb-2 border-b border-border">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-gray-600">AI Assist</span>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (selectedThread) {
                            generateAiSuggestionMutation.mutate({
                              threadId: selectedThread.id,
                              messageType: 'update',
                              tone: 'professional'
                            });
                          }
                        }}
                        disabled={generateAiSuggestionMutation.isPending}
                        data-testid="generate-ai-suggestion"
                      >
                        <Zap className="w-3 h-3 mr-1" />
                        {generateAiSuggestionMutation.isPending ? 'Generating...' : 'Suggest'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setAiComposing(!aiComposing)}
                        data-testid="toggle-ai-compose"
                      >
                        <Brain className="w-3 h-3 mr-1" />
                        {aiComposing ? 'Manual' : 'AI Compose'}
                      </Button>
                    </div>
                  </div>
                  
                  {aiComposing && (
                    <div className="grid grid-cols-3 gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (selectedThread) {
                            generateAiSuggestionMutation.mutate({
                              threadId: selectedThread.id,
                              context: 'Request status update from driver',
                              messageType: 'question',
                              tone: 'friendly'
                            });
                          }
                        }}
                        className="text-xs"
                      >
                        📅 Status Update
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (selectedThread) {
                            generateAiSuggestionMutation.mutate({
                              threadId: selectedThread.id,
                              context: 'Thank driver and provide encouragement',
                              messageType: 'response',
                              tone: 'friendly'
                            });
                          }
                        }}
                        className="text-xs"
                      >
                        🙏 Thank You
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (selectedThread) {
                            generateAiSuggestionMutation.mutate({
                              threadId: selectedThread.id,
                              context: 'Address urgent delivery concern',
                              messageType: 'response',
                              tone: 'urgent'
                            });
                          }
                        }}
                        className="text-xs"
                      >
                        ⚠️ Urgent Response
                      </Button>
                    </div>
                  )}
                </div>
              )}
              
              {/* Message Input */}
              <div className="p-4">
                <div className="flex items-end gap-2">
                  <div className="flex-1 relative">
                    <Textarea
                      placeholder={selectedThread?.assistantEnabled ? "Type your message or use AI assist..." : "Type your message..."}
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      rows={1}
                      className="min-h-[40px] resize-none pr-8 bg-input border-border text-foreground"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                      data-testid="textarea-message"
                    />
                    {selectedThread?.assistantEnabled && newMessage.length > 10 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute right-1 top-1 p-1"
                        onClick={() => {
                          if (selectedThread) {
                            generateAiSuggestionMutation.mutate({
                              threadId: selectedThread.id,
                              context: `Help improve this message: "${newMessage}"`,
                              messageType: 'response',
                              tone: 'professional'
                            });
                          }
                        }}
                        title="Improve with AI"
                        data-testid="improve-message-ai"
                      >
                        <Sparkles className="w-3 h-3 text-blue-500" />
                      </Button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Dialog open={showDocumentGallery} onOpenChange={setShowDocumentGallery}>
                      <DialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          data-testid="button-view-documents"
                        >
                          <FileText className="w-4 h-4" />
                          {attachments.filter(a => a.documentStatus === 'pending_review').length > 0 && (
                            <Badge className="ml-1 bg-amber-100 text-amber-700 border-amber-300">
                              {attachments.filter(a => a.documentStatus === 'pending_review').length}
                            </Badge>
                          )}
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                        <DialogHeader>
                          <DialogTitle>Load Documents</DialogTitle>
                        </DialogHeader>
                        <DocumentGallery 
                          attachments={attachments}
                          loadId={selectedThread.loadId}
                          onApprove={(id) => approveDocumentMutation.mutate({ id, notes: '' })}
                          onReject={(id, notes) => rejectDocumentMutation.mutate({ id, notes })}
                          onRequestDocuments={handleRequestDocuments}
                        />
                      </DialogContent>
                    </Dialog>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (selectedThread?.driverId) {
                          sendPortalLinkMutation.mutate(selectedThread.driverId);
                        }
                      }}
                      disabled={!selectedThread?.driverId || sendPortalLinkMutation.isPending}
                      title="Send driver portal link via SMS"
                      data-testid="button-send-portal-link"
                    >
                      <Truck className="w-4 h-4" />
                    </Button>
                    <Button
                      onClick={handleSendMessage}
                      disabled={!newMessage.trim() || sendMessageMutation.isPending}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground"
                      data-testid="button-send-message"
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          /* No Thread Selected */
          <div className="flex-1 flex items-center justify-center bg-background">
            <div className="text-center">
              <MessageSquare className="w-20 h-20 mx-auto mb-4 text-muted-foreground" data-testid="icon-no-selection" />
              <h3 className="text-lg font-medium text-foreground mb-2" data-testid="text-no-selection-primary">Select a conversation</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto" data-testid="text-no-selection-secondary">
                Choose a conversation from the list to view messages and communicate with drivers
              </p>
              <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground/70">
                <span>💬 Real-time messaging</span>
                <span>•</span>
                <span>📱 SMS & Zello</span>
                <span>•</span>
                <span>🤖 AI assistance</span>
              </div>
            </div>
          </div>
        )}
      </div>


      {/* Unassigned Loads Dialog for Offering to Driver */}
      {showUnassignedLoads && selectedThread?.threadType === 'general' && (
        <Dialog open={showUnassignedLoads} onOpenChange={(open) => {
          setShowUnassignedLoads(open);
          if (!open) setLoadSearchQuery(""); // Reset search when closing
        }}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden bg-white border-2 border-gray-300 shadow-2xl">
            <DialogHeader>
              <DialogTitle>Select Load to Offer to {selectedThread.driverName}</DialogTitle>
            </DialogHeader>
            
            {/* Load Search Input */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Type load number to search (e.g., LOAD-123456)..."
                value={loadSearchQuery}
                onChange={(e) => setLoadSearchQuery(e.target.value)}
                className="pl-10"
                autoFocus
                data-testid="input-load-search"
              />
            </div>

            <ScrollArea className="h-[450px]">
              <div className="space-y-2">
                {/* Show loading state */}
                {(unassignedLoadsLoading || searchedLoadsLoading) && (
                  <div className="text-center py-8 text-gray-500">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                    Loading loads...
                  </div>
                )}

                {/* Show search results or unassigned loads */}
                {!unassignedLoadsLoading && !searchedLoadsLoading && (
                  <>
                    {loadSearchQuery ? (
                      // Show search results
                      searchedLoads.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                          <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
                          <p>No loads found matching "{loadSearchQuery}"</p>
                          <p className="text-sm mt-2">Try searching with a different load number</p>
                        </div>
                      ) : (
                        searchedLoads.map((load) => (
                          <Card 
                            key={load.id}
                            className="cursor-pointer hover:bg-gray-50"
                            onClick={() => {
                              offerLoadMutation.mutate({ 
                                threadId: selectedThread.id, 
                                loadId: load.id 
                              });
                            }}
                          >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h4 className="font-medium text-sm">{load.loadNumber}</h4>
                              <Badge className="bg-blue-100 text-blue-800 border-blue-200">
                                ${load.rate || 'TBD'}
                              </Badge>
                            </div>
                            <div className="space-y-1">
                              <p className="text-sm text-gray-700">
                                <MapPin className="w-3 h-3 inline mr-1" />
                                {load.origin} → {load.destination}
                              </p>
                              <p className="text-xs text-gray-600">
                                <Truck className="w-3 h-3 inline mr-1" />
                                {load.equipmentType || 'Any'} • {load.weight || 'N/A'} lbs
                              </p>
                              <p className="text-xs text-gray-600">
                                <Clock className="w-3 h-3 inline mr-1" />
                                Pickup: {load.pickupDate ? format(new Date(load.pickupDate), 'MMM dd, HH:mm') : 'ASAP'}
                              </p>
                              {load.brokerName && (
                                <p className="text-xs text-gray-500">
                                  Broker: {load.brokerName}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <Button
                              variant="default"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                offerLoadMutation.mutate({ 
                                  threadId: selectedThread.id, 
                                  loadId: load.id 
                                });
                              }}
                            >
                              Offer Load
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                        ))
                      )
                    ) : (
                      // Show unassigned loads when not searching
                      unassignedLoads.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                          <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
                          <p>No unassigned loads available</p>
                          <p className="text-sm mt-2">Use the search above to find any load by its number</p>
                        </div>
                      ) : (
                        unassignedLoads.map((load) => (
                          <Card 
                            key={load.id}
                            className="cursor-pointer hover:bg-gray-50"
                            onClick={() => {
                              offerLoadMutation.mutate({ 
                                threadId: selectedThread.id, 
                                loadId: load.id 
                              });
                            }}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-2">
                                    <h4 className="font-medium text-sm">{load.loadNumber}</h4>
                                    <Badge className="bg-blue-100 text-blue-800 border-blue-200">
                                      ${load.rate || 'TBD'}
                                    </Badge>
                                  </div>
                                  <div className="space-y-1">
                                    <p className="text-sm text-gray-700">
                                      <MapPin className="w-3 h-3 inline mr-1" />
                                      {load.origin} → {load.destination}
                                    </p>
                                    <p className="text-xs text-gray-600">
                                      <Truck className="w-3 h-3 inline mr-1" />
                                      {load.equipmentType || 'Any'} • {load.weight || 'N/A'} lbs
                                    </p>
                                    <p className="text-xs text-gray-600">
                                      <Clock className="w-3 h-3 inline mr-1" />
                                      Pickup: {load.pickupDate ? format(new Date(load.pickupDate), 'MMM dd, HH:mm') : 'ASAP'}
                                    </p>
                                    {load.brokerName && (
                                      <p className="text-xs text-gray-500">
                                        Broker: {load.brokerName}
                                      </p>
                                    )}
                                  </div>
                                </div>
                                <div className="text-right">
                                  <Button
                                    variant="default"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      offerLoadMutation.mutate({ 
                                        threadId: selectedThread.id, 
                                        loadId: load.id 
                                      });
                                    }}
                                  >
                                    Offer Load
                                  </Button>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))
                      )
                    )}
                  </>
                )}
              </div>
            </ScrollArea>
            <DialogFooter>
              <Button 
                variant="outline" 
                onClick={() => {
                  setShowUnassignedLoads(false);
                  setLoadSearchQuery("");
                }}
              >
                Cancel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}