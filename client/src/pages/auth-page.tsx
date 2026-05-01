import { useEffect, useState } from "react";
import { useUser } from "@/hooks/use-user";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Truck } from "lucide-react";

export default function AuthPage() {
  const { login, isLoading, error } = useUser();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/config")
      .then((r) => r.json())
      .then((c) => setGoogleEnabled(!!c?.google))
      .catch(() => setGoogleEnabled(false));
    // Surface ?error= from /api/auth/google/callback redirects
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error");
    if (err) setOauthError(decodeURIComponent(err));
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    await login(username, password);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-slate-800 bg-slate-900 text-slate-100">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center mb-4">
            <Truck className="w-6 h-6 text-white" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">Login to TRAQ IQ</CardTitle>
          <p className="text-sm text-slate-400">Enter your credentials to access the command center.</p>
        </CardHeader>
        <CardContent>
          {googleEnabled && (
            <>
              <Button
                type="button"
                onClick={() => { window.location.href = "/api/auth/google"; }}
                className="w-full bg-white text-slate-900 hover:bg-slate-100 font-bold mb-3"
                data-testid="btn-google-signin"
              >
                <svg className="w-4 h-4 mr-2" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 8 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
                  <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16.1 19 13 24 13c3 0 5.8 1.1 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"/>
                  <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.4 39.6 16.1 44 24 44z"/>
                  <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.1 4.1-3.9 5.6l6.2 5.2c-.4.4 6.4-4.7 6.4-14.3 0-1.3-.1-2.4-.4-3.5z"/>
                </svg>
                Sign in with Google
              </Button>
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-slate-800" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-slate-900 px-2 text-slate-500">Or with password</span>
                </div>
              </div>
            </>
          )}
          {oauthError && (
            <p className="text-sm text-red-400 mb-3">{oauthError}</p>
          )}
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username or Email</Label>
              <Input
                id="username"
                placeholder="username or email"
                className="!bg-slate-950 !border-slate-800 focus-visible:ring-blue-600 !text-slate-100 placeholder:!text-slate-500"
                style={{ color: '#f1f5f9', backgroundColor: '#020617' }}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                className="!bg-slate-950 !border-slate-800 focus-visible:ring-blue-600 !text-slate-100 placeholder:!text-slate-500"
                style={{ color: '#f1f5f9', backgroundColor: '#020617' }}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <p className="text-sm text-red-400">{error}</p>
            )}
            <Button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-500 font-bold"
              disabled={isLoading}
            >
              {isLoading ? "Authenticating..." : "Sign In"}
            </Button>
          </form>

          <div className="mt-4 text-center text-xs text-slate-500">
            Authorized Personnel Only • IP Logged
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
