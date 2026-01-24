import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Mail, Plus, Trash2, RefreshCw, CheckCircle, XCircle } from "lucide-react";

interface GmailAccount {
  id: string;
  companyId: string;
  email: string;
  isActive: boolean;
  lastSyncedAt: string | null;
  createdAt: string;
}

export default function GmailSettings() {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [companyId, setCompanyId] = useState("default");

  const { data: accounts = [], isLoading } = useQuery<GmailAccount[]>({
    queryKey: ["/api/gmail/accounts", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/gmail/accounts?companyId=${companyId}`);
      return res.json();
    }
  });

  const addAccountMutation = useMutation({
    mutationFn: async (data: { email: string; refreshToken: string; companyId: string }) => {
      return apiRequest("/api/gmail/add-account", {
        method: "POST",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" }
      });
    },
    onSuccess: () => {
      toast({ title: "Success", description: `Connected ${email}` });
      setEmail("");
      setRefreshToken("");
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/accounts"] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const deleteAccountMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest(`/api/gmail/accounts/${id}?companyId=${companyId}`, {
        method: "DELETE"
      });
    },
    onSuccess: () => {
      toast({ title: "Removed", description: "Gmail account disconnected" });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/accounts"] });
    }
  });

  const scanMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/gmail/scan", {
        method: "POST",
        body: JSON.stringify({ companyId }),
        headers: { "Content-Type": "application/json" }
      });
    },
    onSuccess: (data: any) => {
      toast({ 
        title: "Scan Complete", 
        description: `Scanned ${data.accountsScanned} accounts, found ${data.totalFilesFound} files` 
      });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/accounts"] });
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !refreshToken) {
      toast({ title: "Error", description: "Email and Refresh Token are required", variant: "destructive" });
      return;
    }
    addAccountMutation.mutate({ email, refreshToken, companyId });
  };

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <Mail className="h-8 w-8 text-teal-600" />
        <div>
          <h1 className="text-2xl font-bold">Gmail Accounts</h1>
          <p className="text-muted-foreground">Connect Gmail accounts for automatic Rate Confirmation ingestion</p>
        </div>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Add Gmail Account
            </CardTitle>
            <CardDescription>
              Paste the refresh token from Google OAuth Playground
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="email">Gmail Address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="dispatch@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="companyId">Company ID</Label>
                  <Input
                    id="companyId"
                    placeholder="default"
                    value={companyId}
                    onChange={(e) => setCompanyId(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="refreshToken">Refresh Token</Label>
                <Input
                  id="refreshToken"
                  type="password"
                  placeholder="1//04kL..."
                  value={refreshToken}
                  onChange={(e) => setRefreshToken(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Get this from Google OAuth Playground after authorizing with the Gmail account
                </p>
              </div>
              <Button type="submit" disabled={addAccountMutation.isPending}>
                {addAccountMutation.isPending ? "Connecting..." : "Connect Account"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Connected Accounts</CardTitle>
                <CardDescription>
                  {accounts.length} account{accounts.length !== 1 ? "s" : ""} connected
                </CardDescription>
              </div>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => scanMutation.mutate()}
                disabled={scanMutation.isPending || accounts.length === 0}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${scanMutation.isPending ? "animate-spin" : ""}`} />
                Scan Now
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : accounts.length === 0 ? (
              <p className="text-muted-foreground">No Gmail accounts connected yet</p>
            ) : (
              <div className="space-y-3">
                {accounts.map((account) => (
                  <div
                    key={account.id}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <Mail className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="font-medium">{account.email}</p>
                        <p className="text-xs text-muted-foreground">
                          {account.lastSyncedAt 
                            ? `Last synced: ${new Date(account.lastSyncedAt).toLocaleString()}`
                            : "Never synced"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {account.isActive ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteAccountMutation.mutate(account.id)}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>How to Get a Refresh Token</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ol className="list-decimal list-inside space-y-2">
              <li>Open <a href="https://developers.google.com/oauthplayground/" target="_blank" rel="noopener" className="text-teal-600 underline">Google OAuth Playground</a> (use Incognito)</li>
              <li>Click the gear icon → Check "Use your own OAuth credentials"</li>
              <li>Enter your Client ID and Client Secret</li>
              <li>Select scope: <code className="bg-muted px-1 rounded">https://mail.google.com/</code></li>
              <li>Click "Authorize APIs" and sign in with the Gmail account</li>
              <li>Click "Exchange authorization code for tokens"</li>
              <li>Copy the <code className="bg-muted px-1 rounded">refresh_token</code> and paste it above</li>
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
