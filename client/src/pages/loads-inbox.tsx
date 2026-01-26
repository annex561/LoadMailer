import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Send, Check, X, Inbox, TrendingUp, DollarSign, Truck, FileText, History, Lightbulb, Receipt, CreditCard, MapPin, User, Phone, Mail, ChevronsUpDown } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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
  broker_phone?: string;
  dispatcher_name?: string;
  driver_name?: string;
  offered_rate?: number;
  booked_rate?: number;
  offered_at?: string;
  booked_at?: string;
  assigned_truck_id?: string;
  assigned_driver_id?: string;
  ratecon_path?: string;
  invoice_status?: string;
  invoice_number?: string;
  invoice_amount?: number;
  invoice_sent_at?: string;
  invoice_paid_at?: string;
  payment_method?: string;
  payment_ref?: string;
}

interface ActivityLog {
  id: number;
  load_id: string;
  action: string;
  actor: string;
  details: string;
  created_at: string;
}

interface Driver {
  id: number;
  name: string;
  phone: string;
  status: string;
}

interface BookModalState {
  open: boolean;
  load: GALoad | null;
  bookedRate: string;
  truckId: string;
  driverId: string;
  driverName: string;
  overrideReason: string;
  requiresOverride: boolean;
  gateStatus: string;
}

