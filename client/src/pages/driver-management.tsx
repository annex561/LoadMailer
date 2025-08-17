import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Send, Copy, MapPin, Users, Clock, CheckCircle, MessageCircle, Trash2, AlertTriangle, UserPlus } from "lucide-react";
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
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

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
      const response = await apiRequest("POST", "/api/drivers/manual-onboard", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
      toast({
        title: "Driver Created",
        description: "Driver has been successfully onboarded to your fleet",
      });
      manualForm.reset();
      setShowManualOnboardingModal(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create driver",
        variant: "destructive",
      });
    },
  });

  const getDriverStatusBadge = (driver: Driver) => {
    const statusConfig = {
      available: { label: "Available", className: "bg-success bg-opacity-10 text-success" },
      on_route: { label: "On Route", className: "bg-warning bg-opacity-10 text-warning" },
      unavailable: { label: "Unavailable", className: "bg-destructive bg-opacity-10 text-destructive" },
    };

    const config = statusConfig[driver.status as keyof typeof statusConfig] || statusConfig.available;
    
    return (
      <Badge className={`${config.className} border-0`}>
        {config.label}
      </Badge>
    );
  };

  const getTokenStatusBadge = (token: OnboardingToken) => {
    const isExpired = new Date(token.expiresAt) < new Date();
    
    if (token.isUsed) {
      return <Badge className="bg-success bg-opacity-10 text-success border-0">Completed</Badge>;
    } else if (isExpired) {
      return <Badge className="bg-destructive bg-opacity-10 text-destructive border-0">Expired</Badge>;
    } else {
      return <Badge className="bg-blue-500 bg-opacity-10 text-blue-600 border-0">Sent</Badge>;
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

  const onboardedDrivers = drivers.filter(driver => driver.isOnboarded);
  const activeDrivers = onboardedDrivers.filter(driver => driver.status === "available" || driver.status === "on_route");

  if (driversLoading || tokensLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="h-20 bg-gray-200 rounded"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Total Drivers</p>
                <p className="text-3xl font-bold text-gray-900">{onboardedDrivers.length}</p>
              </div>
              <div className="w-12 h-12 bg-primary bg-opacity-10 rounded-lg flex items-center justify-center">
                <Users className="text-primary w-6 h-6" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Active Drivers</p>
                <p className="text-3xl font-bold text-gray-900">{activeDrivers.length}</p>
              </div>
              <div className="w-12 h-12 bg-success bg-opacity-10 rounded-lg flex items-center justify-center">
                <MapPin className="text-success w-6 h-6" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Pending Invites</p>
                <p className="text-3xl font-bold text-gray-900">
                  {onboardingTokens.filter(token => !token.isUsed && new Date(token.expiresAt) > new Date()).length}
                </p>
              </div>
              <div className="w-12 h-12 bg-warning bg-opacity-10 rounded-lg flex items-center justify-center">
                <Clock className="text-warning w-6 h-6" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Current Drivers */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-primary" />
                  Current Drivers
                </CardTitle>
                <p className="text-sm text-gray-500">Manage your active driver fleet</p>
              </div>
              <Dialog open={showInviteModal} onOpenChange={setShowInviteModal}>
                <DialogTrigger asChild>
                  <Button className="bg-primary text-white hover:bg-blue-700" data-testid="button-invite-driver">
                    <Plus className="mr-2 w-4 h-4" />
                    Invite Driver
                  </Button>
                </DialogTrigger>
                <DialogContent data-testid="invite-driver-modal" className="bg-white border border-gray-300 shadow-lg">
                  <DialogHeader>
                    <DialogTitle>Invite New Driver</DialogTitle>
                    <p className="text-sm text-gray-500">Send an onboarding link via email</p>
                  </DialogHeader>
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit((data) => createInviteMutation.mutate(data))} className="space-y-4">
                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Driver Email</FormLabel>
                            <FormControl>
                              <Input 
                                {...field} 
                                type="email"
                                placeholder="driver@example.com"
                                className="bg-white border border-gray-300"
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
                          className="bg-white border border-gray-300"
                          onClick={() => setShowInviteModal(false)}
                        >
                          Cancel
                        </Button>
                        <Button 
                          type="submit" 
                          disabled={createInviteMutation.isPending}
                          className="bg-primary text-white hover:bg-blue-700"
                          data-testid="button-send-invite"
                        >
                          {createInviteMutation.isPending ? "Creating..." : "Create Invite"}
                        </Button>
                      </div>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {onboardedDrivers.map((driver) => (
                <div 
                  key={driver.id} 
                  className="flex items-center justify-between p-4 border border-gray-200 rounded-lg"
                  data-testid={`driver-item-${driver.id}`}
                >
                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 bg-primary bg-opacity-10 rounded-full flex items-center justify-center">
                      <Users className="text-primary w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-medium text-gray-900">{driver.name}</h4>
                      <p className="text-sm text-gray-500">{driver.email}</p>
                      <p className="text-sm text-gray-500">{driver.phone}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {getDriverStatusBadge(driver)}
                    <Button variant="ghost" size="sm" title="View Location">
                      <MapPin className="w-4 h-4 text-blue-600" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          title="Remove Driver"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          data-testid={`button-delete-driver-${driver.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="bg-white border border-gray-300 shadow-lg">
                        <AlertDialogHeader>
                          <AlertDialogTitle className="flex items-center gap-2">
                            <AlertTriangle className="w-5 h-5 text-red-600" />
                            Remove Driver
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to remove <strong>{driver.name}</strong> from your fleet? 
                            This action cannot be undone and will:
                            <ul className="list-disc list-inside mt-2 space-y-1">
                              <li>Remove the driver from all future load offers</li>
                              <li>Delete their profile and contact information</li>
                              <li>Remove access to the driver portal</li>
                            </ul>
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="bg-white border border-gray-300">
                            Cancel
                          </AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteDriverMutation.mutate(driver.id)}
                            disabled={deleteDriverMutation.isPending}
                            className="bg-red-600 text-white hover:bg-red-700"
                            data-testid={`button-confirm-delete-${driver.id}`}
                          >
                            {deleteDriverMutation.isPending ? "Removing..." : "Remove Driver"}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
              
              {onboardedDrivers.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  No drivers onboarded yet. Send your first invitation to get started.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Add New Drivers */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Plus className="w-5 h-5 text-green-600" />
                  Add New Drivers
                </CardTitle>
                <p className="text-sm text-gray-500">Invite drivers via email or SMS</p>
              </div>
              <Dialog open={showSMSModal} onOpenChange={setShowSMSModal}>
                <DialogTrigger asChild>
                  <Button className="bg-green-600 text-white hover:bg-green-700" data-testid="button-create-driver-sms">
                    <MessageCircle className="mr-2 w-4 h-4" />
                    Send SMS Link
                  </Button>
                </DialogTrigger>
                <DialogContent data-testid="create-driver-sms-modal" className="bg-white border border-gray-300 shadow-lg">
                  <DialogHeader>
                    <DialogTitle>Create Driver via SMS</DialogTitle>
                    <p className="text-sm text-gray-500">Send an onboarding link via text message</p>
                  </DialogHeader>
                  <Form {...smsForm}>
                    <form onSubmit={smsForm.handleSubmit((data) => createSMSInviteMutation.mutate(data))} className="space-y-4">
                      <FormField
                        control={smsForm.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Driver Phone Number</FormLabel>
                            <FormControl>
                              <Input 
                                {...field} 
                                type="tel"
                                placeholder="+1 (555) 123-4567"
                                className="bg-white border border-gray-300"
                                data-testid="input-driver-phone"
                              />
                            </FormControl>
                            <p className="text-xs text-amber-600 mt-1">
                              📱 For trial accounts, this number must be verified in your Twilio console first
                            </p>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={smsForm.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Driver Email</FormLabel>
                            <FormControl>
                              <Input 
                                {...field} 
                                type="email"
                                placeholder="driver@example.com"
                                className="bg-white border border-gray-300"
                                data-testid="input-driver-email-sms"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="bg-blue-50 p-4 rounded-lg">
                        <div className="flex items-start space-x-3">
                          <MessageCircle className="text-blue-600 w-5 h-5 mt-0.5" />
                          <div>
                            <h4 className="font-medium text-blue-800">SMS Invitation</h4>
                            <p className="text-sm text-blue-700 mt-1">
                              The driver will receive a text message with a secure onboarding link. Once they complete registration, they'll be automatically added to your fleet.
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="bg-red-50 border border-red-200 p-4 rounded-lg">
                        <div className="flex items-start space-x-3">
                          <AlertTriangle className="text-red-600 w-5 h-5 mt-0.5" />
                          <div>
                            <h4 className="font-medium text-red-800">🚨 ERROR 30034: CARRIER REJECTION</h4>
                            <p className="text-sm text-red-700 mt-1">
                              <strong>Your Twilio trial account can only send SMS to verified numbers.</strong><br/>
                              1. Go to <a href="https://console.twilio.com/us1/develop/phone-numbers/manage/verified" target="_blank" className="underline font-medium">Twilio Console → Verified Numbers</a><br/>
                              2. Click "Add a new number" and verify YOUR actual phone number<br/>
                              3. Then test SMS with your verified number
                            </p>
                            <div className="mt-2 p-2 bg-red-100 rounded text-xs text-red-800">
                              <strong>Why SMS shows "Success" but doesn't arrive:</strong> Twilio accepts the message but silently drops it for unverified numbers on trial accounts.
                            </div>
                            <div className="mt-2">
                              <a href="/sms-status" target="_blank" className="text-blue-600 underline text-sm">
                                📱 Check SMS Delivery Status
                              </a>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex justify-end space-x-4">
                        <Button 
                          type="button" 
                          variant="outline" 
                          className="bg-white border border-gray-300"
                          onClick={() => setShowSMSModal(false)}
                        >
                          Cancel
                        </Button>
                        <Button 
                          type="submit" 
                          disabled={createSMSInviteMutation.isPending}
                          className="bg-green-600 text-white hover:bg-green-700"
                          data-testid="button-send-sms-invite"
                        >
                          {createSMSInviteMutation.isPending ? "Sending..." : "Send SMS Invite"}
                        </Button>
                      </div>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Email Invitation Option */}
              <div className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-start space-x-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                    <Send className="text-blue-600 w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-medium text-gray-900">Email Invitation</h4>
                    <p className="text-sm text-gray-500 mb-3">
                      Send a secure onboarding link via email
                    </p>
                    <Button 
                      onClick={() => setShowInviteModal(true)}
                      className="bg-primary text-white hover:bg-blue-700"
                      size="sm"
                      data-testid="button-email-invite"
                    >
                      <Send className="mr-2 w-4 h-4" />
                      Send Email Invite
                    </Button>
                  </div>
                </div>
              </div>

              {/* SMS Invitation Option */}
              <div className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-start space-x-3">
                  <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                    <MessageCircle className="text-green-600 w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-medium text-gray-900">SMS Invitation</h4>
                    <p className="text-sm text-gray-500 mb-3">
                      Send instant text message with onboarding link
                    </p>
                    <Button 
                      onClick={() => setShowSMSModal(true)}
                      className="bg-green-600 text-white hover:bg-green-700"
                      size="sm"
                      data-testid="button-sms-invite"
                    >
                      <MessageCircle className="mr-2 w-4 h-4" />
                      Send SMS Invite
                    </Button>
                  </div>
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <div className="flex items-start space-x-3">
                  <AlertTriangle className="text-amber-600 w-5 h-5 mt-0.5" />
                  <div>
                    <h4 className="font-medium text-amber-800">Important</h4>
                    <p className="text-sm text-amber-700 mt-1">
                      Both methods create secure onboarding links that expire in 7 days. Drivers complete their profile and start receiving load offers automatically.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Pending Invitations */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-warning" />
              Pending Invitations
            </CardTitle>
            <p className="text-sm text-gray-500">Track sent onboarding invites</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {onboardingTokens.map((token) => (
                <div 
                  key={token.id} 
                  className="flex items-center justify-between p-4 border border-gray-200 rounded-lg"
                  data-testid={`token-item-${token.id}`}
                >
                  <div>
                    <h4 className="font-medium text-gray-900">{token.email}</h4>
                    <p className="text-sm text-gray-500">
                      Expires: {new Date(token.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    {getTokenStatusBadge(token)}
                    {!token.isUsed && new Date(token.expiresAt) > new Date() && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => copyInviteLink(token.token)}
                        title="Copy Invite Link"
                        data-testid={`button-copy-${token.id}`}
                      >
                        <Copy className={`w-4 h-4 ${copiedToken === token.token ? 'text-success' : 'text-gray-600'}`} />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              
              {onboardingTokens.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  No pending invitations. Click "Invite Driver" to send your first invite.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Manual Driver Onboarding */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <UserPlus className="w-5 h-5 text-blue-600" />
                  Manual Onboarding
                </CardTitle>
                <p className="text-sm text-gray-500">Add drivers directly without sending invitations</p>
              </div>
              <Dialog open={showManualOnboardingModal} onOpenChange={setShowManualOnboardingModal}>
                <DialogTrigger asChild>
                  <Button className="bg-blue-600 text-white hover:bg-blue-700" data-testid="button-manual-onboard">
                    <UserPlus className="mr-2 w-4 h-4" />
                    Add Driver
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-white border border-gray-300 shadow-lg max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="manual-onboard-modal">
                  <DialogHeader>
                    <DialogTitle>Manual Driver Onboarding</DialogTitle>
                    <DialogDescription>
                      Create a driver profile directly without sending an invitation. The driver will be immediately available for load assignments.
                    </DialogDescription>
                  </DialogHeader>
                  <Form {...manualForm}>
                    <form onSubmit={manualForm.handleSubmit(
                      (data) => {
                        console.log('Form submission data:', data);
                        createManualDriverMutation.mutate(data);
                      },
                      (errors) => {
                        console.log('Form validation errors:', errors);
                        toast({
                          title: "Form Validation Error",
                          description: "Please check all required fields are filled correctly",
                          variant: "destructive",
                        });
                      }
                    )} className="space-y-6">
                      {/* Personal Information */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField
                          control={manualForm.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Full Name *</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  placeholder="John Doe"
                                  className="bg-white border border-gray-300"
                                  data-testid="input-manual-name"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={manualForm.control}
                          name="email"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Email Address *</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  type="email"
                                  placeholder="john@example.com"
                                  className="bg-white border border-gray-300"
                                  data-testid="input-manual-email"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <FormField
                        control={manualForm.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Phone Number *</FormLabel>
                            <FormControl>
                              <Input 
                                {...field} 
                                placeholder="(555) 123-4567"
                                className="bg-white border border-gray-300"
                                data-testid="input-manual-phone"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* License Information */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <FormField
                          control={manualForm.control}
                          name="licenseNumber"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>License Number *</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  placeholder="ABC123456"
                                  className="bg-white border border-gray-300"
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
                              <FormLabel>License State *</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  placeholder="CA"
                                  className="bg-white border border-gray-300"
                                  data-testid="input-manual-state"
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
                              <FormLabel>License Expiry *</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  type="date"
                                  className="bg-white border border-gray-300"
                                  data-testid="input-manual-expiry"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      {/* Equipment & Capacity */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField
                          control={manualForm.control}
                          name="equipmentType"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Equipment Type *</FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl>
                                  <SelectTrigger className="bg-white border border-gray-300" data-testid="select-equipment-type">
                                    <SelectValue placeholder="Select equipment type" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent className="bg-white border border-gray-300 shadow-lg">
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
                              <FormLabel>Load Type Preference</FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl>
                                  <SelectTrigger className="bg-white border border-gray-300" data-testid="select-load-type">
                                    <SelectValue placeholder="Select load type" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent className="bg-white border border-gray-300 shadow-lg">
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
                              <FormLabel>Max Weight (lbs)</FormLabel>
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
                                  className="bg-white border border-gray-300"
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
                              <FormLabel>Max Length (ft)</FormLabel>
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
                                  className="bg-white border border-gray-300"
                                  data-testid="input-manual-length"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      {/* Location */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <FormField
                          control={manualForm.control}
                          name="city"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>City *</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  placeholder="Atlanta"
                                  className="bg-white border border-gray-300"
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
                              <FormLabel>State *</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  placeholder="GA"
                                  className="bg-white border border-gray-300"
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
                              <FormLabel>ZIP Code *</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  placeholder="30309"
                                  className="bg-white border border-gray-300"
                                  data-testid="input-manual-zip"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      {/* Vehicle Information */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <FormField
                          control={manualForm.control}
                          name="vehicleYear"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Vehicle Year *</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  placeholder="2023"
                                  className="bg-white border border-gray-300"
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
                              <FormLabel>Vehicle Make *</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  placeholder="Freightliner"
                                  className="bg-white border border-gray-300"
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
                              <FormLabel>Vehicle Model (Optional)</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  placeholder="Cascadia"
                                  className="bg-white border border-gray-300"
                                  data-testid="input-manual-vehicle-model"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="flex justify-end space-x-4 pt-4">
                        <Button 
                          type="button" 
                          variant="outline" 
                          className="bg-white border border-gray-300"
                          onClick={() => setShowManualOnboardingModal(false)}
                        >
                          Cancel
                        </Button>
                        <Button 
                          type="submit" 
                          disabled={createManualDriverMutation.isPending}
                          className="bg-blue-600 text-white hover:bg-blue-700"
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
          </CardHeader>
          <CardContent>
            <div className="text-center py-8 text-gray-600">
              <UserPlus className="w-12 h-12 mx-auto text-blue-600 mb-4" />
              <h3 className="text-lg font-medium mb-2">Quick Driver Addition</h3>
              <p className="text-sm text-gray-500 mb-4">
                Manually create driver profiles when you have all the necessary information ready. 
                This skips the invitation process and immediately adds the driver to your fleet.
              </p>
              <p className="text-xs text-gray-400">
                Best for drivers you've already verified and want to add quickly to the system.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}