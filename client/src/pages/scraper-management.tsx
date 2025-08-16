import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Play, Settings, Bot, Clock, CheckCircle, XCircle, RotateCcw, Hourglass } from "lucide-react";
import type { ScraperConfig, ScraperLog } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const scraperConfigSchema = z.object({
  name: z.string().min(1, "Name is required"),
  loginUrl: z.string().url("Please enter a valid URL"),
  searchUrl: z.string().url("Please enter a valid URL"),
  username: z.string().optional(),
  password: z.string().optional(),
  schedule: z.string().min(1, "Schedule is required"),
  autoCreateLoads: z.boolean().default(true),
  defaultCustomerId: z.string().optional(),
  searchCriteria: z.object({
    origin: z.string().optional(),
    destination: z.string().optional(),
    radius: z.number().optional(),
    equipmentType: z.string().optional(),
    minRate: z.number().optional(),
    maxAge: z.number().optional(),
  }).optional(),
});

type ScraperConfigForm = z.infer<typeof scraperConfigSchema>;

const schedulePresets = [
  { value: "*/30 * * * * *", label: "Every 30 seconds" },
  { value: "*/1 * * * *", label: "Every minute" },
  { value: "*/5 * * * *", label: "Every 5 minutes" },
  { value: "*/15 * * * *", label: "Every 15 minutes" },
  { value: "*/30 * * * *", label: "Every 30 minutes" },
  { value: "0 * * * *", label: "Every hour" },
  { value: "0 */6 * * *", label: "Every 6 hours" },
  { value: "0 9 * * *", label: "Daily at 9 AM" },
  { value: "custom", label: "Custom Schedule" },
];

