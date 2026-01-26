import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Calculator, Truck, MapPin, DollarSign, Route, Target, Loader2, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
}

export default function TrueRPMCalculator() {
  const { toast } = useToast();
  const [calculating, setCalculating] = useState(false);
  const [result, setResult] = useState<CalculationResult | null>(null);

  const [loadPay, setLoadPay] = useState("");
  const [loadMiles, setLoadMiles] = useState("");
  const [origin, setOrigin] = useState("");
  const [dropOff, setDropOff] = useState("");
  const [strategy, setStrategy] = useState("base");
  const [customDest, setCustomDest] = useState("");

  async function calculate() {
    if (!loadPay || !loadMiles || !origin || !dropOff) {
      toast({ title: "Missing Fields", description: "Please fill in all required fields.", variant: "destructive" });
      return;
    }

    const pay = parseFloat(loadPay);
    const miles = parseFloat(loadMiles);
    if (isNaN(pay) || isNaN(miles) || pay <= 0 || miles <= 0) {
      toast({ title: "Invalid Numbers", description: "Please enter valid pay and miles.", variant: "destructive" });
      return;
    }

    let nextDest = "";
    if (strategy === "base") {
      nextDest = "Ooltewah, TN";
    } else if (strategy === "hub") {
      nextDest = "Nashville, TN";
    } else {
      nextDest = customDest;
    }

    if (!nextDest) {
      toast({ title: "Missing Destination", description: "Please enter a custom destination.", variant: "destructive" });
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

      setResult({
        loadPay: pay,
        loadMiles: miles,
        deadheadMiles,
        totalMiles,
        postedRpm,
        trueRpm,
        grade,
        verdict,
        origin,
        dropOff,
        nextDest
      });

    } catch (err: any) {
      toast({ title: "Calculation Failed", description: err?.message || "Could not calculate deadhead distance.", variant: "destructive" });
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
    setStrategy("base");
    setCustomDest("");
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-3 bg-teal-500/20 rounded-lg">
          <Calculator className="w-8 h-8 text-teal-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">True RPM Calculator</h1>
          <p className="text-muted-foreground">Calculate your real rate per mile including deadhead</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Truck className="w-5 h-5" />
              Load Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="pay" className="flex items-center gap-1">
                  <DollarSign className="w-4 h-4" /> Load Pay
                </Label>
                <Input
                  id="pay"
                  type="number"
                  placeholder="2500"
                  value={loadPay}
                  onChange={(e) => setLoadPay(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="miles" className="flex items-center gap-1">
                  <Route className="w-4 h-4" /> Load Miles
                </Label>
                <Input
                  id="miles"
                  type="number"
                  placeholder="850"
                  value={loadMiles}
                  onChange={(e) => setLoadMiles(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="origin" className="flex items-center gap-1">
                <MapPin className="w-4 h-4 text-green-500" /> Pickup City
              </Label>
              <Input
                id="origin"
                placeholder="Maryville, TN"
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="dropoff" className="flex items-center gap-1">
                <MapPin className="w-4 h-4 text-red-500" /> Drop-off City
              </Label>
              <Input
                id="dropoff"
                placeholder="Cookeville, TN"
                value={dropOff}
                onChange={(e) => setDropOff(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="w-5 h-5" />
              Next Move Strategy
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <RadioGroup value={strategy} onValueChange={setStrategy}>
              <div className="flex items-center space-x-2 p-3 border rounded-lg hover:bg-accent/50 cursor-pointer">
                <RadioGroupItem value="base" id="base" />
                <Label htmlFor="base" className="flex-1 cursor-pointer">
                  <span className="font-medium">Return to Base</span>
                  <span className="text-muted-foreground text-sm block">Ooltewah, TN</span>
                </Label>
              </div>
              <div className="flex items-center space-x-2 p-3 border rounded-lg hover:bg-accent/50 cursor-pointer">
                <RadioGroupItem value="hub" id="hub" />
                <Label htmlFor="hub" className="flex-1 cursor-pointer">
                  <span className="font-medium">Chase Hub</span>
                  <span className="text-muted-foreground text-sm block">Nashville, TN</span>
                </Label>
              </div>
              <div className="flex items-center space-x-2 p-3 border rounded-lg hover:bg-accent/50 cursor-pointer">
                <RadioGroupItem value="custom" id="custom" />
                <Label htmlFor="custom" className="flex-1 cursor-pointer">
                  <span className="font-medium">Custom Destination</span>
                </Label>
              </div>
            </RadioGroup>

            {strategy === "custom" && (
              <Input
                placeholder="Enter next destination..."
                value={customDest}
                onChange={(e) => setCustomDest(e.target.value)}
              />
            )}

            <div className="flex gap-2 pt-4">
              <Button onClick={calculate} disabled={calculating} className="flex-1">
                {calculating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Calculating...
                  </>
                ) : (
                  <>
                    <Calculator className="w-4 h-4 mr-2" />
                    Calculate True RPM
                  </>
                )}
              </Button>
              {result && (
                <Button variant="outline" onClick={reset}>
                  Reset
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {result && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5" />
              Load Analysis: {result.origin} → {result.dropOff}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-6">
              <div className="space-y-3">
                <h3 className="font-semibold text-muted-foreground">Posted Stats</h3>
                <div className="flex justify-between">
                  <span>Posted Pay:</span>
                  <span className="font-bold">${result.loadPay.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Posted Miles:</span>
                  <span className="font-bold">{result.loadMiles} mi</span>
                </div>
                <div className="flex justify-between">
                  <span>Posted RPM:</span>
                  <span className="font-bold text-blue-400">${result.postedRpm.toFixed(2)}/mi</span>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold text-muted-foreground">Deadhead Details</h3>
                <div className="flex justify-between">
                  <span>Next Move:</span>
                  <span className="font-medium text-sm">{result.nextDest}</span>
                </div>
                <div className="flex justify-between">
                  <span>Deadhead Miles:</span>
                  <span className="font-bold text-orange-400">~{result.deadheadMiles} mi</span>
                </div>
                <div className="flex justify-between">
                  <span>Total Trip Miles:</span>
                  <span className="font-bold">{result.totalMiles.toFixed(0)} mi</span>
                </div>
              </div>

              <div className={`p-4 rounded-lg border-2 ${
                result.grade === "green" ? "bg-green-500/10 border-green-500" :
                result.grade === "yellow" ? "bg-yellow-500/10 border-yellow-500" :
                "bg-red-500/10 border-red-500"
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  {result.grade === "green" && <CheckCircle className="w-6 h-6 text-green-500" />}
                  {result.grade === "yellow" && <AlertTriangle className="w-6 h-6 text-yellow-500" />}
                  {result.grade === "red" && <XCircle className="w-6 h-6 text-red-500" />}
                  <span className="font-semibold uppercase">{result.grade}</span>
                </div>
                <div className={`text-3xl font-bold ${
                  result.grade === "green" ? "text-green-500" :
                  result.grade === "yellow" ? "text-yellow-500" :
                  "text-red-500"
                }`}>
                  ${result.trueRpm.toFixed(2)}/mi
                </div>
                <div className="text-sm mt-1 text-muted-foreground">TRUE RPM</div>
                <div className="mt-3 pt-3 border-t text-sm font-medium">
                  {result.verdict}
                </div>
              </div>
            </div>

            <div className="mt-6 p-4 bg-muted/50 rounded-lg text-sm">
              <strong>How it works:</strong> True RPM includes the deadhead miles you'll drive after drop-off to reach your next destination. 
              This gives you a realistic picture of your actual earnings per mile driven.
              <br /><br />
              <strong>Thresholds:</strong> 🟢 Green ≥ $2.00/mi | 🟡 Yellow ≥ $1.60/mi | 🔴 Red &lt; $1.60/mi
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
