import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Send, Copy, MapPin, Users, Clock, CheckCircle, MessageCircle, Trash2, AlertTriangle, UserPlus, BarChart3, Search, Filter, ChevronUp, ChevronDown } from "lucide-react";
import type { Driver, OnboardingToken } from "@shared/schema";
import { EQUIPMENT_TYPES } from "@shared/equipment-types";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { DriverPerformanceModal } from "@/components/DriverPerformanceModal";

const inviteDriverSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

const smsDriverSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  phone: z.string().min(10, "Please enter a valid phone number"),
});

const manualDriverSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  phone: z.string().min(10, "Please enter a valid phone number"),
  licenseNumber: z.string().min(5, "License number is required"),
  licenseState: z.string().min(2, "License state is required"),
  licenseExpiry: z.string().min(1, "License expiry date is required"),
  equipmentType: z.string().min(1, "Equipment type is required"),
  maxWeight: z.number().min(1000, "Maximum weight must be at least 1000 lbs"),
  maxLength: z.number().min(10, "Maximum length must be at least 10 ft"),
  loadType: z.enum(["full", "partial", "full_partial"]),
  city: z.string().min(2, "City is required"),
  state: z.string().min(2, "State is required"),
  zipCode: z.string().min(5, "ZIP code is required"),
  vehicleYear: z.string().min(4, "Vehicle year is required"),
  vehicleMake: z.string().min(2, "Vehicle make is required"),
  vehicleModel: z.string().optional(),
});

type InviteDriverForm = z.infer<typeof inviteDriverSchema>;
type SMSDriverForm = z.infer<typeof smsDriverSchema>;
type ManualDriverForm = z.infer<typeof manualDriverSchema>;