export default function ScraperManagement() {
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [editingConfig, setEditingConfig] = useState<ScraperConfig | null>(null);
  const [showCustomSchedule, setShowCustomSchedule] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<ScraperConfigForm>({
    resolver: zodResolver(scraperConfigSchema),
    defaultValues: {
      name: "",
      loginUrl: "https://dat.com/login",
      searchUrl: "https://dat.com/search/loads",
      username: "",
      password: "",
      schedule: "*/30 * * * * *",
      autoCreateLoads: true,
      defaultCustomerId: "",
      searchCriteria: {
        origin: "",
        destination: "",
        radius: 100,
        equipmentType: "dry-van",
        minRate: 0,
        maxAge: 24,
      },
    },
  });

  const { data: scraperConfigs = [], isLoading: configsLoading } = useQuery<ScraperConfig[]>({
    queryKey: ["/api/scraper-configs"],
  });

  const { data: scraperLogs = [], isLoading: logsLoading } = useQuery<ScraperLog[]>({
    queryKey: ["/api/scraper-logs"],
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  const { data: customers = [] } = useQuery<any[]>({
    queryKey: ["/api/customers"],
  });

  const createConfigMutation = useMutation({
    mutationFn: async (data: ScraperConfigForm) => {
      const response = await apiRequest("POST", "/api/scraper-configs", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scraper-configs"] });
      toast({
        title: "Scraper Configuration Created",
        description: "Your DAT scraper has been configured successfully",
      });
      form.reset();
      setShowConfigModal(false);
      setEditingConfig(null);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create scraper configuration",
        variant: "destructive",
      });
    },
  });

  const updateConfigMutation = useMutation({
    mutationFn: async ({ id, ...data }: ScraperConfigForm & { id: string }) => {
      const response = await apiRequest("PATCH", `/api/scraper-configs/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scraper-configs"] });
      toast({
        title: "Configuration Updated",
        description: "Scraper configuration has been updated successfully",
      });
      form.reset();
      setShowConfigModal(false);
      setEditingConfig(null);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update scraper configuration",
        variant: "destructive",
      });
    },
  });

  const toggleScraperMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const response = await apiRequest("PATCH", `/api/scraper-configs/${id}`, { enabled });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scraper-configs"] });
      toast({
        title: "Scraper Updated",
        description: "Scraper status has been updated",
      });
    },
  });

  const runScraperMutation = useMutation({
    mutationFn: async (configId: string) => {
      const response = await apiRequest("POST", `/api/scraper-configs/${configId}/run`);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/scraper-logs"] });
      toast({
        title: "Scraper Run Complete",
        description: `Scraped ${data.loadsScraped} loads, created ${data.loadsCreated} new loads`,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to run scraper",
        variant: "destructive",
      });
    },
  });

  const openEditModal = (config: ScraperConfig) => {
    setEditingConfig(config);
    form.reset({
      name: config.name,
      loginUrl: config.loginUrl,
      searchUrl: config.searchUrl,
      username: config.username || "",
      password: config.password || "",
      schedule: config.schedule,
      autoCreateLoads: config.autoCreateLoads,
      defaultCustomerId: config.defaultCustomerId || "",
      searchCriteria: config.searchCriteria as any || {},
    });
    setShowCustomSchedule(!schedulePresets.some(p => p.value === config.schedule));
    setShowConfigModal(true);
  };

  const onSubmit = (data: ScraperConfigForm) => {
    if (editingConfig) {
      updateConfigMutation.mutate({ ...data, id: editingConfig.id });
    } else {
      createConfigMutation.mutate(data);
    }
  };

  const getStatusBadge = (config: ScraperConfig) => {
    if (!config.enabled) {
      return <Badge className="bg-gray-100 text-gray-600 border-0">Disabled</Badge>;
    }
    
    const recentLogs = scraperLogs
      .filter(log => log.configId === config.id)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    
    const latestLog = recentLogs[0];
    
    if (!latestLog) {
      return <Badge className="bg-blue-100 text-blue-600 border-0">Ready</Badge>;
    }
    
    if (latestLog.status === 'running') {
      return (
        <Badge className="bg-yellow-100 text-yellow-600 border-0 flex items-center gap-1">
          <Hourglass className="w-3 h-3 animate-spin" />
          Scraping...
        </Badge>
      );
    } else if (latestLog.status === 'success') {
      return <Badge className="bg-green-100 text-green-600 border-0">Success</Badge>;
    } else {
      return <Badge className="bg-red-100 text-red-600 border-0">Error</Badge>;
    }
  };

  const activeConfigs = scraperConfigs.filter(config => config.enabled);
  const recentLogs = scraperLogs.slice(0, 10);

  if (configsLoading) {
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
                <p className="text-sm font-medium text-gray-500">Active Scrapers</p>
                <p className="text-3xl font-bold text-gray-900">{activeConfigs.length}</p>
              </div>
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <Bot className="text-blue-600 w-6 h-6" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Loads Scraped Today</p>
                <p className="text-3xl font-bold text-gray-900">
                  {scraperLogs
                    .filter(log => 
                      new Date(log.startedAt).toDateString() === new Date().toDateString()
                    )
                    .reduce((sum, log) => sum + log.loadsScraped, 0)
                  }
                </p>
              </div>
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                {scraperLogs.some(log => log.status === 'running') ? (
                  <Hourglass className="text-green-600 w-6 h-6 animate-spin" />
                ) : (
                  <CheckCircle className="text-green-600 w-6 h-6" />
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Loads Created Today</p>
                <p className="text-3xl font-bold text-gray-900">
                  {scraperLogs
                    .filter(log => 
                      new Date(log.startedAt).toDateString() === new Date().toDateString()
                    )
                    .reduce((sum, log) => sum + log.loadsCreated, 0)
                  }
                </p>
              </div>
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                <Plus className="text-purple-600 w-6 h-6" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Scraper Configurations */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>DAT Scraper Configurations</CardTitle>
                <p className="text-sm text-gray-500">Manage your automated load scrapers</p>
              </div>
              <Dialog open={showConfigModal} onOpenChange={setShowConfigModal}>
                <DialogTrigger asChild>
                  <Button 
                    className="bg-blue-600 text-white hover:bg-blue-700"
                    onClick={() => {
                      setEditingConfig(null);
                      form.reset();
                      setShowCustomSchedule(false);
                    }}
                    data-testid="button-create-scraper"
                  >
                    <Plus className="mr-2 w-4 h-4" />
                    New Scraper
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="scraper-config-modal">
                  <DialogHeader>
                    <DialogTitle>
                      {editingConfig ? "Edit Scraper Configuration" : "Create New Scraper"}
                    </DialogTitle>
                  </DialogHeader>
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Configuration Name</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  placeholder="DAT Main Scraper"
                                  data-testid="input-scraper-name"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="schedule"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Schedule</FormLabel>
                              <FormControl>
                                <Select
                                  value={showCustomSchedule ? "custom" : field.value}
                                  onValueChange={(value) => {
                                    if (value === "custom") {
                                      setShowCustomSchedule(true);
                                    } else {
                                      setShowCustomSchedule(false);
                                      field.onChange(value);
                                    }
                                  }}
                                >
                                  <SelectTrigger data-testid="select-schedule">
                                    <SelectValue placeholder="Select schedule" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {schedulePresets.map((preset) => (
                                      <SelectItem key={preset.value} value={preset.value}>
                                        {preset.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </FormControl>
                              {showCustomSchedule && (
                                <div className="mt-2">
                                  <Input 
                                    {...field}
                                    placeholder="* * * * * * (cron format)"
                                    data-testid="input-custom-schedule"
                                  />
                                  <p className="text-xs text-gray-500 mt-1">
                                    Use cron format with seconds support (sec min hour day month weekday)
                                  </p>
                                </div>
                              )}
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="loginUrl"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>DAT Login URL</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  type="url"
                                  placeholder="https://dat.com/login"
                                  data-testid="input-login-url"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="searchUrl"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>DAT Search URL</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  type="url"
                                  placeholder="https://dat.com/search/loads"
                                  data-testid="input-search-url"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="username"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>DAT Username</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  placeholder="your-dat-username"
                                  data-testid="input-dat-username"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="password"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>DAT Password</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  type="password"
                                  placeholder="your-dat-password"
                                  data-testid="input-dat-password"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="space-y-4">
                        <h4 className="font-medium">Search Criteria</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <FormField
                            control={form.control}
                            name="searchCriteria.origin"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Origin (City, State)</FormLabel>
                                <FormControl>
                                  <Input 
                                    {...field} 
                                    placeholder="Los Angeles, CA"
                                    data-testid="input-origin"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="searchCriteria.destination"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Destination (City, State)</FormLabel>
                                <FormControl>
                                  <Input 
                                    {...field} 
                                    placeholder="Chicago, IL"
                                    data-testid="input-destination"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="searchCriteria.equipmentType"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Equipment Type</FormLabel>
                                <FormControl>
                                  <Select value={field.value} onValueChange={field.onChange}>
                                    <SelectTrigger data-testid="select-equipment">
                                      <SelectValue placeholder="Select equipment" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="dry-van">Dry Van</SelectItem>
                                      <SelectItem value="reefer">Refrigerated</SelectItem>
                                      <SelectItem value="flatbed">Flatbed</SelectItem>
                                      <SelectItem value="step-deck">Step Deck</SelectItem>
                                      <SelectItem value="lowboy">Lowboy</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="searchCriteria.minRate"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Minimum Rate ($)</FormLabel>
                                <FormControl>
                                  <Input 
                                    {...field} 
                                    type="number"
                                    placeholder="0"
                                    onChange={e => field.onChange(parseFloat(e.target.value) || 0)}
                                    data-testid="input-min-rate"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="defaultCustomerId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Default Customer (Optional)</FormLabel>
                              <FormControl>
                                <Select value={field.value} onValueChange={field.onChange}>
                                  <SelectTrigger data-testid="select-customer">
                                    <SelectValue placeholder="Auto-create customer" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {customers.map((customer: any) => (
                                      <SelectItem key={customer.id} value={customer.id}>
                                        {customer.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="autoCreateLoads"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                              <div className="space-y-0.5">
                                <FormLabel>Auto-Create Loads</FormLabel>
                                <p className="text-sm text-gray-500">
                                  Automatically create loads from scraped data
                                </p>
                              </div>
                              <FormControl>
                                <Switch
                                  checked={field.value}
                                  onCheckedChange={field.onChange}
                                  data-testid="switch-auto-create"
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="flex justify-end space-x-4 pt-4">
                        <Button 
                          type="button" 
                          variant="outline" 
                          onClick={() => setShowConfigModal(false)}
                        >
                          Cancel
                        </Button>
                        <Button 
                          type="submit" 
                          disabled={createConfigMutation.isPending || updateConfigMutation.isPending}
                          data-testid="button-save-scraper"
                        >
                          {createConfigMutation.isPending || updateConfigMutation.isPending 
                            ? "Saving..." 
                            : editingConfig ? "Update Scraper" : "Create Scraper"
                          }
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
              {scraperConfigs.map((config) => (
                <div 
                  key={config.id} 
                  className="flex items-center justify-between p-4 border border-gray-200 rounded-lg"
                  data-testid={`scraper-config-${config.id}`}
                >
                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                      <Bot className="text-blue-600 w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-medium text-gray-900">{config.name}</h4>
                      <p className="text-sm text-gray-500">Schedule: {config.schedule}</p>
                      <p className="text-sm text-gray-500">
                        Last run: {config.lastRunAt ? new Date(config.lastRunAt).toLocaleString() : 'Never'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {getStatusBadge(config)}
                    <Switch
                      checked={config.enabled}
                      onCheckedChange={(enabled) => 
                        toggleScraperMutation.mutate({ id: config.id, enabled })
                      }
                      data-testid={`switch-enable-${config.id}`}
                    />
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => runScraperMutation.mutate(config.id)}
                      disabled={runScraperMutation.isPending}
                      title="Run Now"
                      data-testid={`button-run-${config.id}`}
                    >
                      <Play className="w-4 h-4 text-green-600" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => openEditModal(config)}
                      title="Edit Configuration"
                      data-testid={`button-edit-${config.id}`}
                    >
                      <Settings className="w-4 h-4 text-blue-600" />
                    </Button>
                  </div>
                </div>
              ))}
              
              {scraperConfigs.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <Bot className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <h3 className="font-medium text-gray-900 mb-2">No Scrapers Configured</h3>
                  <p className="text-gray-500 mb-4">
                    Create your first DAT scraper to start pulling loads automatically
                  </p>
                  <Button 
                    onClick={() => setShowConfigModal(true)}
                    className="bg-blue-600 text-white hover:bg-blue-700"
                  >
                    <Plus className="mr-2 w-4 h-4" />
                    Create First Scraper
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recent Scraper Logs */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <p className="text-sm text-gray-500">Latest scraper runs and results</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {recentLogs.map((log) => (
                <div 
                  key={log.id} 
                  className="flex items-center justify-between p-3 border border-gray-200 rounded-lg"
                  data-testid={`scraper-log-${log.id}`}
                >
                  <div className="flex items-center space-x-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      log.status === 'success' ? 'bg-green-100' :
                      log.status === 'running' ? 'bg-yellow-100' : 'bg-red-100'
                    }`}>
                      {log.status === 'success' ? <CheckCircle className="text-green-600 w-4 h-4" /> :
                       log.status === 'running' ? <RotateCcw className="text-yellow-600 w-4 h-4" /> :
                       <XCircle className="text-red-600 w-4 h-4" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        Scraped: {log.loadsScraped} | Created: {log.loadsCreated}
                      </p>
                      <p className="text-xs text-gray-500">
                        {new Date(log.startedAt).toLocaleString()}
                      </p>
                      {log.errorMessage && (
                        <p className="text-xs text-red-600 mt-1">{log.errorMessage}</p>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-600 capitalize">{log.status}</p>
                    {log.executionTime && (
                      <p className="text-xs text-gray-500">{log.executionTime}ms</p>
                    )}
                  </div>
                </div>
              ))}
              
              {recentLogs.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <Clock className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                  <p>No scraper activity yet</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}