import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { 
  Calculator, Truck, MapPin, DollarSign, Route, Target, Loader2, 
  AlertTriangle, CheckCircle, XCircle, Camera, Navigation, Clock,
  Plus, X, History, Zap, Home, Building, Star, Trash2, ArrowLeft
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

interface CalculationResult {
  loadPay: number;
  loadMiles: number;
  deadheadMiles: number;
  totalMiles: number;
  postedRpm: number;
  trueRpm: number;
  grade: "green" | "yellow" | "red";
  verdict: string;
  origin: string;
  dropOff: string;
  nextDest: string;
  smartAdvice?: string;
  timestamp: number;
}

interface SavedDestination {
  id: string;
  name: string;
  city: string;
}

const DEFAULT_DESTINATIONS: SavedDestination[] = [
  { id: "base", name: "Home Base", city: "Ooltewah, TN" },
  { id: "hub", name: "Nashville Hub", city: "Nashville, TN" },
];

function getSmartAdvice(trueRpm: number, destination: string): { advice: string; mode: string } {
  const now = new Date();
  const hour = now.getHours() * 100 + now.getMinutes();
  
  const homeKeywords = ["ooltewah", "chattanooga", "cleveland"];
  const isHomebound = homeKeywords.some(k => destination.toLowerCase().includes(k));
  
  if (hour < 1500) {
    if (trueRpm >= 2.50) {
      return { advice: "MONEY MODE: High paying load - BOOK IT!", mode: "money" };
    } else if (trueRpm >= 2.00) {
      return { advice: "MONEY MODE: Decent rate, worth considering.", mode: "money" };
    } else {
      return { advice: "MONEY MODE: Rate too low for morning. Keep looking.", mode: "money" };
    }
  } else if (hour < 1700) {
    if (isHomebound) {
      return { advice: "GO HOME MODE: HOMERUN LOAD FOUND! Book it now!", mode: "home" };
    } else if (trueRpm >= 2.50) {
      return { advice: `GO HOME MODE: Good rate but ${destination} takes you away from home.`, mode: "home" };
    } else {
      return { advice: "GO HOME MODE: Skip this - wrong direction for end of day.", mode: "home" };
    }
  } else {
    if (isHomebound) {
      return { advice: "OVERTIME: Homebound load - take it if you need it.", mode: "overtime" };
    } else {
      return { advice: "OVERTIME: Shift is over. Only take loads going home.", mode: "overtime" };
    }
  }
}

export default function TrueRPMCalculator() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fromLoadsInbox, setFromLoadsInbox] = useState(false);
  
  const [calculating, setCalculating] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [gettingLocation, setGettingLocation] = useState(false);
  const [result, setResult] = useState<CalculationResult | null>(null);

  const [loadPay, setLoadPay] = useState("");
  const [loadMiles, setLoadMiles] = useState("");
  const [origin, setOrigin] = useState("");
  const [dropOff, setDropOff] = useState("");
  const [selectedDest, setSelectedDest] = useState("base");
  const [customDest, setCustomDest] = useState("");

  const [savedDests, setSavedDests] = useState<SavedDestination[]>(() => {
    const saved = localStorage.getItem("rpm-saved-destinations");
    return saved ? JSON.parse(saved) : DEFAULT_DESTINATIONS;
  });
  
  const [recentCalcs, setRecentCalcs] = useState<CalculationResult[]>(() => {
    const saved = localStorage.getItem("rpm-recent-calculations");
    return saved ? JSON.parse(saved) : [];
  });

  const [showAddDest, setShowAddDest] = useState(false);
  const [newDestName, setNewDestName] = useState("");
  const [newDestCity, setNewDestCity] = useState("");

  useEffect(() => {
    localStorage.setItem("rpm-saved-destinations", JSON.stringify(savedDests));
  }, [savedDests]);

  useEffect(() => {
    localStorage.setItem("rpm-recent-calculations", JSON.stringify(recentCalcs.slice(0, 10)));
  }, [recentCalcs]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pay = params.get("pay");
    const miles = params.get("miles");
    const originParam = params.get("origin");
    const dropoffParam = params.get("dropoff");
    
    const hasValidPay = pay && pay !== "0" && parseFloat(pay) > 0;
    const hasValidMiles = miles && miles !== "0" && parseFloat(miles) > 0;
    
    if (hasValidPay || hasValidMiles || originParam || dropoffParam) {
      setFromLoadsInbox(true);
      if (hasValidPay) setLoadPay(pay);
      if (hasValidMiles) setLoadMiles(miles);
      if (originParam) setOrigin(originParam);
      if (dropoffParam) setDropOff(dropoffParam);
      
      if (hasValidPay && hasValidMiles) {
        toast({
          title: "Load Pre-filled",
          description: "Details loaded from Loads Inbox. Select your next destination and calculate!"
        });
      } else {
        toast({
          title: "Partial Data",
          description: "Some load details are missing. Please fill in the remaining fields.",
          variant: "destructive"
        });
      }
    }
  }, [window.location.search]);

  async function handleScreenshotUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setExtracting(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const res = await fetch("/api/extract-load-screenshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64 })
      });

      const data = await res.json();
      
      if (data.ok) {
        if (data.loadPay) setLoadPay(String(data.loadPay));
        if (data.loadMiles) setLoadMiles(String(data.loadMiles));
        if (data.origin) setOrigin(data.origin);
        if (data.destination) setDropOff(data.destination);
        
        toast({ 
          title: "Load Details Extracted!", 
          description: `Found: $${data.loadPay || '?'} | ${data.loadMiles || '?'} mi | ${data.origin || '?'} → ${data.destination || '?'}` 
        });
      } else {
        throw new Error(data.error || "Could not extract load details");
      }
    } catch (err: any) {
      toast({ title: "Extraction Failed", description: err?.message, variant: "destructive" });
    } finally {
      setExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function useMyLocation() {
    if (!navigator.geolocation) {
      toast({ title: "Not Supported", description: "GPS is not available on this device.", variant: "destructive" });
      return;
    }

    setGettingLocation(true);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
      });

      const { latitude, longitude } = position.coords;
      
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`,
        { headers: { 'User-Agent': 'TRAQ-IQ-Fleet-Management/1.0' } }
      );
      const data = await res.json();
      
      const city = data.address?.city || data.address?.town || data.address?.village || data.address?.county;
      const state = data.address?.state;
      
      if (city && state) {
        const stateAbbr = state.length > 2 ? state.substring(0, 2).toUpperCase() : state;
        const locationStr = `${city}, ${stateAbbr}`;
        setDropOff(locationStr);
        toast({ title: "Location Found", description: locationStr });
      } else {
        throw new Error("Could not determine your city");
      }
    } catch (err: any) {
      toast({ title: "Location Failed", description: err?.message || "Could not get your location", variant: "destructive" });
    } finally {
      setGettingLocation(false);
    }
  }

  function addSavedDestination() {
    if (!newDestName || !newDestCity) return;
    const newDest: SavedDestination = {
      id: `custom-${Date.now()}`,
      name: newDestName,
      city: newDestCity
    };
    setSavedDests([...savedDests, newDest]);
    setNewDestName("");
    setNewDestCity("");
    setShowAddDest(false);
    toast({ title: "Destination Saved", description: `${newDestName} added to quick picks` });
  }

  function removeSavedDestination(id: string) {
    setSavedDests(savedDests.filter(d => d.id !== id));
  }

  function loadFromHistory(calc: CalculationResult) {
    setLoadPay(String(calc.loadPay));
    setLoadMiles(String(calc.loadMiles));
    setOrigin(calc.origin);
    setDropOff(calc.dropOff);
    setResult(calc);
  }

  async function calculate() {
    if (!loadPay || !loadMiles || !dropOff) {
      toast({ title: "Missing Fields", description: "Enter pay, miles, and drop-off city.", variant: "destructive" });
      return;
    }

    const pay = parseFloat(loadPay);
    const miles = parseFloat(loadMiles);
    if (isNaN(pay) || isNaN(miles) || pay <= 0 || miles <= 0) {
      toast({ title: "Invalid Numbers", description: "Please enter valid pay and miles.", variant: "destructive" });
      return;
    }

    let nextDest = "";
    if (selectedDest === "custom") {
      nextDest = customDest;
    } else {
      const dest = savedDests.find(d => d.id === selectedDest);
      nextDest = dest?.city || "Ooltewah, TN";
    }

    if (!nextDest) {
      toast({ title: "Missing Destination", description: "Select or enter a destination.", variant: "destructive" });
      return;
    }

    setCalculating(true);
    setResult(null);

    try {
      const res = await fetch("/api/calculate-distance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin: dropOff, destination: nextDest })
      });

      const data = await res.json();
      
      if (!data.ok || !data.miles) {
        throw new Error(data.error || "Could not calculate distance");
      }

      const deadheadMiles = data.miles;
      const totalMiles = miles + deadheadMiles;
      const postedRpm = pay / miles;
      const trueRpm = pay / totalMiles;

      let grade: "green" | "yellow" | "red";
      let verdict: string;
      if (trueRpm >= 2.00) {
        grade = "green";
        verdict = "Profitable Load";
      } else if (trueRpm >= 1.60) {
        grade = "yellow";
        verdict = "Marginal - Proceed with Caution";
      } else {
        grade = "red";
        verdict = "Money Loser - Skip This Load";
      }

      const smartInfo = getSmartAdvice(trueRpm, nextDest);

      const newResult: CalculationResult = {
        loadPay: pay,
        loadMiles: miles,
        deadheadMiles,
        totalMiles,
        postedRpm,
        trueRpm,
        grade,
        verdict,
        origin: origin || "Unknown",
        dropOff,
        nextDest,
        smartAdvice: smartInfo.advice,
        timestamp: Date.now()
      };

      setResult(newResult);
      setRecentCalcs(prev => [newResult, ...prev.slice(0, 9)]);

    } catch (err: any) {
      toast({ title: "Calculation Failed", description: err?.message || "Could not calculate.", variant: "destructive" });
    } finally {
      setCalculating(false);
    }
  }

  function reset() {
    setResult(null);
    setLoadPay("");
    setLoadMiles("");
    setOrigin("");
    setDropOff("");
    setSelectedDest("base");
    setCustomDest("");
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      {fromLoadsInbox && (
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => setLocation("/loads-inbox")}
          className="mb-3 -ml-2"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Loads Inbox
        </Button>
      )}
      
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 md:p-3 bg-teal-500/20 rounded-lg">
          <Calculator className="w-6 h-6 md:w-8 md:h-8 text-teal-400" />
        </div>
        <div>
          <h1 className="text-xl md:text-2xl font-bold">True RPM Calculator</h1>
          <p className="text-sm text-muted-foreground">Real rate per mile including deadhead</p>
        </div>
      </div>

      <Card className="mb-4 border-dashed border-2 border-teal-500/50 bg-teal-500/5">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleScreenshotUpload}
              className="hidden"
            />
            <Button 
              onClick={() => fileInputRef.current?.click()}
              disabled={extracting}
              size="lg"
              className="flex-1 h-14 text-base bg-teal-600 hover:bg-teal-500"
            >
              {extracting ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Reading Screenshot...
                </>
              ) : (
                <>
                  <Camera className="w-5 h-5 mr-2" />
                  Upload Relay Screenshot
                </>
              )}
            </Button>
            <Button 
              onClick={useMyLocation}
              disabled={gettingLocation}
              size="lg"
              variant="outline"
              className="flex-1 h-14 text-base"
            >
              {gettingLocation ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Getting Location...
                </>
              ) : (
                <>
                  <Navigation className="w-5 h-5 mr-2" />
                  Use My Location
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Truck className="w-5 h-5" />
              Load Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-1">
                  <DollarSign className="w-3 h-3" /> Pay
                </Label>
                <Input
                  type="number"
                  placeholder="2500"
                  value={loadPay}
                  onChange={(e) => setLoadPay(e.target.value)}
                  className="h-12 text-lg font-bold"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-1">
                  <Route className="w-3 h-3" /> Miles
                </Label>
                <Input
                  type="number"
                  placeholder="850"
                  value={loadMiles}
                  onChange={(e) => setLoadMiles(e.target.value)}
                  className="h-12 text-lg font-bold"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1">
                <MapPin className="w-3 h-3 text-green-500" /> Pickup
              </Label>
              <Input
                placeholder="Maryville, TN"
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                className="h-11"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1">
                <MapPin className="w-3 h-3 text-red-500" /> Drop-off
              </Label>
              <Input
                placeholder="Cookeville, TN"
                value={dropOff}
                onChange={(e) => setDropOff(e.target.value)}
                className="h-11"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <Target className="w-5 h-5" />
                Next Move
              </span>
              <Button 
                size="sm" 
                variant="ghost" 
                onClick={() => setShowAddDest(!showAddDest)}
                className="h-7 px-2"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {showAddDest && (
              <div className="p-3 bg-muted rounded-lg space-y-2">
                <Input
                  placeholder="Name (e.g., Atlanta Hub)"
                  value={newDestName}
                  onChange={(e) => setNewDestName(e.target.value)}
                  className="h-9"
                />
                <Input
                  placeholder="City, State (e.g., Atlanta, GA)"
                  value={newDestCity}
                  onChange={(e) => setNewDestCity(e.target.value)}
                  className="h-9"
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={addSavedDestination} className="flex-1">
                    <Star className="w-4 h-4 mr-1" /> Save
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowAddDest(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              {savedDests.map(dest => (
                <Button
                  key={dest.id}
                  variant={selectedDest === dest.id ? "default" : "outline"}
                  onClick={() => setSelectedDest(dest.id)}
                  className={`h-12 flex flex-col items-start justify-center px-3 relative ${
                    selectedDest === dest.id ? "bg-teal-600" : ""
                  }`}
                >
                  <span className="font-medium text-xs truncate w-full text-left">{dest.name}</span>
                  <span className="text-xs opacity-70 truncate w-full text-left">{dest.city}</span>
                  {dest.id.startsWith("custom-") && (
                    <button
                      onClick={(e) => { e.stopPropagation(); removeSavedDestination(dest.id); }}
                      className="absolute top-1 right-1 p-0.5 hover:bg-red-500 rounded"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </Button>
              ))}
              <Button
                variant={selectedDest === "custom" ? "default" : "outline"}
                onClick={() => setSelectedDest("custom")}
                className={`h-12 ${selectedDest === "custom" ? "bg-teal-600" : ""}`}
              >
                <MapPin className="w-4 h-4 mr-1" />
                Custom
              </Button>
            </div>

            {selectedDest === "custom" && (
              <Input
                placeholder="Enter destination city..."
                value={customDest}
                onChange={(e) => setCustomDest(e.target.value)}
                className="h-11"
              />
            )}

            <Button 
              onClick={calculate} 
              disabled={calculating} 
              size="lg"
              className="w-full h-14 text-lg font-bold bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500"
            >
              {calculating ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Calculating...
                </>
              ) : (
                <>
                  <Zap className="w-5 h-5 mr-2" />
                  Calculate True RPM
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      {result && (
        <Card className="mt-4">
          <CardContent className="p-4">
            {result.smartAdvice && (
              <div className={`p-3 rounded-lg mb-4 flex items-center gap-2 ${
                result.smartAdvice.includes("MONEY MODE") ? "bg-blue-500/20 border border-blue-500" :
                result.smartAdvice.includes("GO HOME") ? "bg-orange-500/20 border border-orange-500" :
                "bg-purple-500/20 border border-purple-500"
              }`}>
                <Clock className="w-5 h-5 flex-shrink-0" />
                <span className="font-medium text-sm">{result.smartAdvice}</span>
              </div>
            )}

            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold">${result.loadPay}</div>
                <div className="text-xs text-muted-foreground">Pay</div>
              </div>
              <div>
                <div className="text-2xl font-bold">{result.loadMiles}</div>
                <div className="text-xs text-muted-foreground">Miles</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-orange-400">+{result.deadheadMiles}</div>
                <div className="text-xs text-muted-foreground">Deadhead</div>
              </div>
            </div>

            <div className={`mt-4 p-4 rounded-lg text-center border-2 ${
              result.grade === "green" ? "bg-green-500/10 border-green-500" :
              result.grade === "yellow" ? "bg-yellow-500/10 border-yellow-500" :
              "bg-red-500/10 border-red-500"
            }`}>
              <div className="flex items-center justify-center gap-2 mb-1">
                {result.grade === "green" && <CheckCircle className="w-6 h-6 text-green-500" />}
                {result.grade === "yellow" && <AlertTriangle className="w-6 h-6 text-yellow-500" />}
                {result.grade === "red" && <XCircle className="w-6 h-6 text-red-500" />}
                <Badge variant="outline" className="text-sm">{result.grade.toUpperCase()}</Badge>
              </div>
              <div className={`text-4xl font-bold ${
                result.grade === "green" ? "text-green-500" :
                result.grade === "yellow" ? "text-yellow-500" :
                "text-red-500"
              }`}>
                ${result.trueRpm.toFixed(2)}/mi
              </div>
              <div className="text-sm text-muted-foreground mt-1">TRUE RPM</div>
              <div className="text-sm font-medium mt-2">{result.verdict}</div>
            </div>

            <Button variant="outline" onClick={reset} className="w-full mt-4">
              New Calculation
            </Button>
          </CardContent>
        </Card>
      )}

      {recentCalcs.length > 0 && !result && (
        <Card className="mt-4">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="w-5 h-5" />
              Recent Calculations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recentCalcs.slice(0, 5).map((calc, i) => (
                <button
                  key={i}
                  onClick={() => loadFromHistory(calc)}
                  className="w-full p-3 rounded-lg bg-muted hover:bg-muted/80 flex items-center justify-between text-left"
                >
                  <div>
                    <div className="font-medium text-sm">{calc.origin} → {calc.dropOff}</div>
                    <div className="text-xs text-muted-foreground">${calc.loadPay} | {calc.loadMiles} mi</div>
                  </div>
                  <div className={`text-lg font-bold ${
                    calc.grade === "green" ? "text-green-500" :
                    calc.grade === "yellow" ? "text-yellow-500" :
                    "text-red-500"
                  }`}>
                    ${calc.trueRpm.toFixed(2)}
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
