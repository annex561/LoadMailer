import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Truck, MapPin, DollarSign, Package, Calendar, Phone, Building2 } from 'lucide-react';

const loadEntrySchema = z.object({
  companyName: z.string().min(1, 'Company name is required'),
  contactPhone: z.string().min(10, 'Valid phone number required'),
  loadId: z.string().min(1, 'Load ID is required'),
  originCity: z.string().min(1, 'Origin city is required'),
  originState: z.string().min(2, 'Origin state is required'),
  destinationCity: z.string().min(1, 'Destination city is required'),
  destinationState: z.string().min(2, 'Destination state is required'),
  rate: z.string().min(1, 'Rate is required'),
  mileage: z.string().min(1, 'Mileage is required'),
  weight: z.string().min(1, 'Weight is required'),
  equipmentType: z.enum(['dry_van', 'refrigerated', 'flatbed', 'step_deck', 'box_truck'], {
    errorMap: () => ({ message: 'Equipment type is required' })
  }),
  pickupDate: z.string().min(1, 'Pickup date is required'),
  deliveryDate: z.string().min(1, 'Delivery date is required'),
  commodity: z.string().min(1, 'Commodity is required'),
  specialRequirements: z.string().optional()
});

type LoadEntryForm = z.infer<typeof loadEntrySchema>;

export default function ManualLoadEntry() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<LoadEntryForm>({
    resolver: zodResolver(loadEntrySchema),
    defaultValues: {
      companyName: '',
      contactPhone: '',
      loadId: '',
      originCity: '',
      originState: '',
      destinationCity: '',
      destinationState: '',
      rate: '',
      mileage: '',
      weight: '',
      equipmentType: 'dry_van',
      pickupDate: '',
      deliveryDate: '',
      commodity: '',
      specialRequirements: ''
    }
  });

  const createLoadMutation = useMutation({
    mutationFn: async (data: LoadEntryForm) => {
      const response = await fetch('/api/manual-loads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...data,
          rate: parseFloat(data.rate),
          mileage: parseInt(data.mileage),
          weight: parseInt(data.weight),
          source: 'manual_entry',
          status: 'available'
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to create load');
      }
      
      return await response.json();
    },
    onSuccess: (result: any) => {
      toast({
        title: "Load Created Successfully!",
        description: `Load dispatched to ${result.driversNotified || 0} nearby drivers`,
        variant: "default",
      });
      form.reset();
      queryClient.invalidateQueries({ queryKey: ['/api/dat-loads-direct'] });
      queryClient.invalidateQueries({ queryKey: ['/api/loads'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error Creating Load",
        description: error.message || "Failed to create load",
        variant: "destructive",
      });
    }
  });

  const onSubmit = async (data: LoadEntryForm) => {
    setIsSubmitting(true);
    try {
      await createLoadMutation.mutateAsync(data);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Manual Load Entry</h1>
        <p className="text-gray-600 mt-2">Enter load details to automatically dispatch to the nearest available drivers</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            New Load Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {/* Company Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="companyName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <Building2 className="h-4 w-4" />
                        Company Name
                      </FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="e.g., ABC Logistics" 
                          {...field} 
                          data-testid="input-company-name"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="contactPhone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <Phone className="h-4 w-4" />
                        Contact Phone
                      </FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="e.g., (555) 123-4567" 
                          {...field} 
                          data-testid="input-contact-phone"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="loadId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Load ID / Reference Number</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="e.g., DAT-123456 or LOAD-789" 
                        {...field} 
                        data-testid="input-load-id"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Origin and Destination */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-green-600" />
                    Origin
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="originCity"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>City</FormLabel>
                          <FormControl>
                            <Input 
                              placeholder="Nashville" 
                              {...field} 
                              data-testid="input-origin-city"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="originState"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>State</FormLabel>
                          <FormControl>
                            <Input 
                              placeholder="TN" 
                              maxLength={2}
                              {...field} 
                              data-testid="input-origin-state"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-red-600" />
                    Destination
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="destinationCity"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>City</FormLabel>
                          <FormControl>
                            <Input 
                              placeholder="Atlanta" 
                              {...field} 
                              data-testid="input-destination-city"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="destinationState"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>State</FormLabel>
                          <FormControl>
                            <Input 
                              placeholder="GA" 
                              maxLength={2}
                              {...field} 
                              data-testid="input-destination-state"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
              </div>

              {/* Load Details */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="rate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <DollarSign className="h-4 w-4" />
                        Rate ($)
                      </FormLabel>
                      <FormControl>
                        <Input 
                          type="number"
                          placeholder="1250" 
                          {...field} 
                          data-testid="input-rate"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="mileage"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Mileage</FormLabel>
                      <FormControl>
                        <Input 
                          type="number"
                          placeholder="250" 
                          {...field} 
                          data-testid="input-mileage"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="weight"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <Package className="h-4 w-4" />
                        Weight (lbs)
                      </FormLabel>
                      <FormControl>
                        <Input 
                          type="number"
                          placeholder="15000" 
                          {...field} 
                          data-testid="input-weight"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

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
                        <SelectItem value="dry_van">Dry Van</SelectItem>
                        <SelectItem value="refrigerated">Refrigerated</SelectItem>
                        <SelectItem value="flatbed">Flatbed</SelectItem>
                        <SelectItem value="step_deck">Step Deck</SelectItem>
                        <SelectItem value="box_truck">Box Truck</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Dates */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="pickupDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <Calendar className="h-4 w-4" />
                        Pickup Date
                      </FormLabel>
                      <FormControl>
                        <Input 
                          type="date"
                          {...field} 
                          data-testid="input-pickup-date"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="deliveryDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <Calendar className="h-4 w-4" />
                        Delivery Date
                      </FormLabel>
                      <FormControl>
                        <Input 
                          type="date"
                          {...field} 
                          data-testid="input-delivery-date"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="commodity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Commodity / Freight Description</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="e.g., General Freight, Electronics, Food Products" 
                        {...field} 
                        data-testid="input-commodity"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="specialRequirements"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Special Requirements (Optional)</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="e.g., Tarps required, Appointment needed, Inside delivery"
                        {...field} 
                        data-testid="textarea-special-requirements"
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
                  onClick={() => form.reset()}
                  data-testid="button-clear-form"
                >
                  Clear Form
                </Button>
                <Button 
                  type="submit" 
                  disabled={isSubmitting}
                  data-testid="button-create-load"
                >
                  {isSubmitting ? 'Creating Load...' : 'Create Load & Dispatch'}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}