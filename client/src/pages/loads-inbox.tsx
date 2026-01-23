import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Send, Check, X, Inbox, TrendingUp } from "lucide-react";

interface GALoad {
  id: string;
  score: number;
  origin_city: string;
  origin_state: string;
  dest_city: string;
  dest_state: string;
  pickup_dt: string;
  miles: number;
  rate_total: number;
  rpm: number;
  status: string;
  equipment: string;
  broker_name: string;
  broker_email: string;
}

export default function LoadsInbox() {
  const { toast } = useToast();
  const [loads, setLoads] = useState<GALoad[]>([]);
  const [shortlist, setShortlist] = useState<GALoad[]>([]);
  const [minScore, setMinScore] = useState(60);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([
        fetch(`/api/ga/loads?limit=100`).then((r) => r.json()),
        fetch(`/api/ga/loads/shortlist?limit=10`).then((r) => r.json()),
      ]);
      setLoads(a.loads || []);
      setShortlist(b.loads || []);
    } catch (e: any) {
      toast({ title: "Error loading data", description: e?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const filtered = useMemo(() => {
    return loads.filter((l) => (Number(l.score) || 0) >= minScore);
  }, [loads, minScore]);

  async function act(id: string, action: string) {
    try {
      const r = await fetch(`/api/ga/loads/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }).then((x) => x.json());

      if (!r.ok) throw new Error(r.error || "Action failed");

      if (action === "quote" && r.email) {
        toast({ 
          title: "Quote Ready", 
          description: `To: ${r.email.to || "(no email)"} | Subject: ${r.email.subject}` 
        });
      } else {
        toast({ title: `${action.charAt(0).toUpperCase() + action.slice(1)} successful` });
      }

      await refresh();
    } catch (e: any) {
      toast({ title: "Action failed", description: e?.message, variant: "destructive" });
    }
  }

  const getScoreBadge = (score: number) => {
    if (score >= 80) return <Badge className="bg-green-500 text-white">{score}</Badge>;
    if (score >= 60) return <Badge className="bg-yellow-500 text-black">{score}</Badge>;
    if (score >= 40) return <Badge className="bg-orange-500 text-white">{score}</Badge>;
    return <Badge variant="secondary">{score}</Badge>;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'new': return <Badge variant="outline">New</Badge>;
      case 'quoted': return <Badge className="bg-blue-500">Quoted</Badge>;
      case 'booked': return <Badge className="bg-green-600">Booked</Badge>;
      case 'dismissed': return <Badge variant="secondary">Dismissed</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Inbox className="w-8 h-8" />
            GA Loads Inbox
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Revenue screen: shortlist the best loads, quote fast, book faster.
          </p>
        </div>
        <Button onClick={refresh} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <span className="text-sm font-medium">Min Score: {minScore}</span>
        <div className="w-48">
          <Slider
            value={[minScore]}
            onValueChange={(v) => setMinScore(v[0])}
            min={0}
            max={100}
            step={5}
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-green-500" />
            Top 10 Shortlist
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Score</TableHead>
                <TableHead>Route</TableHead>
                <TableHead>Miles</TableHead>
                <TableHead>Rate</TableHead>
                <TableHead>RPM</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shortlist.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No new loads yet. Ingest loads via POST /api/ga/loads/ingest.
                  </TableCell>
                </TableRow>
              ) : (
                shortlist.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{getScoreBadge(l.score)}</TableCell>
                    <TableCell>
                      {l.origin_city}, {l.origin_state} → {l.dest_city}, {l.dest_state}
                    </TableCell>
                    <TableCell>{l.miles ?? "-"}</TableCell>
                    <TableCell>${l.rate_total ?? "-"}</TableCell>
                    <TableCell>${l.rpm ?? "-"}/mi</TableCell>
                    <TableCell>{getStatusBadge(l.status)}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => act(l.id, "quote")}>
                          <Send className="w-3 h-3 mr-1" />
                          Quote
                        </Button>
                        <Button size="sm" variant="default" onClick={() => act(l.id, "book")}>
                          <Check className="w-3 h-3 mr-1" />
                          Book
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => act(l.id, "dismiss")}>
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Inbox className="w-5 h-5" />
            All Loads (Filtered: score ≥ {minScore})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Score</TableHead>
                <TableHead>Route</TableHead>
                <TableHead>Pickup</TableHead>
                <TableHead>Miles</TableHead>
                <TableHead>Rate</TableHead>
                <TableHead>RPM</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No loads meet min score {minScore}.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{getScoreBadge(l.score)}</TableCell>
                    <TableCell>
                      {l.origin_city}, {l.origin_state} → {l.dest_city}, {l.dest_state}
                    </TableCell>
                    <TableCell>{l.pickup_dt || "-"}</TableCell>
                    <TableCell>{l.miles ?? "-"}</TableCell>
                    <TableCell>${l.rate_total ?? "-"}</TableCell>
                    <TableCell>${l.rpm ?? "-"}/mi</TableCell>
                    <TableCell>{getStatusBadge(l.status)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