export default function LoadsInbox() {
  const { toast } = useToast();
  const [loads, setLoads] = useState<GALoad[]>([]);
  const [shortlist, setShortlist] = useState<GALoad[]>([]);
  const [minScore, setMinScore] = useState(60);
  const [loading, setLoading] = useState(false);
  
  const [bookModal, setBookModal] = useState<BookModalState>({
    open: false,
    load: null,
    bookedRate: "",
    truckId: "",
    driverId: "",
    driverName: "",
    overrideReason: "",
    requiresOverride: false,
    gateStatus: ""
  });
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [driverSearch, setDriverSearch] = useState("");
  const [driverPopoverOpen, setDriverPopoverOpen] = useState(false);
  
  const [activityModal, setActivityModal] = useState<{ open: boolean; loadId: string; activity: ActivityLog[] }>({
    open: false,
    loadId: "",
    activity: []
  });

  async function loadData() {
    const [a, b] = await Promise.all([
      fetch(`/api/ga/loads?limit=100`).then((r) => r.json()),
      fetch(`/api/ga/loads/shortlist?limit=10`).then((r) => r.json()),
    ]);
    setLoads(a.loads || []);
    setShortlist(b.loads || []);
  }

  async function refresh() {
    setLoading(true);
    try {
      await loadData();
    } catch (e: any) {
      toast({ title: "Error loading data", description: e?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function calculateMilesForLoad(loadId: string) {
    try {
      const r = await fetch(`/api/ga/loads/${loadId}/calculate-miles`, { method: "POST" });
      const data = await r.json();
      if (data.ok) {
        toast({ title: "Miles Calculated", description: `${data.miles} miles${data.rpm ? ` ($${data.rpm}/mi)` : ''}` });
        await loadData();
      } else {
        throw new Error(data.error || "Could not calculate miles");
      }
    } catch (e: any) {
      toast({ title: "Error", description: e?.message, variant: "destructive" });
    }
  }

  async function calculateAllMiles() {
    setLoading(true);
    try {
      const r = await fetch(`/api/ga/loads/calculate-all-miles`, { method: "POST" });
      const data = await r.json();
      if (data.ok) {
        toast({ title: "Miles Calculated", description: `Updated ${data.updated} loads` });
        await loadData();
      } else {
        throw new Error(data.error || "Failed to calculate miles");
      }
    } catch (e: any) {
      toast({ title: "Error", description: e?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function scanGmail(forceRescan: boolean = false) {
    setLoading(true);
    try {
      const r = await fetch(`/api/gmail/scan`, { 
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forceRescan })
      });
      const data = await r.json();
      if (data.ok || data.success) {
        const totalLoads = data.results?.reduce((sum: number, a: any) => sum + (a.loadsCreated || 0), 0) || 0;
        const totalFiles = data.results?.reduce((sum: number, a: any) => sum + (a.filesProcessed || 0), 0) || 0;
        toast({ 
          title: forceRescan ? "Force Rescan Complete" : "Gmail Scan Complete", 
          description: `Processed ${totalFiles} files, created/updated ${totalLoads} loads` 
        });
        await loadData();
      } else {
        throw new Error(data.error || "Gmail scan failed");
      }
    } catch (e: any) {
      toast({ title: "Gmail Scan Error", description: e?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function fixBrokerInfo() {
    setLoading(true);
    try {
      const r = await fetch(`/api/ga/loads/fix-broker-info`, { method: "POST" });
      const data = await r.json();
      if (data.ok) {
        toast({ 
          title: "Broker Info Fixed", 
          description: `Updated ${data.updated} of ${data.total} loads, ${data.statusUpdated || 0} set to booked` 
        });
        await loadData();
      } else {
        throw new Error(data.error || "Failed to fix broker info");
      }
    } catch (e: any) {
      toast({ title: "Error", description: e?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const filtered = useMemo(() => {
    return loads.filter((l) => (Number(l.score) || 0) >= minScore);
  }, [loads, minScore]);

  async function act(id: string, action: string, body: any = {}) {
    try {
      const r = await fetch(`/api/ga/loads/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((x) => x.json());

      if (!r.ok) {
        if (r.requires_override) {
          return { requiresOverride: true, gateStatus: r.dispatch_status };
        }
        throw new Error(r.error || "Action failed");
      }

      if (action === "quote" && r.email) {
        toast({ 
          title: "Quote Ready", 
          description: `To: ${r.email.to || "(no email)"} | Subject: ${r.email.subject}` 
        });
      } else if (action === "ratecon/generate") {
        toast({ title: "RateCon Generated", description: r.ratecon_path });
      } else {
        toast({ title: `${action.charAt(0).toUpperCase() + action.slice(1)} successful` });
      }

      await refresh();
      return { ok: true };
    } catch (e: any) {
      toast({ title: "Action failed", description: e?.message, variant: "destructive" });
      return { ok: false, error: e?.message };
    }
  }

  async function fetchDrivers() {
    try {
      const res = await fetch("/api/drivers");
      if (res.ok) {
        const data = await res.json();
        setDrivers(data || []);
      }
    } catch (err) {
      console.warn("Failed to fetch drivers:", err);
    }
  }

  async function openBookModal(load: GALoad) {
    fetchDrivers();
    setDriverSearch("");
    setDriverPopoverOpen(false);
    setBookModal({
      open: true,
      load,
      bookedRate: String(load.offered_rate || load.rate_total || ""),
      truckId: load.assigned_truck_id || "",
      driverId: load.assigned_driver_id || "",
      driverName: load.driver_name || "",
      overrideReason: "",
      requiresOverride: false,
      gateStatus: ""
    });
  }

  async function handleBook() {
    if (!bookModal.load) return;

    // When driver is assigned, set status to "dispatched" to move from Inbox to Active Dispatch
    const result = await act(bookModal.load.id, "book", {
      booked_rate: parseFloat(bookModal.bookedRate) || undefined,
      assigned_truck_id: bookModal.truckId || undefined,
      assigned_driver_id: bookModal.driverId || undefined,
      override_reason: bookModal.overrideReason || undefined,
      status: bookModal.driverId ? "dispatched" : undefined // Move to Active Dispatch when driver assigned
    });

    if (result.requiresOverride) {
      setBookModal(prev => ({
        ...prev,
        requiresOverride: true,
        gateStatus: result.gateStatus || "YELLOW"
      }));
    } else if (result.ok) {
      toast({ 
        title: "Load Dispatched", 
        description: `Load moved to Active Dispatch${bookModal.driverName ? ` with ${bookModal.driverName}` : ""}`
      });
      setBookModal(prev => ({ ...prev, open: false }));
    }
  }

  async function showActivity(loadId: string) {
    try {
      const r = await fetch(`/api/ga/loads/${loadId}/activity`).then(x => x.json());
      setActivityModal({
        open: true,
        loadId,
        activity: r.activity || []
      });
    } catch (e: any) {
      toast({ title: "Error loading activity", description: e?.message, variant: "destructive" });
    }
  }

  async function getRecommend(load: GALoad) {
    try {
      const data = await fetch(`/api/ga/loads/${encodeURIComponent(load.id)}/recommend`).then(x => x.json());
      if (!data.ok) throw new Error(data.error || "Recommend failed");
      
      const topTruck = data?.recommended_trucks?.[0];
      const topDriver = data?.recommended_drivers?.[0];
      
      setBookModal({
        open: true,
        load,
        bookedRate: String(load.offered_rate || load.rate_total || ""),
        truckId: topTruck?.id || "",
        driverId: topDriver?.id || "",
        overrideReason: "",
        requiresOverride: false,
        gateStatus: topTruck?.gate?.status || ""
      });
      
      toast({ 
        title: "AI Recommendation",
        description: topTruck 
          ? `Top pick: Truck ${topTruck?.label || topTruck?.id} (${topTruck?.gate?.status || "?"})${topDriver ? ` | Driver: ${topDriver?.name || topDriver?.id}` : ""}`
          : topDriver ? `Driver: ${topDriver?.name || topDriver?.id}` : "No recommendations available"
      });
    } catch (e: any) {
      toast({ title: "Recommend failed", description: e?.message, variant: "destructive" });
    }
  }

  async function createInvoice(id: string) {
    try {
      await fetch(`/api/ga/loads/${encodeURIComponent(id)}/invoice/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      }).then(x => x.json());
      toast({ title: "Invoice created" });
      await refresh();
    } catch (e: any) {
      toast({ title: "Failed to create invoice", description: e?.message, variant: "destructive" });
    }
  }

  async function sendInvoice(id: string) {
    try {
      await fetch(`/api/ga/loads/${encodeURIComponent(id)}/invoice/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      }).then(x => x.json());
      toast({ title: "Invoice marked as sent" });
      await refresh();
    } catch (e: any) {
      toast({ title: "Failed to send invoice", description: e?.message, variant: "destructive" });
    }
  }

  async function recordPayment(id: string) {
    const method = window.prompt("Payment method (ACH, Zelle, Check, Card, etc.):")?.trim() || "unknown";
    const ref = window.prompt("Payment reference (optional):")?.trim() || "";
    try {
      await fetch(`/api/ga/loads/${encodeURIComponent(id)}/payment/record`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_method: method, payment_ref: ref || null })
      }).then(x => x.json());
      toast({ title: "Payment recorded" });
      await refresh();
    } catch (e: any) {
      toast({ title: "Failed to record payment", description: e?.message, variant: "destructive" });
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
      case 'offered': return <Badge className="bg-purple-500">Offered</Badge>;
      case 'quoted': return <Badge className="bg-blue-500">Quoted</Badge>;
      case 'booked': return <Badge className="bg-green-600">Booked</Badge>;
      case 'skipped': return <Badge variant="secondary">Skipped</Badge>;
      case 'dismissed': return <Badge variant="secondary">Dismissed</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const renderActions = (l: GALoad, compact = false) => {
    const isActionable = ["new", "offered", "quoted"].includes(l.status);
    const isBooked = l.status === "booked";
    
    if (!isActionable && !isBooked) return null;

    return (
      <div className="flex gap-1 flex-wrap">
        {["new", "offered", "quoted"].includes(l.status) && (
          <Button size="sm" variant="default" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => openBookModal(l)}>
            <Check className="w-3 h-3 mr-1" />
            Book
          </Button>
        )}
        {isBooked && !l.ratecon_path && (
          <Button size="sm" variant="outline" onClick={() => act(l.id, "ratecon/generate")}>
            <FileText className="w-3 h-3 mr-1" />
            RateCon
          </Button>
        )}
        {isBooked && !l.invoice_number && (
          <Button size="sm" variant="outline" onClick={() => createInvoice(l.id)}>
            <Receipt className="w-3 h-3 mr-1" />
            Invoice
          </Button>
        )}
        {isBooked && l.invoice_status === "draft" && (
          <Button size="sm" variant="outline" onClick={() => sendInvoice(l.id)}>
            <Send className="w-3 h-3 mr-1" />
            Send
          </Button>
        )}
        {isBooked && l.invoice_status === "sent" && !l.invoice_paid_at && (
          <Button size="sm" variant="outline" onClick={() => recordPayment(l.id)}>
            <CreditCard className="w-3 h-3 mr-1" />
            Payment
          </Button>
        )}
        {isBooked && l.invoice_status === "paid" && (
          <Badge className="bg-green-600 ml-1">Paid</Badge>
        )}
        {isBooked && l.assigned_truck_id && (
          <Badge variant="outline" className="ml-1">
            <Truck className="w-3 h-3 mr-1" />
            {l.assigned_truck_id.slice(0, 6)}
          </Badge>
        )}
        {!compact && isBooked && (
          <Button size="sm" variant="ghost" onClick={() => showActivity(l.id)}>
            <History className="w-3 h-3" />
          </Button>
        )}
      </div>
    );
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
            Revenue pipeline: Offer → Book → RateCon → Invoice
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => scanGmail(false)} disabled={loading} variant="outline">
            <Mail className="w-4 h-4 mr-2" />
            Scan Gmail
          </Button>
          <Button onClick={fixBrokerInfo} disabled={loading} variant="outline">
            <RefreshCw className="w-4 h-4 mr-2" />
            Fix Data
          </Button>
          <Button onClick={calculateAllMiles} disabled={loading} variant="outline">
            <MapPin className="w-4 h-4 mr-2" />
            Fill Miles
          </Button>
          <Button onClick={refresh} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
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
                <TableHead>Route</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Broker</TableHead>
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
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    No new loads yet. Ingest loads via POST /api/ga/loads/ingest.
                  </TableCell>
                </TableRow>
              ) : (
                shortlist.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span>{l.origin_city}, {l.origin_state} → {l.dest_city}, {l.dest_state}</span>
                        {l.dispatcher_name && (
                          <span className="text-xs text-muted-foreground"><User className="w-3 h-3 inline mr-1" />{l.dispatcher_name}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {l.driver_name ? (
                        <span className="text-green-600 font-medium"><Truck className="w-3 h-3 inline mr-1" />{l.driver_name}</span>
                      ) : <span className="text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        {l.broker_name && <span className="font-semibold text-sm">{l.broker_name}</span>}
                        {l.broker_email && (
                          <a href={`mailto:${l.broker_email}`} className="text-xs text-blue-400 hover:text-blue-300 hover:underline">
                            {l.broker_email}
                          </a>
                        )}
                        {l.broker_phone && (
                          <span className="text-xs text-slate-400">
                            <Phone className="w-3 h-3 inline mr-1" />{l.broker_phone}
                          </span>
                        )}
                        {!l.broker_name && !l.broker_email && !l.broker_phone && <span className="text-muted-foreground">Unknown</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      {l.miles ? l.miles : (
                        <Button size="sm" variant="ghost" onClick={() => calculateMilesForLoad(l.id)} title="Calculate miles">
                          <MapPin className="w-3 h-3" />
                        </Button>
                      )}
                    </TableCell>
                    <TableCell>${l.rate_total ?? "-"}</TableCell>
                    <TableCell>{l.rpm ? `$${l.rpm}/mi` : "-"}</TableCell>
                    <TableCell>{getStatusBadge(l.status)}</TableCell>
                    <TableCell>{renderActions(l)}</TableCell>
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
                <TableHead>Route</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Broker</TableHead>
                <TableHead>Pickup</TableHead>
                <TableHead>Miles</TableHead>
                <TableHead>Rate</TableHead>
                <TableHead>RPM</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    No loads meet min score {minScore}.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span>{l.origin_city}, {l.origin_state} → {l.dest_city}, {l.dest_state}</span>
                        {l.dispatcher_name && (
                          <span className="text-xs text-muted-foreground"><User className="w-3 h-3 inline mr-1" />{l.dispatcher_name}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {l.driver_name ? (
                        <span className="text-green-600 font-medium"><Truck className="w-3 h-3 inline mr-1" />{l.driver_name}</span>
                      ) : <span className="text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        {l.broker_name && <span className="font-semibold text-sm">{l.broker_name}</span>}
                        {l.broker_email && (
                          <a href={`mailto:${l.broker_email}`} className="text-xs text-blue-400 hover:text-blue-300 hover:underline">
                            {l.broker_email}
                          </a>
                        )}
                        {l.broker_phone && (
                          <span className="text-xs text-slate-400">
                            <Phone className="w-3 h-3 inline mr-1" />{l.broker_phone}
                          </span>
                        )}
                        {!l.broker_name && !l.broker_email && !l.broker_phone && <span className="text-muted-foreground">Unknown</span>}
                      </div>
                    </TableCell>
                    <TableCell>{l.pickup_dt || "-"}</TableCell>
                    <TableCell>
                      {l.miles ? l.miles : (
                        <Button size="sm" variant="ghost" onClick={() => calculateMilesForLoad(l.id)} title="Calculate miles">
                          <MapPin className="w-3 h-3" />
                        </Button>
                      )}
                    </TableCell>
                    <TableCell>${l.rate_total ?? "-"}</TableCell>
                    <TableCell>{l.rpm ? `$${l.rpm}/mi` : "-"}</TableCell>
                    <TableCell>{getStatusBadge(l.status)}</TableCell>
                    <TableCell>{renderActions(l)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Book Modal with Dispatch Gate */}
      <Dialog open={bookModal.open} onOpenChange={(open) => setBookModal(prev => ({ ...prev, open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Check className="w-5 h-5" />
              Book Load
            </DialogTitle>
          </DialogHeader>
          
          {bookModal.load && (
            <div className="space-y-4">
              <div className="p-3 bg-muted rounded-lg">
                <p className="font-medium">
                  {bookModal.load.origin_city}, {bookModal.load.origin_state} → {bookModal.load.dest_city}, {bookModal.load.dest_state}
                </p>
                <p className="text-sm text-muted-foreground">
                  {bookModal.load.miles} miles | ${bookModal.load.rate_total} | {bookModal.load.broker_name}
                </p>
              </div>

              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label>Rate from RateCon</Label>
                  <div className="flex items-center gap-2 p-3 bg-slate-100 dark:bg-slate-700 rounded-md">
                    <DollarSign className="w-5 h-5 text-emerald-500" />
                    <span className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                      ${bookModal.bookedRate || "0"}
                    </span>
                    <span className="text-xs text-muted-foreground ml-auto">(from rate confirmation)</span>
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="truckId">Assign Truck (optional)</Label>
                  <Input
                    id="truckId"
                    value={bookModal.truckId}
                    onChange={(e) => setBookModal(prev => ({ ...prev, truckId: e.target.value }))}
                    placeholder="Truck ID"
                  />
                </div>

                <div className="grid gap-2">
                  <Label>Assign Driver (optional)</Label>
                  <Popover open={driverPopoverOpen} onOpenChange={setDriverPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={driverPopoverOpen}
                        className="w-full justify-between font-normal"
                      >
                        {bookModal.driverName || "Select driver..."}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-full p-0" align="start">
                      <Command>
                        <CommandInput 
                          placeholder="Search drivers..." 
                          value={driverSearch}
                          onValueChange={setDriverSearch}
                        />
                        <CommandList>
                          <CommandEmpty>No drivers found.</CommandEmpty>
                          <CommandGroup>
                            {drivers
                              .filter(d => 
                                d.name.toLowerCase().includes(driverSearch.toLowerCase()) ||
                                d.phone?.includes(driverSearch)
                              )
                              .slice(0, 10)
                              .map((driver) => (
                                <CommandItem
                                  key={driver.id}
                                  value={driver.name}
                                  onSelect={() => {
                                    setBookModal(prev => ({
                                      ...prev,
                                      driverId: String(driver.id),
                                      driverName: driver.name
                                    }));
                                    setDriverPopoverOpen(false);
                                  }}
                                >
                                  <User className="mr-2 h-4 w-4" />
                                  <span className="flex-1">{driver.name}</span>
                                  {driver.phone && (
                                    <span className="text-xs text-muted-foreground ml-2">{driver.phone}</span>
                                  )}
                                  {bookModal.driverId === String(driver.id) && (
                                    <Check className="ml-2 h-4 w-4 text-emerald-500" />
                                  )}
                                </CommandItem>
                              ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {bookModal.driverName && (
                    <p className="text-xs text-muted-foreground">
                      Driver will receive SMS confirmation when load is booked.
                    </p>
                  )}
                </div>

                {bookModal.requiresOverride && (
                  <div className="p-3 rounded-lg border-2 border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20">
                    <p className="font-medium text-yellow-700 dark:text-yellow-400 flex items-center gap-2">
                      <Truck className="w-4 h-4" />
                      Dispatch Gate: {bookModal.gateStatus}
                    </p>
                    <p className="text-sm text-yellow-600 dark:text-yellow-500 mt-1">
                      This truck requires manager override. Please provide a reason.
                    </p>
                    <Textarea
                      className="mt-2"
                      value={bookModal.overrideReason}
                      onChange={(e) => setBookModal(prev => ({ ...prev, overrideReason: e.target.value }))}
                      placeholder="Enter override reason (required)"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setBookModal(prev => ({ ...prev, open: false }))}>
              Cancel
            </Button>
            <Button 
              onClick={handleBook}
              disabled={bookModal.requiresOverride && !bookModal.overrideReason}
            >
              <Check className="w-4 h-4 mr-2" />
              {bookModal.requiresOverride ? "Override & Book" : "Book Load"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Activity Modal */}
      <Dialog open={activityModal.open} onOpenChange={(open) => setActivityModal(prev => ({ ...prev, open }))}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="w-5 h-5" />
              Activity Log
            </DialogTitle>
          </DialogHeader>
          
          <div className="max-h-96 overflow-y-auto space-y-2">
            {activityModal.activity.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">No activity yet</p>
            ) : (
              activityModal.activity.map((a) => (
                <div key={a.id} className="p-2 border rounded text-sm">
                  <div className="flex justify-between">
                    <Badge variant="outline">{a.action}</Badge>
                    <span className="text-muted-foreground text-xs">{a.created_at}</span>
                  </div>
                  <p className="text-muted-foreground mt-1">by {a.actor}</p>
                  {a.details && (
                    <pre className="text-xs mt-1 p-1 bg-muted rounded overflow-x-auto">
                      {a.details}
                    </pre>
                  )}
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
