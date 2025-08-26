import { useState, useEffect } from 'react';
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
  maxWeight: number;
  maxLength: number;
  loadType: string;
  vehicleYear: string;
  vehicleMake: string;
  vehicleModel: string;
  licenseNumber: string;
  licenseState: string;
  token?: string;
  telegramId?: string;
}

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 
  'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 
  'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
];

const LOAD_TYPES = [
  { value: 'full_partial', label: 'Full & Partial Loads' },
  { value: 'full', label: 'Full Loads Only' },
  { value: 'partial', label: 'Partial Loads Only' }
];

export default function SimpleDriverRegistration() {
  const [formData, setFormData] = useState<SimpleDriverData>({
    name: '',
    email: '',
    phone: '',
    city: '',
    equipmentType: '',
    telegramUsername: '',
    maxWeight: 26000,
    maxLength: 53,
    loadType: 'full_partial',
    vehicleYear: '',
    vehicleMake: '',
    vehicleModel: '',
    licenseNumber: '',
    licenseState: '',
    token: undefined,
    telegramId: undefined
  });
  
  const [isComplete, setIsComplete] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get token from URL and validate it
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    
    if (token) {
      console.log('Found token in URL:', token);
      setFormData(prev => ({ ...prev, token }));
      
      // Validate token and get associated data
      fetch('/api/validate-onboarding-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      })
      .then(res => res.json())
      .then(data => {
        if (data.valid) {
          setTokenError(null);
          // Pre-fill email if available
          if (data.email && !formData.email) {
            setFormData(prev => ({ ...prev, email: data.email }));
          }
        } else {
          setTokenError(data.error || 'Invalid or expired token');
        }
      })
      .catch(err => {
        console.error('Token validation error:', err);
        setTokenError('Failed to validate token');
      });
    } else {
      setTokenError('No invitation token found. Please use the registration link from Telegram.');
    }
  }, []);

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

  const updateFormData = (field: keyof SimpleDriverData, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const isFormValid = () => {
    return !tokenError && formData.token && 
           formData.name && formData.email && formData.phone && 
           formData.city && formData.equipmentType && formData.telegramUsername &&
           formData.vehicleYear && formData.vehicleMake && formData.vehicleModel &&
           formData.licenseNumber && formData.licenseState && 
           formData.maxWeight > 0 && formData.maxLength > 0;
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
                <Button onClick={() => setLocation('/')} data-testid="button-go-to-dashboard">
                  Go to Dashboard
                </Button>
                <Button variant="outline" onClick={() => window.close()} data-testid="button-close-window">
                  Close
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
          {tokenError && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-600">
              ⚠️ {tokenError}
            </div>
          )}
          
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
              <Input
                id="city"
                value={formData.city}
                onChange={(e) => updateFormData('city', e.target.value)}
                placeholder="Enter your city, e.g. Miami, FL"
                className="bg-white border border-gray-300"
                data-testid="input-driver-city"
              />
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

          {/* Vehicle Information Section */}
          <div className="border-t pt-4 mt-6">
            <h3 className="text-lg font-semibold mb-4 text-gray-800">Vehicle Information</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="vehicleYear">Vehicle Year *</Label>
                <Input
                  id="vehicleYear"
                  value={formData.vehicleYear}
                  onChange={(e) => updateFormData('vehicleYear', e.target.value)}
                  placeholder="2020"
                  className="bg-white border border-gray-300"
                  data-testid="input-vehicle-year"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vehicleMake">Vehicle Make *</Label>
                <Input
                  id="vehicleMake"
                  value={formData.vehicleMake}
                  onChange={(e) => updateFormData('vehicleMake', e.target.value)}
                  placeholder="Ford"
                  className="bg-white border border-gray-300"
                  data-testid="input-vehicle-make"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vehicleModel">Vehicle Model *</Label>
                <Input
                  id="vehicleModel"
                  value={formData.vehicleModel}
                  onChange={(e) => updateFormData('vehicleModel', e.target.value)}
                  placeholder="Transit"
                  className="bg-white border border-gray-300"
                  data-testid="input-vehicle-model"
                />
              </div>
            </div>
          </div>

          {/* License Information Section */}
          <div className="border-t pt-4 mt-6">
            <h3 className="text-lg font-semibold mb-4 text-gray-800">License Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="licenseNumber">License Number *</Label>
                <Input
                  id="licenseNumber"
                  value={formData.licenseNumber}
                  onChange={(e) => updateFormData('licenseNumber', e.target.value)}
                  placeholder="DL12345678"
                  className="bg-white border border-gray-300"
                  data-testid="input-license-number"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="licenseState">License State *</Label>
                <Select value={formData.licenseState} onValueChange={(value) => updateFormData('licenseState', value)}>
                  <SelectTrigger className="bg-white border border-gray-300" data-testid="select-license-state">
                    <SelectValue placeholder="Select state" />
                  </SelectTrigger>
                  <SelectContent className="bg-white border border-gray-300 shadow-lg">
                    {US_STATES.map((state) => (
                      <SelectItem key={state} value={state}>{state}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Load Capacity Section */}
          <div className="border-t pt-4 mt-6">
            <h3 className="text-lg font-semibold mb-4 text-gray-800">Load Capacity & Preferences</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="maxWeight">Max Weight (lbs) *</Label>
                <Input
                  id="maxWeight"
                  type="number"
                  value={formData.maxWeight}
                  onChange={(e) => updateFormData('maxWeight', parseInt(e.target.value) || 0)}
                  placeholder="26000"
                  className="bg-white border border-gray-300"
                  data-testid="input-max-weight"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="maxLength">Max Length (ft) *</Label>
                <Input
                  id="maxLength"
                  type="number"
                  value={formData.maxLength}
                  onChange={(e) => updateFormData('maxLength', parseInt(e.target.value) || 0)}
                  placeholder="53"
                  className="bg-white border border-gray-300"
                  data-testid="input-max-length"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="loadType">Load Preferences *</Label>
                <Select value={formData.loadType} onValueChange={(value) => updateFormData('loadType', value)}>
                  <SelectTrigger className="bg-white border border-gray-300" data-testid="select-load-type">
                    <SelectValue placeholder="Select load type" />
                  </SelectTrigger>
                  <SelectContent className="bg-white border border-gray-300 shadow-lg">
                    {LOAD_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Telegram Section */}
          <div className="border-t pt-4 mt-6">
            <h3 className="text-lg font-semibold mb-4 text-gray-800">Communication</h3>
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
                Enter your Telegram username to receive instant load offers directly to your phone
              </p>
            </div>
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