import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle, Loader2, Play, Square, RefreshCw } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface DATStatus {
  isLoggedIn: boolean;
  isLoggingIn: boolean;
}

interface ScrapedLoad {
  company: string;
  route: string;
  rate: number;
  equipment: string;
}

interface ScrapeResult {
  message: string;
  totalScraped: number;
  totalProcessed: number;
  loads: ScrapedLoad[];
}

export function DATScraperControl() {
  const queryClient = useQueryClient();
  const [lastScrapeResult, setLastScrapeResult] = useState<ScrapeResult | null>(null);

  // Get DAT status
  const { data: status, isLoading: statusLoading } = useQuery<DATStatus>({
    queryKey: ['/api/dat-puppeteer/status'],
    refetchInterval: 3000, // Check status every 3 seconds
  });

  // Login mutation
  const loginMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/dat-puppeteer/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error('Login failed');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/dat-puppeteer/status'] });
    },
  });

  // Scrape mutation
  const scrapeMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/dat-puppeteer/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error('Scraping failed');
      return response.json();
    },
    onSuccess: (data: ScrapeResult) => {
      setLastScrapeResult(data);
      queryClient.invalidateQueries({ queryKey: ['/api/loads'] });
    },
  });

  // Close mutation
  const closeMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/dat-puppeteer/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error('Close failed');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/dat-puppeteer/status'] });
      setLastScrapeResult(null);
    },
  });

  const getStatusBadge = () => {
    if (statusLoading) {
      return <Badge variant="secondary"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Loading</Badge>;
    }
    
    if (status?.isLoggingIn) {
      return <Badge variant="secondary"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Logging In</Badge>;
    }
    
    if (status?.isLoggedIn) {
      return <Badge variant="default"><CheckCircle className="w-3 h-3 mr-1" />Logged In</Badge>;
    }
    
    return <Badge variant="destructive"><AlertCircle className="w-3 h-3 mr-1" />Not Logged In</Badge>;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            DAT Puppeteer Scraper
            {getStatusBadge()}
          </CardTitle>
          <CardDescription>
            Direct DAT LoadLink integration using your login credentials with 2FA support
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Button
              onClick={() => loginMutation.mutate()}
              disabled={loginMutation.isPending || status?.isLoggingIn || status?.isLoggedIn}
              className="w-full"
            >
              {loginMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              Start DAT Login
            </Button>

            <Button
              onClick={() => scrapeMutation.mutate()}
              disabled={scrapeMutation.isPending || !status?.isLoggedIn}
              variant="secondary"
              className="w-full"
            >
              {scrapeMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Scrape Loads
            </Button>

            <Button
              onClick={() => closeMutation.mutate()}
              disabled={closeMutation.isPending}
              variant="outline"
              className="w-full"
            >
              {closeMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Square className="w-4 h-4 mr-2" />
              )}
              Close Browser
            </Button>
          </div>

          {loginMutation.error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
              <p className="text-sm text-red-600 dark:text-red-400">
                Login Error: {loginMutation.error.message}
              </p>
            </div>
          )}

          {scrapeMutation.error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
              <p className="text-sm text-red-600 dark:text-red-400">
                Scraping Error: {scrapeMutation.error.message}
              </p>
            </div>
          )}

          {status?.isLoggingIn && (
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
              <p className="text-sm text-blue-600 dark:text-blue-400">
                💡 Complete 2FA authentication in the browser window that opened
              </p>
            </div>
          )}

          {lastScrapeResult && (
            <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md">
              <h4 className="font-medium text-green-800 dark:text-green-200 mb-2">
                Last Scrape Results
              </h4>
              <p className="text-sm text-green-600 dark:text-green-400 mb-3">
                {lastScrapeResult.message}
              </p>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-medium">Scraped:</span> {lastScrapeResult.totalScraped}
                </div>
                <div>
                  <span className="font-medium">Processed:</span> {lastScrapeResult.totalProcessed}
                </div>
              </div>
              {lastScrapeResult.loads.length > 0 && (
                <div className="mt-3">
                  <h5 className="font-medium text-green-800 dark:text-green-200 mb-2">
                    Loads Found:
                  </h5>
                  <ul className="space-y-1 text-sm text-green-600 dark:text-green-400">
                    {lastScrapeResult.loads.slice(0, 5).map((load, index) => (
                      <li key={index}>
                        {load.company} - {load.route} (${load.rate}) - {load.equipment}
                      </li>
                    ))}
                    {lastScrapeResult.loads.length > 5 && (
                      <li>... and {lastScrapeResult.loads.length - 5} more</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
            <p>• Uses dispatch@lampslogistics.com credentials</p>
            <p>• Targets box trucks and sprinter vans in SE states</p>
            <p>• Automatically creates customers and notifies drivers</p>
            <p>• Complete 2FA manually in the browser window</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}