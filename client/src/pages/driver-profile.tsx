import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EQUIPMENT_TYPES } from '@shared/equipment-types';
import { User, MessageCircle, Truck, Phone, Mail, MapPin, Save, CheckCircle } from 'lucide-react';
import type { Driver } from '@shared/schema';

const driverProfileSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  phone: z.string().min(10, "Please enter a valid phone number"),
  city: z.string().min(2, "City is required"),
  equipmentType: z.string().min(1, "Equipment type is required"),
  maxWeight: z.number().min(1000, "Maximum weight must be at least 1000 lbs"),
  maxLength: z.number().min(10, "Maximum length must be at least 10 ft"),
  loadType: z.enum(["full", "partial", "full_partial"]),
  telegramUsername: z.string().optional(),
  telegramId: z.string().optional(),
  enableTelegramNotifications: z.boolean().optional(),
});

type DriverProfileForm = z.infer<typeof driverProfileSchema>;

export default function DriverProfile() {
  const [driverId] = useState('3ce898f4-6962-461f-a9ea-bb81cc7d4a6f'); // Could be from auth context
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch driver profile
  const { data: driver, isLoading } = useQuery({
    queryKey: ['/api/drivers', driverId],
    queryFn: async (): Promise<Driver> => {
      const response = await fetch(`/api/drivers/${driverId}`);
      if (!response.ok) throw new Error('Failed to fetch driver profile');
      return response.json();
    }
  });

  const form = useForm<DriverProfileForm>({
    resolver: zodResolver(driverProfileSchema),
    values: driver ? {
      name: driver.name || '',
      email: driver.email || '',
      phone: driver.phone || '',
      city: driver.city || '',
      equipmentType: driver.equipmentType || '',
      maxWeight: driver.maxWeight || 26000,
      maxLength: driver.maxLength || 53,
      loadType: driver.loadType || 'full_partial',
      telegramUsername: driver.telegramUsername || '',
      telegramId: driver.telegramId || '',
      enableTelegramNotifications: driver.enableTelegramNotifications || false,
    } : undefined,
  });

  // Update driver profile
  const updateDriverMutation = useMutation({
    mutationFn: async (data: DriverProfileForm) => {
      // If they're adding Telegram info for the first time, automatically enable notifications and set status to available
      const updateData = {
        ...data,
        // Auto-enable notifications when Telegram username is added
        enableTelegramNotifications: data.telegramUsername ? true : data.enableTelegramNotifications,
        // Auto-set to available when Telegram is set up
        status: data.telegramUsername ? 'available' : undefined,
      };

      const response = await fetch(`/api/drivers/${driverId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      });
      if (!response.ok) throw new Error('Failed to update profile');
      return response.json();
    },
    onSuccess: (updatedDriver) => {
      queryClient.invalidateQueries({ queryKey: ['/api/drivers', driverId] });
      queryClient.invalidateQueries({ queryKey: ['/api/drivers'] });
      
      // Show different messages based on what was updated
      if (updatedDriver.enableTelegramNotifications && updatedDriver.telegramUsername) {
        toast({
          title: "🎉 You're all set!",
          description: "Telegram notifications enabled! You'll now receive load offers directly in Telegram.",
        });
      } else {
        toast({
          title: "Profile Updated",
          description: "Your profile has been updated successfully.",
        });
      }
    },
    onError: () => {
      toast({
        title: "Update Failed",
        description: "Failed to update your profile. Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: DriverProfileForm) => {
    updateDriverMutation.mutate(data);
  };

  const isTelegramConnected = driver?.enableTelegramNotifications && driver?.telegramUsername;

  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-96 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <User className="h-8 w-8 text-blue-600" />
        <div>
          <h1 className="text-3xl font-bold">Driver Profile</h1>
          <p className="text-muted-foreground">Update your information and Telegram settings to receive load offers</p>
        </div>
      </div>

      {/* Telegram Status Card */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5" />
            Telegram Notifications
            {isTelegramConnected && (
              <Badge className="bg-green-500 text-white">
                <CheckCircle className="h-3 w-3 mr-1" />
                Connected
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isTelegramConnected ? (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center gap-2 text-green-800 mb-2">
                <CheckCircle className="h-4 w-4" />
                <strong>Telegram notifications are active!</strong>
              </div>
              <p className="text-green-700 text-sm">
                You're connected as <strong>@{driver.telegramUsername}</strong> and will receive load offers directly in Telegram.
              </p>
            </div>
          ) : (
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="flex items-center gap-2 text-yellow-800 mb-2">
                <MessageCircle className="h-4 w-4" />
                <strong>Set up Telegram to receive load offers</strong>
              </div>
              <p className="text-yellow-700 text-sm mb-3">
                Add your Telegram username below to automatically receive load notifications on your phone.
              </p>
              <div className="text-xs text-yellow-600">
                <strong>How to find your Telegram username:</strong>
                <ol className="list-decimal list-inside mt-1 space-y-1">
                  <li>Open Telegram app</li>
                  <li>Go to Settings → Edit Profile</li>
                  <li>Set a username (if you don't have one)</li>
                  <li>Copy your username and paste it below</li>
                </ol>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Personal Information */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Personal Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Full Name</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-driver-name" />
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
                      <FormLabel className="flex items-center gap-2">
                        <Mail className="h-4 w-4" />
                        Email
                      </FormLabel>
                      <FormControl>
                        <Input {...field} type="email" data-testid="input-driver-email" />
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
                      <FormLabel className="flex items-center gap-2">
                        <Phone className="h-4 w-4" />
                        Phone Number
                      </FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-driver-phone" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <MapPin className="h-4 w-4" />
                        Home City
                      </FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Atlanta, GA" data-testid="input-driver-city" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Equipment Information */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Truck className="h-5 w-5" />
                  Equipment & Capacity
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="equipmentType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Equipment Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger className="bg-white border border-gray-300" data-testid="select-equipment-type">
                            <SelectValue placeholder="Select equipment type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="bg-white border border-gray-300 shadow-lg">
                          {Object.entries(EQUIPMENT_TYPES).map(([key, value]) => (
                            <SelectItem key={key} value={key}>
                              {value.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="maxWeight"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Max Weight (lbs)</FormLabel>
                        <FormControl>
                          <Input 
                            {...field} 
                            type="number" 
                            onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                            data-testid="input-max-weight"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="maxLength"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Max Length (ft)</FormLabel>
                        <FormControl>
                          <Input 
                            {...field} 
                            type="number" 
                            onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                            data-testid="input-max-length"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="loadType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Load Type Preference</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger className="bg-white border border-gray-300" data-testid="select-load-type">
                            <SelectValue />
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
              </CardContent>
            </Card>
          </div>

          {/* Telegram Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageCircle className="h-5 w-5" />
                Telegram Notification Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="telegramUsername"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Telegram Username</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input 
                          {...field} 
                          placeholder="your_username" 
                          className="pl-8"
                          data-testid="input-telegram-username"
                        />
                        <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">@</span>
                      </div>
                    </FormControl>
                    <FormDescription>
                      Enter your Telegram username (without the @). This will automatically enable load notifications.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="telegramId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Telegram Chat ID (Optional)</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        placeholder="Leave blank - will be set automatically when you message our bot"
                        data-testid="input-telegram-id"
                      />
                    </FormControl>
                    <FormDescription>
                      This will be automatically filled when you start chatting with our load notification bot.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="enableTelegramNotifications"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">Enable Telegram Notifications</FormLabel>
                      <FormDescription>
                        Receive instant load offers directly in Telegram
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="switch-telegram-notifications"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Save Button */}
          <div className="flex justify-end">
            <Button
              type="submit"
              size="lg"
              disabled={updateDriverMutation.isPending}
              className="min-w-[150px]"
              data-testid="button-save-profile"
            >
              {updateDriverMutation.isPending ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Profile
                </>
              )}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}