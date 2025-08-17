import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { EQUIPMENT_TYPES, EQUIPMENT_CATEGORIES } from '@shared/equipment-types';

import { apiRequest } from '@/lib/queryClient';
import { Truck, User, Phone, Mail, MapPin, Shield, CreditCard, CheckCircle } from 'lucide-react';

interface OnboardingData {
  // Personal Information
  name: string;
  email: string;
  phone: string;
  emergencyContact: string;
  emergencyPhone: string;
  city: string;
  
  // License & Documentation
  licenseNumber: string;
  licenseState: string;
  licenseExpiry: string;
  medicalCertExpiry: string;
  
  // Equipment Information
  equipmentType: string;
  weightCapacity: number;
  loadType: string;
  maxLength: number;
  maxWeight: number;
  vehicleYear: string;
  vehicleMake: string;
  vehicleModel: string;
  vinNumber: string;
  
  // Insurance & Banking
  insuranceProvider: string;
  insurancePolicyNumber: string;
  insuranceExpiry: string;
  bankName: string;
  routingNumber: string;
  accountNumber: string;
  
  // Preferences
  enableTelegramNotifications: boolean;
  telegramUsername: string;
  preferredLanes: string[];
  avoidAreas: string[];
  
  // Authentication
  confirmPassword: string;
}

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
];

