import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { driverOnboardingSchema, type DriverOnboarding } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Truck, MapPin, Shield, CheckCircle } from "lucide-react";

export default function DriverOnboarding() {
  const [location] = useLocation();
  const { toast } = useToast();
  const [token, setToken] = useState<string>("");
  const [isTokenValid, setIsTokenValid] = useState<boolean | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const form = useForm<DriverOnboarding>({
    resolver: zodResolver(driverOnboardingSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      licenseNumber: "",
      emergencyContact: "",
      emergencyPhone: "",
      confirmPassword: "",
    },
  });

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('token');
    if (tokenFromUrl) {
      setToken(tokenFromUrl);
      validateToken(tokenFromUrl);
    }
  }, [location]);

  const validateToken = async (tokenValue: string) => {
    try {
      const response = await apiRequest("POST", "/api/validate-onboarding-token", { token: tokenValue });
      const data = await response.json();
      if (data.valid) {
        setIsTokenValid(true);
        form.setValue("email", data.email);
      } else {
        setIsTokenValid(false);
      }
    } catch (error) {
      setIsTokenValid(false);
    }
  };

  const onboardingMutation = useMutation({
    mutationFn: async (data: DriverOnboarding) => {
      const response = await apiRequest("POST", "/api/driver-onboarding", {
        ...data,
        token,
      });
      return response.json();
    },
    onSuccess: () => {
      setIsSubmitted(true);
      toast({
        title: "Welcome to LoadMaster!",
        description: "Your driver account has been created successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to complete onboarding. Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: DriverOnboarding) => {
    onboardingMutation.mutate(data);
  };

  if (isTokenValid === null) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-pulse">
          <Card className="w-96">
            <CardContent className="p-6">
              <div className="h-20 bg-gray-200 rounded"></div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (isTokenValid === false) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Card className="w-96">
          <CardHeader className="text-center">
            <div className="w-16 h-16 bg-destructive bg-opacity-10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Shield className="text-destructive w-8 h-8" />
            </div>
            <CardTitle className="text-destructive">Invalid Link</CardTitle>
            <CardDescription>
              This onboarding link is invalid or has expired. Please contact your fleet manager for a new link.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Card className="w-96">
          <CardHeader className="text-center">
            <div className="w-16 h-16 bg-success bg-opacity-10 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="text-success w-8 h-8" />
            </div>
            <CardTitle className="text-success">Welcome Aboard!</CardTitle>
            <CardDescription>
              Your driver account has been created successfully. You'll start receiving load assignments soon.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-blue-50 p-4 rounded-lg">
              <h4 className="font-medium text-blue-900 mb-2">Next Steps:</h4>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>• Check your email for login credentials</li>
                <li>• Download the LoadMaster mobile app</li>
                <li>• Keep your phone's location services enabled</li>
                <li>• Wait for your first load assignment</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-2xl mx-auto px-4">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-primary bg-opacity-10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Truck className="text-primary w-8 h-8" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900">Welcome to LoadMaster</h1>
          <p className="text-gray-600 mt-2">Complete your driver onboarding to start receiving loads</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Driver Information</CardTitle>
            <CardDescription>
              Please provide your details to complete the onboarding process
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" data-testid="driver-onboarding-form">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Full Name</FormLabel>
                        <FormControl>
                          <Input 
                            {...field} 
                            placeholder="John Doe"
                            data-testid="input-driver-name"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email Address</FormLabel>
                        <FormControl>
                          <Input 
                            {...field} 
                            type="email"
                            placeholder="john@example.com"
                            disabled
                            data-testid="input-driver-email"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone Number</FormLabel>
                        <FormControl>
                          <Input 
                            {...field} 
                            placeholder="(555) 123-4567"
                            data-testid="input-driver-phone"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="licenseNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>License Number</FormLabel>
                        <FormControl>
                          <Input 
                            {...field} 
                            placeholder="DL123456789"
                            data-testid="input-license-number"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="emergencyContact"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Emergency Contact Name</FormLabel>
                        <FormControl>
                          <Input 
                            {...field} 
                            placeholder="Jane Doe"
                            data-testid="input-emergency-contact"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="emergencyPhone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Emergency Contact Phone</FormLabel>
                        <FormControl>
                          <Input 
                            {...field} 
                            placeholder="(555) 987-6543"
                            data-testid="input-emergency-phone"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <div className="flex items-start space-x-3">
                    <MapPin className="text-yellow-600 w-5 h-5 mt-0.5" />
                    <div>
                      <h4 className="font-medium text-yellow-800">Location Tracking</h4>
                      <p className="text-sm text-yellow-700 mt-1">
                        By completing this onboarding, you agree to share your location with LoadMaster for load tracking and safety purposes. Location data is only used during active loads and for emergency situations.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end pt-6 border-t border-gray-200">
                  <Button 
                    type="submit" 
                    disabled={onboardingMutation.isPending}
                    className="bg-primary text-white hover:bg-blue-700 px-8"
                    data-testid="button-complete-onboarding"
                  >
                    {onboardingMutation.isPending ? "Completing..." : "Complete Onboarding"}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}