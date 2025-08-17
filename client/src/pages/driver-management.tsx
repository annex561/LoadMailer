import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Send, Copy, MapPin, Users, Clock, CheckCircle, MessageCircle } from "lucide-react";
import type { Driver, OnboardingToken } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
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

type InviteDriverForm = z.infer<typeof inviteDriverSchema>;
type SMSDriverForm = z.infer<typeof smsDriverSchema>;

export default function DriverManagement() {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showSMSModal, setShowSMSModal] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string>("");
  const { toast } = useToast();
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
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to send SMS invitation",
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
      return <Badge className="bg-success bg-opacity-10 text-success border-0">Used</Badge>;
    } else if (isExpired) {
      return <Badge className="bg-destructive bg-opacity-10 text-destructive border-0">Expired</Badge>;
    } else {
      return <Badge className="bg-warning bg-opacity-10 text-warning border-0">Pending</Badge>;
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Current Drivers */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Current Drivers</CardTitle>
                <p className="text-sm text-gray-500">Onboarded and active drivers</p>
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

        {/* Create New Driver via SMS */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Create New Driver</CardTitle>
                <p className="text-sm text-gray-500">Send SMS onboarding link</p>
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
                                placeholder="(555) 123-4567"
                                className="bg-white border border-gray-300"
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
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <MessageCircle className="text-green-600 w-8 h-8" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">Quick Driver Onboarding</h3>
              <p className="text-gray-500 mb-4 max-w-xs mx-auto">
                Send a text message with an onboarding link to instantly add new drivers to your fleet.
              </p>
              <Button 
                onClick={() => setShowSMSModal(true)}
                className="bg-green-600 text-white hover:bg-green-700"
                data-testid="button-open-sms-modal"
              >
                <MessageCircle className="mr-2 w-4 h-4" />
                Create New Driver
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Pending Invitations */}
        <Card>
          <CardHeader>
            <CardTitle>Pending Invitations</CardTitle>
            <p className="text-sm text-gray-500">Sent onboarding invites</p>
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
      </div>
    </div>
  );
}