export default function DriverOnboarding() {
  const [currentStep, setCurrentStep] = useState(0);
  const [onboardingToken, setOnboardingToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [formData, setFormData] = useState<OnboardingData>({
    name: '',
    email: '',
    phone: '',
    emergencyContact: '',
    emergencyPhone: '',
    city: '',
    licenseNumber: '',
    licenseState: '',
    licenseExpiry: '',
    medicalCertExpiry: '',
    equipmentType: '',
    weightCapacity: 26000,
    loadType: 'full_partial',
    maxLength: 53,
    maxWeight: 48000,
    vehicleYear: '',
    vehicleMake: '',
    vehicleModel: '',
    vinNumber: '',
    insuranceProvider: '',
    insurancePolicyNumber: '',
    insuranceExpiry: '',
    bankName: '',
    routingNumber: '',
    accountNumber: '',
    enableTelegramNotifications: true,
    telegramUsername: '',
    preferredLanes: [],
    avoidAreas: [],
    confirmPassword: 'password123'
  });

  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get token from URL parameters - handle both direct access and SPA routing
  useEffect(() => {
    let token = null;
    
    // Method 1: Try to get from current URL object
    try {
      const urlObj = new URL(window.location.href);
      token = urlObj.searchParams.get('token');
    } catch (e) {
      // Fallback if URL parsing fails
    }
    
    // Method 2: Try to parse from browser location directly
    if (!token) {
      const searchParams = new URLSearchParams(window.location.search);
      token = searchParams.get('token');
    }
    
    // Method 3: Try to parse from the full href string manually
    if (!token && window.location.href.includes('token=')) {
      const matches = window.location.href.match(/[?&]token=([^&]+)/);
      if (matches && matches[1]) {
        token = decodeURIComponent(matches[1]);
      }
    }
    
    // Method 4: Check if token was passed via state or other means
    if (!token) {
      // Check localStorage for temporary token (in case of redirect)
      const tempToken = localStorage.getItem('onboarding_token');
      if (tempToken) {
        token = tempToken;
        localStorage.removeItem('onboarding_token'); // Clean up
      }
    }
    
    if (token && token.trim()) {
      setOnboardingToken(token.trim());
      setTokenError(null);
    } else {
      setTokenError('No onboarding token found. Please use the invitation link.');
    }
  }, []);

  // Validate the onboarding token
  const { data: tokenValidation, isLoading: isValidatingToken, error: validationError } = useQuery({
    queryKey: ['validate-token', onboardingToken],
    queryFn: async () => {
      if (!onboardingToken) return null;
      const response = await fetch('/api/validate-onboarding-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: onboardingToken })
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to validate token');
      }
      return response.json();
    },
    enabled: !!onboardingToken,
    retry: false // Don't retry failed validation
  });

  useEffect(() => {
    if (validationError) {
      setTokenError('Token validation failed. Please check your invitation link.');
    } else if (tokenValidation && !tokenValidation.valid) {
      setTokenError(tokenValidation.error || 'Token not found');
    } else if (tokenValidation && tokenValidation.valid) {
      setTokenError(null);
      // Pre-fill email if available
      if (tokenValidation.email && !formData.email) {
        setFormData(prev => ({ ...prev, email: tokenValidation.email }));
      }
    }
  }, [tokenValidation, validationError, formData.email]);

  const steps = [
    { title: 'Personal Info', icon: User },
    { title: 'License & Docs', icon: Shield },
    { title: 'Equipment', icon: Truck },
    { title: 'Insurance & Banking', icon: CreditCard },
    { title: 'Preferences', icon: MapPin },
    { title: 'Complete', icon: CheckCircle }
  ];

  const onboardDriverMutation = useMutation({
    mutationFn: async (data: OnboardingData) => {
      if (!onboardingToken) {
        throw new Error('No onboarding token available');
      }
      
      const response = await fetch('/api/driver-onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: onboardingToken,
          ...data
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to complete onboarding');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/drivers'] });
      toast({
        title: 'Driver onboarded successfully!',
        description: 'Welcome to LoadMaster. You can now receive load offers.'
      });
      setCurrentStep(5); // Complete step
      // Redirect to driver dashboard after a short delay
      setTimeout(() => {
        setLocation('/driver-dashboard');
      }, 3000);
    },
    onError: (error: any) => {
      toast({
        title: 'Onboarding failed',
        description: error.message || 'Please check your information and try again.',
        variant: 'destructive'
      });
    }
  });

  const updateFormData = (field: keyof OnboardingData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const nextStep = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(prev => prev + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const handleSubmit = () => {
    onboardDriverMutation.mutate(formData);
  };

  const isStepValid = () => {
    switch (currentStep) {
      case 0: // Personal Info
        return formData.name && formData.email && formData.phone && formData.city;
      case 1: // License & Docs
        return formData.licenseNumber && formData.licenseState && formData.licenseExpiry;
      case 2: // Equipment
        return formData.equipmentType && formData.vehicleYear && formData.vehicleMake && 
               formData.loadType && formData.maxLength > 0 && formData.maxWeight > 0;
      case 3: // Insurance & Banking
        return formData.insuranceProvider && formData.bankName && formData.routingNumber;
      case 4: // Preferences
        return true; // Optional step
      default:
        return true;
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 0: // Personal Information
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => updateFormData('name', e.target.value)}
                  placeholder="John Doe"
                  data-testid="input-driver-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email Address *</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => updateFormData('email', e.target.value)}
                  placeholder="john@example.com"
                  data-testid="input-driver-email"
                />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number *</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => updateFormData('phone', e.target.value)}
                  placeholder="(555) 123-4567"
                  data-testid="input-driver-phone"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="city">Home Base City *</Label>
                <Input
                  id="city"
                  value={formData.city}
                  onChange={(e) => updateFormData('city', e.target.value)}
                  placeholder="Atlanta, GA"
                  data-testid="input-driver-city"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="emergencyContact">Emergency Contact Name</Label>
                <Input
                  id="emergencyContact"
                  value={formData.emergencyContact}
                  onChange={(e) => updateFormData('emergencyContact', e.target.value)}
                  placeholder="Jane Doe"
                  data-testid="input-emergency-contact"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="emergencyPhone">Emergency Contact Phone</Label>
                <Input
                  id="emergencyPhone"
                  value={formData.emergencyPhone}
                  onChange={(e) => updateFormData('emergencyPhone', e.target.value)}
                  placeholder="(555) 987-6543"
                  data-testid="input-emergency-phone"
                />
              </div>
            </div>
          </div>
        );

      case 1: // License & Documentation
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="licenseNumber">CDL License Number *</Label>
                <Input
                  id="licenseNumber"
                  value={formData.licenseNumber}
                  onChange={(e) => updateFormData('licenseNumber', e.target.value)}
                  placeholder="DL12345678"
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
                    {US_STATES.map(state => (
                      <SelectItem key={state} value={state}>{state}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="licenseExpiry">License Expiry Date *</Label>
                <Input
                  id="licenseExpiry"
                  type="date"
                  value={formData.licenseExpiry}
                  onChange={(e) => updateFormData('licenseExpiry', e.target.value)}
                  data-testid="input-license-expiry"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="medicalCertExpiry">Medical Certificate Expiry</Label>
                <Input
                  id="medicalCertExpiry"
                  type="date"
                  value={formData.medicalCertExpiry}
                  onChange={(e) => updateFormData('medicalCertExpiry', e.target.value)}
                  data-testid="input-medical-cert-expiry"
                />
              </div>
            </div>
          </div>
        );

      case 2: // Equipment Information
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="equipmentType">Equipment Type *</Label>
                <Select value={formData.equipmentType} onValueChange={(value) => updateFormData('equipmentType', value)}>
                  <SelectTrigger className="bg-white border border-gray-300 shadow-sm" data-testid="select-equipment-type">
                    <SelectValue placeholder="Select equipment type" />
                  </SelectTrigger>
                  <SelectContent className="bg-white border border-gray-300 shadow-lg z-50">
                    {EQUIPMENT_TYPES.map(type => (
                      <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

            </div>

            {/* Load Preferences Section */}
            <div className="border-t pt-4 mt-4">
              <h4 className="font-medium mb-3 text-gray-800">Load Preferences</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="preferredLoadTypes">Load Type Preference *</Label>
                  <Select value={formData.loadType} onValueChange={(value) => updateFormData('loadType', value)}>
                    <SelectTrigger className="bg-white border border-gray-300 shadow-sm" data-testid="select-load-type">
                      <SelectValue placeholder="Select load type" />
                    </SelectTrigger>
                    <SelectContent className="bg-white border border-gray-300 shadow-lg z-50">
                      <SelectItem value="full">Full Loads Only</SelectItem>
                      <SelectItem value="partial">Partial Loads Only</SelectItem>
                      <SelectItem value="full_partial">Both Full & Partial</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maxLength">Length ft *</Label>
                  <Input
                    id="maxLength"
                    type="number"
                    value={formData.maxLength}
                    onChange={(e) => updateFormData('maxLength', parseInt(e.target.value) || 0)}
                    placeholder="53"
                    min="10"
                    max="100"
                    data-testid="input-max-length"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="maxWeight">Weight lbs *</Label>
                  <Input
                    id="maxWeight"
                    type="number"
                    value={formData.maxWeight}
                    onChange={(e) => updateFormData('maxWeight', parseInt(e.target.value) || 0)}
                    placeholder="26000"
                    min="1000"
                    max="80000"
                    data-testid="input-max-weight"
                  />
                </div>
                <div></div>
              </div>
              <p className="text-sm text-gray-500 mt-2">
                These preferences help us match you with suitable loads. You'll only receive offers for loads that match your equipment and length requirements.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="vehicleYear">Vehicle Year *</Label>
                <Input
                  id="vehicleYear"
                  value={formData.vehicleYear}
                  onChange={(e) => updateFormData('vehicleYear', e.target.value)}
                  placeholder="2020"
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
                  data-testid="input-vehicle-make"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vehicleModel">Vehicle Model</Label>
                <Input
                  id="vehicleModel"
                  value={formData.vehicleModel}
                  onChange={(e) => updateFormData('vehicleModel', e.target.value)}
                  placeholder="Transit"
                  data-testid="input-vehicle-model"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="vinNumber">VIN Number</Label>
              <Input
                id="vinNumber"
                value={formData.vinNumber}
                onChange={(e) => updateFormData('vinNumber', e.target.value)}
                placeholder="1FDKF37G1VEB12345"
                data-testid="input-vin-number"
              />
            </div>
          </div>
        );

      case 3: // Insurance & Banking
        return (
          <div className="space-y-6">
            <div>
              <h4 className="font-medium mb-3">Insurance Information</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="insuranceProvider">Insurance Provider *</Label>
                  <Input
                    id="insuranceProvider"
                    value={formData.insuranceProvider}
                    onChange={(e) => updateFormData('insuranceProvider', e.target.value)}
                    placeholder="Progressive Commercial"
                    data-testid="input-insurance-provider"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="insurancePolicyNumber">Policy Number</Label>
                  <Input
                    id="insurancePolicyNumber"
                    value={formData.insurancePolicyNumber}
                    onChange={(e) => updateFormData('insurancePolicyNumber', e.target.value)}
                    placeholder="POL-12345678"
                    data-testid="input-insurance-policy"
                  />
                </div>
              </div>
              <div className="mt-4">
                <Label htmlFor="insuranceExpiry">Insurance Expiry Date</Label>
                <Input
                  id="insuranceExpiry"
                  type="date"
                  value={formData.insuranceExpiry}
                  onChange={(e) => updateFormData('insuranceExpiry', e.target.value)}
                  className="w-48"
                  data-testid="input-insurance-expiry"
                />
              </div>
            </div>

            <div>
              <h4 className="font-medium mb-3">Banking Information</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="bankName">Bank Name *</Label>
                  <Input
                    id="bankName"
                    value={formData.bankName}
                    onChange={(e) => updateFormData('bankName', e.target.value)}
                    placeholder="Bank of America"
                    data-testid="input-bank-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="routingNumber">Routing Number *</Label>
                  <Input
                    id="routingNumber"
                    value={formData.routingNumber}
                    onChange={(e) => updateFormData('routingNumber', e.target.value)}
                    placeholder="021000021"
                    data-testid="input-routing-number"
                  />
                </div>
              </div>
              <div className="mt-4">
                <Label htmlFor="accountNumber">Account Number</Label>
                <Input
                  id="accountNumber"
                  value={formData.accountNumber}
                  onChange={(e) => updateFormData('accountNumber', e.target.value)}
                  placeholder="1234567890"
                  data-testid="input-account-number"
                />
              </div>
            </div>
          </div>
        );

      case 4: // Preferences
        return (
          <div className="space-y-4">
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="telegramNotifications"
                  checked={formData.enableTelegramNotifications}
                  onCheckedChange={(checked) => updateFormData('enableTelegramNotifications', checked)}
                  data-testid="checkbox-telegram-notifications"
                />
                <Label htmlFor="telegramNotifications">Enable Telegram notifications for load offers</Label>
              </div>

              {formData.enableTelegramNotifications && (
                <div className="space-y-2">
                  <Label htmlFor="telegramUsername">Telegram Username (optional)</Label>
                  <Input
                    id="telegramUsername"
                    value={formData.telegramUsername}
                    onChange={(e) => updateFormData('telegramUsername', e.target.value)}
                    placeholder="@johndoe"
                    data-testid="input-telegram-username"
                  />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="preferredLanes">Preferred Lanes (optional)</Label>
              <Textarea
                id="preferredLanes"
                value={formData.preferredLanes.join('\n')}
                onChange={(e) => updateFormData('preferredLanes', e.target.value.split('\n').filter(Boolean))}
                placeholder="Atlanta to Miami&#10;Charlotte to Jacksonville"
                className="bg-white border border-gray-300"
                data-testid="textarea-preferred-lanes"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="avoidAreas">Areas to Avoid (optional)</Label>
              <Textarea
                id="avoidAreas"
                value={formData.avoidAreas.join('\n')}
                onChange={(e) => updateFormData('avoidAreas', e.target.value.split('\n').filter(Boolean))}
                placeholder="New York City&#10;Downtown LA"
                className="bg-white border border-gray-300"
                data-testid="textarea-avoid-areas"
              />
            </div>
          </div>
        );

      case 5: // Complete
        return (
          <div className="text-center space-y-4">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto" />
            <h3 className="text-2xl font-bold text-green-600">Onboarding Complete!</h3>
            <p className="text-muted-foreground">
              Welcome to LoadMaster! Your driver profile has been created successfully. 
              You can now start receiving load offers based on your equipment type and location.
            </p>
            <div className="flex gap-4 justify-center">
              <Button onClick={() => setLocation('/driver-dashboard')} data-testid="button-go-to-dashboard">
                Go to Driver Dashboard
              </Button>
              <Button variant="outline" onClick={() => setLocation('/')} data-testid="button-go-home">
                Back to Home
              </Button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  // Show loading state while validating token
  if (isValidatingToken) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p>Validating onboarding invitation...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show error if token is invalid
  if (tokenError) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="text-red-500 mb-4">
                <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.888-.833-2.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Invalid Invitation</h3>
              <p className="text-gray-600 mb-4">{tokenError}</p>
              <p className="text-sm text-gray-500">Please contact support or request a new invitation link.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (currentStep === 5) {
    return (
      <div className="container max-w-2xl mx-auto p-6">
        <Card>
          <CardContent className="p-8">
            {renderStepContent()}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-4xl mx-auto p-6">
      <Card>
        <CardHeader>
          <CardTitle>Driver Onboarding</CardTitle>
          <CardDescription>
            Complete your driver profile to start receiving load offers
          </CardDescription>
          
          {/* Progress Stepper */}
          <div className="flex items-center justify-between mt-6">
            {steps.slice(0, -1).map((step, index) => {
              const Icon = step.icon;
              const isActive = index === currentStep;
              const isCompleted = index < currentStep;
              
              return (
                <div key={index} className="flex items-center">
                  <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 ${
                    isCompleted ? 'bg-green-500 border-green-500 text-white' :
                    isActive ? 'bg-blue-500 border-blue-500 text-white' :
                    'bg-gray-100 border-gray-300 text-gray-400'
                  }`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="ml-2 hidden sm:block">
                    <div className={`text-sm font-medium ${
                      isActive ? 'text-blue-600' : isCompleted ? 'text-green-600' : 'text-gray-400'
                    }`}>
                      {step.title}
                    </div>
                  </div>
                  {index < steps.length - 2 && (
                    <div className={`w-8 h-0.5 mx-4 ${
                      isCompleted ? 'bg-green-500' : 'bg-gray-300'
                    }`} />
                  )}
                </div>
              );
            })}
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {renderStepContent()}

          <div className="flex justify-between pt-6">
            <Button
              variant="outline"
              onClick={prevStep}
              disabled={currentStep === 0}
              data-testid="button-previous-step"
            >
              Previous
            </Button>

            {currentStep < steps.length - 2 ? (
              <Button
                onClick={nextStep}
                disabled={!isStepValid()}
                data-testid="button-next-step"
              >
                Next
              </Button>
            ) : (
              <Button
                onClick={handleSubmit}
                disabled={!isStepValid() || onboardDriverMutation.isPending}
                data-testid="button-complete-onboarding"
              >
                {onboardDriverMutation.isPending ? 'Completing...' : 'Complete Onboarding'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}