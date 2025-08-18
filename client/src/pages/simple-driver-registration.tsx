import { useState } from 'react';
import { useLocation } from 'wouter';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { EQUIPMENT_TYPES } from '@shared/equipment-types';
import { apiRequest } from '@/lib/queryClient';
import { Truck, User, Phone, Mail, MapPin, CheckCircle } from 'lucide-react';

interface SimpleDriverData {
  name: string;
  email: string;
  phone: string;
  city: string;
  equipmentType: string;
  telegramUsername: string;
}

const US_CITIES = [
  'Atlanta, GA', 'Miami, FL', 'Dallas, TX', 'Houston, TX', 'Phoenix, AZ', 
  'Los Angeles, CA', 'Chicago, IL', 'New York, NY', 'Boston, MA', 
  'Seattle, WA', 'Denver, CO', 'Las Vegas, NV', 'Charlotte, NC', 
  'Jacksonville, FL', 'Detroit, MI', 'Orlando, FL', 'Tampa, FL'
];

export default function SimpleDriverRegistration() {
  const [formData, setFormData] = useState<SimpleDriverData>({
    name: '',
    email: '',
    phone: '',
    city: '',
    equipmentType: '',
    telegramUsername: ''
  });
  
  const [isComplete, setIsComplete] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const registerDriverMutation = useMutation({
    mutationFn: async (data: SimpleDriverData) => {
      const response = await fetch('/api/simple-driver-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Registration failed');
      }
      return response.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['/api/drivers'] });
      toast({
        title: 'Registration successful!',
        description: 'Welcome to LoadMaster! You can now receive load offers.'
      });
      setIsComplete(true);
    },
    onError: (error: any) => {
      toast({
        title: 'Registration failed',
        description: error.message || 'Please check your information and try again.',
        variant: 'destructive'
      });
    }
  });

  const updateFormData = (field: keyof SimpleDriverData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const isFormValid = () => {
    return formData.name && formData.email && formData.phone && 
           formData.city && formData.equipmentType && formData.telegramUsername;
  };

  const handleSubmit = () => {
    if (isFormValid()) {
      registerDriverMutation.mutate(formData);
    }
  };

  if (isComplete) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <CheckCircle className="h-16 w-16 text-green-500 mx-auto" />
              <h3 className="text-2xl font-bold text-green-600">Registration Complete!</h3>
              <p className="text-muted-foreground">
                Welcome to LoadMaster! Your driver profile has been created successfully. 
                You can now start receiving load offers via Telegram.
              </p>
              <div className="flex gap-4 justify-center">
                <Button onClick={() => setLocation('/dashboard')} data-testid="button-go-to-dashboard">
                  Go to Dashboard
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-center">
            <Truck className="h-8 w-8 mx-auto mb-2 text-blue-600" />
            LAMP Logistics Driver Registration
          </CardTitle>
          <CardDescription className="text-center">
            Quick registration to start receiving load offers
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">
                <User className="h-4 w-4 inline mr-1" />
                Full Name *
              </Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => updateFormData('name', e.target.value)}
                placeholder="John Doe"
                className="bg-white border border-gray-300"
                data-testid="input-driver-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">
                <Mail className="h-4 w-4 inline mr-1" />
                Email *
              </Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => updateFormData('email', e.target.value)}
                placeholder="john@example.com"
                className="bg-white border border-gray-300"
                data-testid="input-driver-email"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="phone">
                <Phone className="h-4 w-4 inline mr-1" />
                Phone *
              </Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => updateFormData('phone', e.target.value)}
                placeholder="(555) 123-4567"
                className="bg-white border border-gray-300"
                data-testid="input-driver-phone"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="city">
                <MapPin className="h-4 w-4 inline mr-1" />
                Location *
              </Label>
              <Select value={formData.city} onValueChange={(value) => updateFormData('city', value)}>
                <SelectTrigger className="bg-white border border-gray-300" data-testid="select-driver-city">
                  <SelectValue placeholder="Select city" />
                </SelectTrigger>
                <SelectContent className="bg-white border border-gray-300 shadow-lg">
                  {US_CITIES.map((city) => (
                    <SelectItem key={city} value={city}>{city}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="equipmentType">
              <Truck className="h-4 w-4 inline mr-1" />
              Equipment Type *
            </Label>
            <Select value={formData.equipmentType} onValueChange={(value) => updateFormData('equipmentType', value)}>
              <SelectTrigger className="bg-white border border-gray-300" data-testid="select-equipment-type">
                <SelectValue placeholder="Select equipment type" />
              </SelectTrigger>
              <SelectContent className="bg-white border border-gray-300 shadow-lg">
                {EQUIPMENT_TYPES.map((equipment) => (
                  <SelectItem key={equipment.value} value={equipment.value}>
                    {equipment.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="telegramUsername">
              Telegram Username *
            </Label>
            <Input
              id="telegramUsername"
              value={formData.telegramUsername}
              onChange={(e) => updateFormData('telegramUsername', e.target.value)}
              placeholder="@username (without @)"
              className="bg-white border border-gray-300"
              data-testid="input-telegram-username"
            />
            <p className="text-xs text-gray-500">
              Enter your Telegram username to receive load offers
            </p>
          </div>

          <Button
            onClick={handleSubmit}
            disabled={!isFormValid() || registerDriverMutation.isPending}
            className="w-full"
            data-testid="button-register-driver"
          >
            {registerDriverMutation.isPending ? 'Registering...' : 'Complete Registration'}
          </Button>

          <p className="text-xs text-gray-500 text-center">
            By registering, you agree to receive load offers via Telegram and SMS
          </p>
        </CardContent>
      </Card>
    </div>
  );
}