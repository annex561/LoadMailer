import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { 
  Sheet, 
  RefreshCw, 
  CheckCircle, 
  AlertCircle,
  Settings,
  Download,
  ExternalLink,
  Truck,
  FileText
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface SheetInfo {
  title: string;
  sheets: Array<{
    title: string;
    sheetId: number;
    gridProperties: {
      rowCount: number;
      columnCount: number;
    };
  }>;
}

interface ImportResult {
  success: boolean;
  message: string;
  loadsImported: number;
  driversNotified: number;
  previewLoads: any[];
}

export default function GoogleSheetsImport() {
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [range, setRange] = useState("Sheet1!A:Z");
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Check Google Sheets configuration status
  const { data: statusData, isLoading: statusLoading } = useQuery({
    queryKey: ['/api/google-sheets/status'],
    onSuccess: (data) => {
      setIsConfigured(data.configured);
    }
  });

  // Get sheet information
  const getSheetInfoMutation = useMutation({
    mutationFn: async (sheetId: string) => {
      const response = await fetch('/api/google-sheets/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spreadsheetId: sheetId })
      });
      if (!response.ok) throw new Error('Failed to get sheet info');
      return response.json();
    },
    onError: (error) => {
      toast({
        title: "Connection Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Test sheet connection
  const testConnectionMutation = useMutation({
    mutationFn: async (sheetId: string) => {
      const response = await fetch('/api/google-sheets/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spreadsheetId: sheetId })
      });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: data.success ? "Connection Successful" : "Connection Failed",
        description: data.message,
        variant: data.success ? "default" : "destructive"
      });
    }
  });

  // Import loads from sheet
  const importLoadsMutation = useMutation({
    mutationFn: async ({ sheetId, sheetRange }: { sheetId: string; sheetRange: string }) => {
      const response = await fetch('/api/google-sheets/import-loads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          spreadsheetId: sheetId, 
          range: sheetRange 
        })
      });
      return response.json();
    },
    onSuccess: (data: ImportResult) => {
      toast({
        title: data.success ? "Import Successful" : "Import Failed",
        description: data.message,
        variant: data.success ? "default" : "destructive"
      });
      
      if (data.success) {
        // Refresh the DAT loads to show imported data
        queryClient.invalidateQueries({ queryKey: ['/api/dat-loads-direct'] });
        queryClient.invalidateQueries({ queryKey: ['/api/google-sheets/loads'] });
      }
    },
    onError: (error) => {
      toast({
        title: "Import Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const handleTestConnection = () => {
    if (!spreadsheetId) {
      toast({
        title: "Missing Information",
        description: "Please enter a Google Sheet ID",
        variant: "destructive"
      });
      return;
    }
    testConnectionMutation.mutate(spreadsheetId);
  };

  const handleGetSheetInfo = () => {
    if (!spreadsheetId) {
      toast({
        title: "Missing Information", 
        description: "Please enter a Google Sheet ID",
        variant: "destructive"
      });
      return;
    }
    getSheetInfoMutation.mutate(spreadsheetId);
  };

  const handleImportLoads = () => {
    if (!spreadsheetId) {
      toast({
        title: "Missing Information",
        description: "Please enter a Google Sheet ID",
        variant: "destructive"
      });
      return;
    }
    importLoadsMutation.mutate({ 
      sheetId: spreadsheetId, 
      sheetRange: range 
    });
  };

  const extractSheetIdFromUrl = (url: string): string => {
    // Extract sheet ID from Google Sheets URL
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : url;
  };

  const handleUrlInput = (value: string) => {
    const extractedId = extractSheetIdFromUrl(value);
    setSpreadsheetId(extractedId);
  };

  const sheetInfo = getSheetInfoMutation.data as SheetInfo | undefined;
  const importResult = importLoadsMutation.data as ImportResult | undefined;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Google Sheets Import</h1>
          <p className="text-gray-600 mt-1">
            Import load data directly from Google Sheets into LoadMaster
          </p>
        </div>
        <div className="flex items-center gap-2">
          {statusLoading ? (
            <Badge variant="outline">Checking...</Badge>
          ) : isConfigured ? (
            <Badge variant="default" className="bg-green-500">
              <CheckCircle className="w-3 h-3 mr-1" />
              Configured
            </Badge>
          ) : (
            <Badge variant="destructive">
              <AlertCircle className="w-3 h-3 mr-1" />
              Not Configured
            </Badge>
          )}
        </div>
      </div>

      <Card className="border-blue-200 bg-blue-50">
        <CardHeader>
          <CardTitle className="text-blue-800 flex items-center">
            <ExternalLink className="w-5 h-5 mr-2" />
            Easy Setup Options
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-blue-700 space-y-3">
            <div>
              <h4 className="font-medium">📋 Option 1: Public Sheet (Recommended)</h4>
              <p className="text-sm">Just make your Google Sheet "Anyone with link can view" and paste the URL below!</p>
            </div>
            {!isConfigured && (
              <div>
                <h4 className="font-medium">🔐 Option 2: Private Sheet (Advanced)</h4>
                <p className="text-sm">Set up Google Cloud service account for private sheets (credentials required)</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="import" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="import">Import Data</TabsTrigger>
          <TabsTrigger value="setup">Column Setup</TabsTrigger>
          <TabsTrigger value="history">Import History</TabsTrigger>
        </TabsList>

        <TabsContent value="import" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Sheet className="w-5 h-5 mr-2 text-green-600" />
                Google Sheet Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Google Sheet URL or ID
                </label>
                <Input
                  type="text"
                  placeholder="https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID or just the ID"
                  value={spreadsheetId}
                  onChange={(e) => handleUrlInput(e.target.value)}
                  className="mb-2"
                />
                <p className="text-xs text-gray-500">
                  Paste the full Google Sheets URL or just the spreadsheet ID
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Range (Optional)
                </label>
                <Input
                  type="text"
                  placeholder="Sheet1!A:Z"
                  value={range}
                  onChange={(e) => setRange(e.target.value)}
                />
                <p className="text-xs text-gray-500">
                  Specify which range to import (default: Sheet1!A:Z)
                </p>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTestConnection}
                  disabled={testConnectionMutation.isPending}
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  {testConnectionMutation.isPending ? 'Testing...' : 'Test Connection'}
                </Button>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleGetSheetInfo}
                  disabled={getSheetInfoMutation.isPending}
                >
                  <FileText className="w-4 h-4 mr-2" />
                  {getSheetInfoMutation.isPending ? 'Loading...' : 'Get Sheet Info'}
                </Button>
              </div>

              {sheetInfo && (
                <Card className="bg-blue-50 border-blue-200">
                  <CardContent className="pt-4">
                    <h4 className="font-medium text-blue-900">{sheetInfo.title}</h4>
                    <div className="mt-2 space-y-1">
                      {sheetInfo.sheets.map((sheet) => (
                        <div key={sheet.sheetId} className="text-sm text-blue-700">
                          📄 {sheet.title} ({sheet.gridProperties.rowCount} rows, {sheet.gridProperties.columnCount} columns)
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Download className="w-5 h-5 mr-2 text-blue-600" />
                Import Loads
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Button
                onClick={handleImportLoads}
                disabled={importLoadsMutation.isPending}
                className="w-full"
                size="lg"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${importLoadsMutation.isPending ? 'animate-spin' : ''}`} />
                {importLoadsMutation.isPending ? 'Importing...' : 'Import Loads from Sheet'}
              </Button>

              {importResult && importResult.success && (
                <Card className="mt-4 bg-green-50 border-green-200">
                  <CardContent className="pt-4">
                    <div className="text-green-800">
                      <h4 className="font-medium">✅ Import Successful</h4>
                      <ul className="mt-2 space-y-1 text-sm">
                        <li>📦 {importResult.loadsImported} loads imported</li>
                        <li>📱 {importResult.driversNotified} drivers notified</li>
                      </ul>
                      {importResult.previewLoads && importResult.previewLoads.length > 0 && (
                        <div className="mt-3">
                          <h5 className="text-sm font-medium">Preview of imported loads:</h5>
                          <div className="mt-1 space-y-1">
                            {importResult.previewLoads.slice(0, 2).map((load, i) => (
                              <div key={i} className="text-xs bg-white p-2 rounded border">
                                🚚 {load.originCity} → {load.destinationCity} | ${load.rate} | {load.equipmentType}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="setup">
          <Card>
            <CardHeader>
              <CardTitle>Column Mapping</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-blue-50 p-4 rounded-lg">
                <h4 className="font-medium text-blue-900 mb-3">Expected Column Order:</h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>• Column A: Origin (city, state)</div>
                  <div>• Column B: Destination (city, state)</div>
                  <div>• Column C: Rate ($)</div>
                  <div>• Column D: Miles</div>
                  <div>• Column E: Equipment Type</div>
                  <div>• Column F: Company Name</div>
                  <div>• Column G: Phone Number</div>
                  <div>• Column H: Pickup Date</div>
                  <div>• Column I: Delivery Date</div>
                  <div>• Column J: Weight</div>
                  <div>• Column K: Commodity</div>
                  <div>• Column L: Special Requirements</div>
                </div>
                <p className="text-xs text-blue-700 mt-3">
                  The system will automatically detect and parse your data based on this column order.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Truck className="w-5 h-5 mr-2" />
                Import History
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-500">Import history will appear here after successful imports.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}