export default function DriverManagement() {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showSMSModal, setShowSMSModal] = useState(false);
  const [showTelegramModal, setShowTelegramModal] = useState(false);
  const [showManualOnboardingModal, setShowManualOnboardingModal] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string>("");
  const [driverToDelete, setDriverToDelete] = useState<Driver | null>(null);
  const [performanceDriver, setPerformanceDriver] = useState<Driver | null>(null);
  const [showPerformanceModal, setShowPerformanceModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "available" | "on_route" | "unavailable">("all");
  const [sortKey, setSortKey] = useState<'name' | 'status' | 'equipment' | 'location' | 'createdAt'>('createdAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const { toast } = useToast();

  const telegramForm = useForm<SMSDriverForm>({
    resolver: zodResolver(smsDriverSchema),
    defaultValues: {
      email: "",
      phone: ""
    }
  });
  const queryClient = useQueryClient();

  const form = useForm<InviteDriverForm>({
    resolver: zodResolver(inviteDriverSchema),
    defaultValues: {
      email: "",
    },
  });

  const smsForm = useForm<SMSDriverForm>({
    resolver: zodResolver(smsDriverSchema),
    defaultValues: {
      email: "",
      phone: "",
    },
  });

  const manualForm = useForm<ManualDriverForm>({
    resolver: zodResolver(manualDriverSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      licenseNumber: "",
      licenseState: "",
      licenseExpiry: "",
      equipmentType: "",
      maxWeight: 26000,
      maxLength: 53,
      loadType: "full_partial",
      city: "",
      state: "",
      zipCode: "",
      vehicleYear: "",
      vehicleMake: "",
      vehicleModel: "",
    },
  });

  const { data: drivers = [], isLoading: driversLoading } = useQuery<Driver[]>({
    queryKey: ["/api/drivers"],
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  });

  const { data: onboardingTokens = [], isLoading: tokensLoading } = useQuery<OnboardingToken[]>({
    queryKey: ["/api/onboarding-tokens"],
  });

  const { data: driverLocations = [] } = useQuery({
    queryKey: ["/api/driver-locations"],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const createInviteMutation = useMutation({
    mutationFn: async (data: InviteDriverForm) => {
      const response = await apiRequest("POST", "/api/create-onboarding-invite", data);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding-tokens"] });
      const inviteLink = `${window.location.origin}/driver-onboarding?token=${data.token}`;
      
      // Copy to clipboard
      navigator.clipboard.writeText(inviteLink);
      setCopiedToken(data.token);
      
      toast({
        title: "Invitation Created",
        description: "Onboarding link has been copied to clipboard",
      });
      
      form.reset();
      setShowInviteModal(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create invitation",
        variant: "destructive",
      });
    },
  });

  const createSMSInviteMutation = useMutation({
    mutationFn: async (data: SMSDriverForm) => {
      const response = await apiRequest("POST", "/api/create-sms-onboarding-invite", data);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding-tokens"] });
      
      toast({
        title: "SMS Invitation Sent",
        description: `Onboarding link sent to ${data.phone}`,
      });
      
      smsForm.reset();
      setShowSMSModal(false);
    },
    onError: (error: any) => {
      console.error("SMS error:", error);
      
      // Check if this is a trial account error
      if (error.response?.data?.isTrialAccount) {
        toast({
          title: "Phone Verification Required",
          description: "Trial accounts can only send SMS to verified numbers. Visit Twilio Console → Phone Numbers → Manage → Verified to add your number.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "SMS Delivery Failed",
          description: error.response?.data?.details || "Failed to send SMS invitation. Please check the phone number format.",
          variant: "destructive",
        });
      }
    },
  });

  const createTelegramInviteMutation = useMutation({
    mutationFn: async (data: SMSDriverForm) => {
      const response = await apiRequest("POST", "/api/create-telegram-onboarding-invite", data);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding-tokens"] });
      
      toast({
        title: "Telegram Invitation Created",
        description: data.botLink 
          ? `Share this bot link with the driver: ${data.botLink}` 
          : `Telegram invitation created for ${data.phone}. Share the bot link for automatic onboarding.`,
      });
      
      telegramForm.reset();
      setShowTelegramModal(false);
    },
    onError: (error: any) => {
      console.error("Telegram error:", error);
      
      toast({
        title: "Telegram Delivery Failed",
        description: error.response?.data?.details || "Failed to send Telegram invitation. User needs to start a chat with your bot first.",
        variant: "destructive",
      });
    },
  });

  const deleteDriverMutation = useMutation({
    mutationFn: async (driverId: string) => {
      const response = await apiRequest("DELETE", `/api/drivers/${driverId}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
      toast({
        title: "Driver Removed",
        description: "Driver has been successfully removed from your fleet",
      });
      setDriverToDelete(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to remove driver",
        variant: "destructive",
      });
    },
  });

  const createManualDriverMutation = useMutation({
    mutationFn: async (data: ManualDriverForm) => {
      console.log("Sending manual driver data:", data);
      const response = await apiRequest("POST", "/api/drivers/manual-onboard", data);
      console.log("API response status:", response.status);
      
      if (!response.ok) {
        const errorData = await response.json();
        console.log("API error response:", errorData);
        throw new Error(errorData.error || errorData.message || "Failed to create driver");
      }
      
      const result = await response.json();
      console.log("API success response:", result);
      return result;
    },
    onSuccess: (data) => {
      console.log("Driver creation successful:", data);
      queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
      toast({
        title: "Driver Created",
        description: `Driver ${data.name} has been successfully onboarded to your fleet`,
      });
      manualForm.reset();
      setShowManualOnboardingModal(false);
    },
    onError: (error: any) => {
      console.log("Driver creation error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to create driver",
        variant: "destructive",
      });
    },
  });

  const getDriverStatusBadge = (driver: Driver) => {
    const statusConfig = {
      available: { label: "Available", className: "bg-success/10 text-success border border-success/30" },
      on_route: { label: "On Route", className: "bg-primary/10 text-primary border border-primary/30" },
      unavailable: { label: "Unavailable", className: "bg-muted/10 text-muted-foreground border border-muted/30" },
    };

    const config = statusConfig[driver.status as keyof typeof statusConfig] || statusConfig.available;
    
    return (
      <Badge className={`${config.className} font-medium px-3 py-1`}>
        {config.label}
      </Badge>
    );
  };

  const getTokenStatusBadge = (token: OnboardingToken) => {
    const isExpired = new Date(token.expiresAt) < new Date();
    
    if (token.isUsed) {
      return <Badge className="bg-success/10 text-success border border-success/30 font-medium px-3 py-1">Completed</Badge>;
    } else if (isExpired) {
      return <Badge className="bg-destructive/10 text-destructive border border-destructive/30 font-medium px-3 py-1">Expired</Badge>;
    } else {
      return <Badge className="bg-primary/10 text-primary border border-primary/30 font-medium px-3 py-1">Sent</Badge>;
    }
  };

  const copyInviteLink = (token: string) => {
    const inviteLink = `${window.location.origin}/driver-onboarding?token=${token}`;
    navigator.clipboard.writeText(inviteLink);
    setCopiedToken(token);
    toast({
      title: "Link Copied",
      description: "Invitation link copied to clipboard",
    });
  };

  // Sort function
  const getSortedDrivers = (drivers: Driver[]) => {
    return [...drivers].sort((a, b) => {
      let comparison = 0;
      switch (sortKey) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'status':
          comparison = a.status.localeCompare(b.status);
          break;
        case 'equipment':
          comparison = (a.equipmentType || '').localeCompare(b.equipmentType || '');
          break;
        case 'location':
          comparison = (a.city || '').localeCompare(b.city || '');
          break;
        case 'createdAt':
          comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  };

  // Health badge helper
  const getHealthBadge = (driver: Driver) => {
    const safetyScore = driver.safetyScore ?? 100;
    const maintenanceScore = driver.maintenanceScore ?? 100;
    const score = Math.round((safetyScore + maintenanceScore) / 2);
    if (score >= 90) return { label: 'Excellent', color: 'bg-success/10 text-success border border-success/30' };
    if (score >= 75) return { label: 'Good', color: 'bg-primary/10 text-primary border border-primary/30' };
    if (score >= 60) return { label: 'Fair', color: 'bg-warning/10 text-warning border border-warning/30' };
    return { label: 'Needs Attention', color: 'bg-destructive/10 text-destructive border border-destructive/30' };
  };

  // Handle column header click for sorting
  const handleSort = (key: 'name' | 'status' | 'equipment' | 'location' | 'createdAt') => {
    if (sortKey === key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const onboardedDrivers = drivers.filter(driver => driver.isOnboarded);
  const activeDrivers = onboardedDrivers.filter(driver => driver.status === "available" || driver.status === "on_route");
  
  // Sort drivers first, then filter and search
  const sortedDrivers = getSortedDrivers(drivers);
  
  // Filter and search logic - using all drivers, not just onboarded
  const filteredDrivers = sortedDrivers.filter(driver => {
    // Status filter
    if (statusFilter !== "all" && driver.status !== statusFilter) {
      return false;
    }
    
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        driver.name.toLowerCase().includes(query) ||
        driver.email?.toLowerCase().includes(query) ||
        driver.phone?.toLowerCase().includes(query) ||
        driver.city?.toLowerCase().includes(query) ||
        driver.equipmentType?.toLowerCase().includes(query)
      );
    }
    
    return true;
  });

  if (driversLoading || tokensLoading) {
    return (
      <div className="p-8 bg-background min-h-screen">
        <div className="animate-pulse space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-card rounded-xl border border-border p-6">
                <div className="h-20 bg-muted/50 rounded"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 bg-background min-h-screen">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground" data-testid="heading-driver-management">
              Driver Management
            </h1>
            <p className="text-muted-foreground mt-1" data-testid="text-driver-count">
              {filteredDrivers.length} of {drivers.length} drivers
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Dialog open={showManualOnboardingModal} onOpenChange={setShowManualOnboardingModal}>
              <DialogTrigger asChild>
                <Button className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm" data-testid="button-add-driver">
                  <UserPlus className="mr-2 w-4 h-4" />
                  Add Driver
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-card border border-border shadow-lg max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="manual-onboarding-modal">
                <DialogHeader>
                  <DialogTitle className="text-foreground">Add Driver Manually</DialogTitle>
                  <DialogDescription className="text-muted-foreground">
                    Manually create a driver profile when you have all necessary information ready
                  </DialogDescription>
                </DialogHeader>
                <Form {...manualForm}>
                  <form onSubmit={manualForm.handleSubmit((data) => createManualDriverMutation.mutate(data))} className="space-y-6">
                    {/* Basic Information */}
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold text-foreground">Basic Information</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField
                          control={manualForm.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-foreground font-medium">Full Name *</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  placeholder="John Doe"
                                  className="bg-input border-border text-foreground"
                                  data-testid="input-manual-name"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={manualForm.control}
                          name="phone"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-foreground font-medium">Phone Number *</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  type="tel"
                                  placeholder="+1 (555) 123-4567"
                                  className="bg-input border-border text-foreground"
                                  data-testid="input-manual-phone"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <FormField
                        control={manualForm.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-foreground font-medium">Email Address *</FormLabel>
                            <FormControl>
                              <Input 
                                {...field} 
                                type="email"
                                placeholder="driver@example.com"
                                className="bg-input border-border text-foreground"
                                data-testid="input-manual-email"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    {/* License Information */}
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold text-foreground">License Information</h3>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <FormField
                          control={manualForm.control}
                          name="licenseNumber"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-foreground font-medium">License Number *</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  placeholder="DL123456"
                                  className="bg-input border-border text-foreground"
                                  data-testid="input-manual-license"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={manualForm.control}
                          name="licenseState"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-foreground font-medium">License State *</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  placeholder="GA"
                                  className="bg-input border-border text-foreground"
                                  data-testid="input-manual-license-state"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={manualForm.control}
                          name="licenseExpiry"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-foreground font-medium">License Expiry *</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  type="date"
                                  className="bg-input border-border text-foreground"
                                  data-testid="input-manual-expiry"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>

                    {/* Equipment & Capacity */}
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold text-foreground">Equipment & Capacity</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField
                          control={manualForm.control}
                          name="equipmentType"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-foreground font-medium">Equipment Type *</FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl>
                                  <SelectTrigger className="bg-input border-border text-foreground" data-testid="select-equipment-type">
                                    <SelectValue placeholder="Select equipment type" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent className="bg-card border-border shadow-lg">
                                  {EQUIPMENT_TYPES.map((equipment) => (
                                    <SelectItem key={equipment.value} value={equipment.value}>
                                      {equipment.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={manualForm.control}
                          name="loadType"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-foreground font-medium">Load Type Preference</FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl>
                                  <SelectTrigger className="bg-input border-border text-foreground" data-testid="select-load-type">
                                    <SelectValue placeholder="Select load type" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent className="bg-card border-border shadow-lg">
                                  <SelectItem value="full">Full Loads Only</SelectItem>
                                  <SelectItem value="partial">Partial Loads Only</SelectItem>
                                  <SelectItem value="full_partial">Both Full & Partial</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField
                          control={manualForm.control}
                          name="maxWeight"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-foreground font-medium">Max Weight (lbs)</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  type="number"
                                  value={field.value || ""}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    field.onChange(value === "" ? "" : Number(value));
                                  }}
                                  placeholder="26000"
                                  className="bg-input border-border text-foreground"
                                  data-testid="input-manual-weight"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={manualForm.control}
                          name="maxLength"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-foreground font-medium">Max Length (ft)</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  type="number"
                                  value={field.value || ""}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    field.onChange(value === "" ? "" : Number(value));
                                  }}
                                  placeholder="53"
                                  className="bg-input border-border text-foreground"
                                  data-testid="input-manual-length"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>

                    {/* Location */}
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold text-foreground">Location</h3>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <FormField
                          control={manualForm.control}
                          name="city"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-foreground font-medium">City *</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  placeholder="Atlanta"
                                  className="bg-input border-border text-foreground"
                                  data-testid="input-manual-city"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={manualForm.control}
                          name="state"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-foreground font-medium">State *</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  placeholder="GA"
                                  className="bg-input border-border text-foreground"
                                  data-testid="input-manual-location-state"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={manualForm.control}
                          name="zipCode"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-foreground font-medium">ZIP Code *</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  placeholder="30309"
                                  className="bg-input border-border text-foreground"
                                  data-testid="input-manual-zip"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>

                    {/* Vehicle Information */}
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold text-foreground">Vehicle Information</h3>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <FormField
                          control={manualForm.control}
                          name="vehicleYear"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-foreground font-medium">Vehicle Year *</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  placeholder="2023"
                                  className="bg-input border-border text-foreground"
                                  data-testid="input-manual-vehicle-year"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={manualForm.control}
                          name="vehicleMake"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-foreground font-medium">Vehicle Make *</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  placeholder="Freightliner"
                                  className="bg-input border-border text-foreground"
                                  data-testid="input-manual-vehicle-make"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={manualForm.control}
                          name="vehicleModel"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-foreground font-medium">Vehicle Model (Optional)</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  placeholder="Cascadia"
                                  className="bg-input border-border text-foreground"
                                  data-testid="input-manual-vehicle-model"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>

                    <div className="flex justify-end space-x-4 pt-4">
                      <Button 
                        type="button" 
                        variant="outline" 
                        className="border-border hover:bg-muted"
                        onClick={() => setShowManualOnboardingModal(false)}
                      >
                        Cancel
                      </Button>
                      <Button 
                        type="submit" 
                        disabled={createManualDriverMutation.isPending}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground"
                        data-testid="button-create-manual-driver"
                      >
                        {createManualDriverMutation.isPending ? "Creating Driver..." : "Create Driver"}
                      </Button>
                    </div>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card className="bg-card border-border hover:border-primary/30 transition-all hover:shadow-lg">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Total Drivers</p>
                <p className="text-4xl font-bold text-primary" data-testid="metric-total-drivers">{drivers.length}</p>
              </div>
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                <Users className="w-6 h-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border hover:border-success/30 transition-all hover:shadow-lg">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Available</p>
                <p className="text-4xl font-bold text-success" data-testid="metric-available-drivers">
                  {drivers.filter(d => d.status === "available").length}
                </p>
              </div>
              <div className="w-12 h-12 bg-success/10 rounded-lg flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-success" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border hover:border-warning/30 transition-all hover:shadow-lg">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">On Route</p>
                <p className="text-4xl font-bold text-warning" data-testid="metric-onroute-drivers">
                  {drivers.filter(d => d.status === "on_route").length}
                </p>
              </div>
              <div className="w-12 h-12 bg-warning/10 rounded-lg flex items-center justify-center">
                <Clock className="w-6 h-6 text-warning" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search and Filter Section */}
      <Card className="mb-6 bg-card border-border">
        <CardContent className="p-6">
          <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
            {/* Search Bar */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-5 h-5" />
              <Input
                type="text"
                placeholder="Search drivers by name, email, phone, city, or equipment..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-input border-border text-foreground"
                data-testid="input-search-drivers"
              />
            </div>
            
            {/* Status Filter Tabs */}
            <Tabs value={statusFilter} onValueChange={(value: any) => setStatusFilter(value)} className="w-full lg:w-auto">
              <TabsList className="grid w-full lg:w-auto grid-cols-4 bg-muted" data-testid="tabs-status-filter">
                <TabsTrigger value="all" className="data-[state=active]:bg-card data-[state=active]:text-foreground" data-testid="tab-all">
                  All
                </TabsTrigger>
                <TabsTrigger value="available" className="data-[state=active]:bg-card data-[state=active]:text-foreground" data-testid="tab-available">
                  Available
                </TabsTrigger>
                <TabsTrigger value="on_route" className="data-[state=active]:bg-card data-[state=active]:text-foreground" data-testid="tab-on-route">
                  On Route
                </TabsTrigger>
                <TabsTrigger value="unavailable" className="data-[state=active]:bg-card data-[state=active]:text-foreground" data-testid="tab-unavailable">
                  Unavailable
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardContent>
      </Card>

      {/* Drivers Table */}
      <Card className="bg-card border-border">
        <CardContent className="p-0">
          {filteredDrivers.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="w-16 h-16 mx-auto text-muted mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">No drivers found</h3>
              <p className="text-sm">
                {searchQuery || statusFilter !== "all" 
                  ? "Try adjusting your search or filter criteria"
                  : "Add your first driver to get started"}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50 border-b border-border">
                  <TableHead 
                    className="font-semibold text-foreground cursor-pointer hover:bg-muted/70 transition-colors" 
                    onClick={() => handleSort('name')}
                    data-testid="header-sort-name"
                  >
                    <div className="flex items-center gap-2">
                      Driver
                      {sortKey === 'name' && (
                        sortDirection === 'asc' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
                      )}
                    </div>
                  </TableHead>
                  <TableHead className="font-semibold text-foreground">Contact</TableHead>
                  <TableHead 
                    className="font-semibold text-foreground cursor-pointer hover:bg-muted/70 transition-colors" 
                    onClick={() => handleSort('equipment')}
                    data-testid="header-sort-equipment"
                  >
                    <div className="flex items-center gap-2">
                      Equipment & Location
                      {sortKey === 'equipment' && (
                        sortDirection === 'asc' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
                      )}
                    </div>
                  </TableHead>
                  <TableHead 
                    className="font-semibold text-foreground cursor-pointer hover:bg-muted/70 transition-colors" 
                    onClick={() => handleSort('status')}
                    data-testid="header-sort-status"
                  >
                    <div className="flex items-center gap-2">
                      Status
                      {sortKey === 'status' && (
                        sortDirection === 'asc' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
                      )}
                    </div>
                  </TableHead>
                  <TableHead className="font-semibold text-foreground">Health</TableHead>
                  <TableHead 
                    className="font-semibold text-foreground cursor-pointer hover:bg-muted/70 transition-colors" 
                    onClick={() => handleSort('createdAt')}
                    data-testid="header-sort-date-added"
                  >
                    <div className="flex items-center gap-2">
                      Date Added
                      {sortKey === 'createdAt' && (
                        sortDirection === 'asc' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
                      )}
                    </div>
                  </TableHead>
                  <TableHead className="font-semibold text-foreground text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDrivers.map((driver) => (
                  <TableRow key={driver.id} className="hover:bg-muted/50 hover:border-primary/30 transition-all border-b border-border" data-testid={`driver-row-${driver.id}`}>
                    {/* Driver Column */}
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                          <Users className="text-primary w-5 h-5" />
                        </div>
                        <div>
                          <div className="font-medium text-foreground" data-testid={`text-driver-name-${driver.id}`}>
                            {driver.name}
                          </div>
                        </div>
                      </div>
                    </TableCell>

                    {/* Contact Column */}
                    <TableCell>
                      <div className="space-y-1">
                        <div className="text-sm text-foreground" data-testid={`text-driver-email-${driver.id}`}>
                          {driver.email}
                        </div>
                        <div className="text-sm text-muted-foreground" data-testid={`text-driver-phone-${driver.id}`}>
                          {driver.phone}
                        </div>
                      </div>
                    </TableCell>

                    {/* Equipment & Location Column */}
                    <TableCell>
                      <div className="space-y-1">
                        <div className="text-sm font-medium text-foreground" data-testid={`text-driver-equipment-${driver.id}`}>
                          {driver.equipmentType || "Not specified"}
                        </div>
                        <div className="text-sm text-muted-foreground flex items-center gap-1" data-testid={`text-driver-location-${driver.id}`}>
                          <MapPin className="w-3 h-3" />
                          {driver.city}, {driver.state}
                        </div>
                      </div>
                    </TableCell>

                    {/* Status Column */}
                    <TableCell data-testid={`status-driver-${driver.id}`}>
                      {getDriverStatusBadge(driver)}
                    </TableCell>

                    {/* Health Column */}
                    <TableCell data-testid={`health-driver-${driver.id}`}>
                      {(() => {
                        const healthBadge = getHealthBadge(driver);
                        return (
                          <Badge className={`${healthBadge.color} font-medium px-3 py-1`}>
                            {healthBadge.label}
                          </Badge>
                        );
                      })()}
                    </TableCell>

                    {/* Date Added Column */}
                    <TableCell data-testid={`date-added-driver-${driver.id}`}>
                      <div className="text-sm text-muted-foreground">
                        {new Date(driver.createdAt).toLocaleDateString('en-US', { 
                          year: 'numeric', 
                          month: 'short', 
                          day: 'numeric' 
                        })}
                      </div>
                    </TableCell>

                    {/* Actions Column */}
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          title="View Performance"
                          onClick={() => {
                            setPerformanceDriver(driver);
                            setShowPerformanceModal(true);
                          }}
                          className="text-primary hover:text-primary/90 hover:bg-primary/10 transition-colors"
                          data-testid={`button-performance-${driver.id}`}
                        >
                          <BarChart3 className="w-4 h-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              title="Remove Driver"
                              className="hover:bg-destructive/10 hover:text-destructive transition-colors"
                              data-testid={`button-delete-driver-${driver.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="bg-card border-border shadow-lg">
                            <AlertDialogHeader>
                              <AlertDialogTitle className="flex items-center gap-2 text-foreground">
                                <AlertTriangle className="w-5 h-5 text-destructive" />
                                Remove Driver
                              </AlertDialogTitle>
                              <AlertDialogDescription className="text-muted-foreground">
                                Are you sure you want to remove <strong className="text-foreground">{driver.name}</strong> from your fleet? 
                                This action cannot be undone and will:
                                <ul className="list-disc list-inside mt-2 space-y-1">
                                  <li>Remove the driver from all future load offers</li>
                                  <li>Delete their profile and contact information</li>
                                  <li>Remove access to the driver portal</li>
                                </ul>
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="border-border hover:bg-muted">
                                Cancel
                              </AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteDriverMutation.mutate(driver.id)}
                                disabled={deleteDriverMutation.isPending}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                data-testid={`button-confirm-delete-${driver.id}`}
                              >
                                {deleteDriverMutation.isPending ? "Removing..." : "Remove Driver"}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Invite Driver Modal */}
      <Dialog open={showInviteModal} onOpenChange={setShowInviteModal}>
        <DialogContent data-testid="invite-driver-modal" className="bg-card border-border shadow-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground">Invite New Driver</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Send an onboarding link via email
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((data) => createInviteMutation.mutate(data))} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground font-medium">Driver Email</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        type="email"
                        placeholder="driver@example.com"
                        className="bg-input border-border text-foreground"
                        data-testid="input-invite-email"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end space-x-4">
                <Button 
                  type="button" 
                  variant="outline" 
                  className="border-border hover:bg-muted"
                  onClick={() => setShowInviteModal(false)}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={createInviteMutation.isPending}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
                  data-testid="button-send-invite"
                >
                  {createInviteMutation.isPending ? "Creating..." : "Create Invite"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* SMS Driver Modal */}
      <Dialog open={showSMSModal} onOpenChange={setShowSMSModal}>
        <DialogContent data-testid="create-driver-sms-modal" className="bg-card border-border shadow-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground">Create Driver via SMS</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Send an onboarding link via text message
            </DialogDescription>
          </DialogHeader>
          <Form {...smsForm}>
            <form onSubmit={smsForm.handleSubmit((data) => createSMSInviteMutation.mutate(data))} className="space-y-4">
              <FormField
                control={smsForm.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground font-medium">Driver Phone Number</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        type="tel"
                        placeholder="+1 (555) 123-4567"
                        className="bg-input border-border text-foreground"
                        data-testid="input-driver-phone"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={smsForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground font-medium">Driver Email</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        type="email"
                        placeholder="driver@example.com"
                        className="bg-input border-border text-foreground"
                        data-testid="input-driver-email-sms"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end space-x-4">
                <Button 
                  type="button" 
                  variant="outline" 
                  className="border-border hover:bg-muted"
                  onClick={() => setShowSMSModal(false)}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={createSMSInviteMutation.isPending}
                  className="bg-success hover:bg-success/90 text-success-foreground"
                  data-testid="button-send-sms-invite"
                >
                  {createSMSInviteMutation.isPending ? "Sending..." : "Send SMS Invite"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Telegram Driver Modal */}
      <Dialog open={showTelegramModal} onOpenChange={setShowTelegramModal}>
        <DialogContent data-testid="create-driver-telegram-modal" className="bg-card border-border shadow-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground">Create Driver via Telegram</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Send an onboarding link via Telegram
            </DialogDescription>
          </DialogHeader>
          <Form {...telegramForm}>
            <form onSubmit={telegramForm.handleSubmit((data) => createTelegramInviteMutation.mutate(data))} className="space-y-4">
              <FormField
                control={telegramForm.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground font-medium">Driver Phone Number</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        type="tel"
                        placeholder="+1 (555) 123-4567"
                        className="bg-input border-border text-foreground"
                        data-testid="input-driver-phone-telegram"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={telegramForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground font-medium">Driver Email</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        type="email"
                        placeholder="driver@example.com"
                        className="bg-input border-border text-foreground"
                        data-testid="input-driver-email-telegram"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end space-x-4">
                <Button 
                  type="button" 
                  variant="outline" 
                  className="border-border hover:bg-muted"
                  onClick={() => setShowTelegramModal(false)}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={createTelegramInviteMutation.isPending}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
                  data-testid="button-send-telegram-invite"
                >
                  {createTelegramInviteMutation.isPending ? "Sending..." : "Send Telegram Invite"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Performance Modal */}
      <DriverPerformanceModal
        driver={performanceDriver}
        isOpen={showPerformanceModal}
        onClose={() => {
          setShowPerformanceModal(false);
          setPerformanceDriver(null);
        }}
      />
    </div>
  );
}