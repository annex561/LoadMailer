import { useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { Truck, Trash2, ChartLine, Eye, DollarSign, AlertCircle, TrendingUp, Percent, Edit } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend } from "recharts";
import { motion, AnimatePresence } from "framer-motion";

const currency0 = (n:number) => (Number.isFinite(n)?n:0).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:0});
const currency2 = (n:number) => (Number.isFinite(n)?n:0).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});
const pct = (n:number) => `${((Number.isFinite(n)?n:0)*100).toFixed(2)}%`;

const DEFAULTS = {
  ratePerMile: 1.30,
  milesPerWeek: 3200,
  fuelPrice: 4.0,
  mpg: 9.0,
  driverPay: 1000,
  driverPayType: 'flat' as 'flat'|'perMile'|'percentage',
  lease: 1800,
  insurance: 700,
  maintReserve: 75,
  safetyReserve: 200,
  otherOpEx: 0,
  dispatchPct: 0.10,
  overheadPct: 0.15,
};

const newTruck = (i:number, v=DEFAULTS) => ({
  id: `Truck ${i+1}`,
  driver: '',
  miles: v.milesPerWeek,
  rate: v.ratePerMile,
  mpg: v.mpg,
  fuelPrice: v.fuelPrice,
  driverPayType: v.driverPayType,
  driverPay: v.driverPay,
  driverPercent: 25,
  lease: v.lease,
  insurance: v.insurance,
  maintReserve: v.maintReserve,
  safetyReserve: v.safetyReserve,
  otherOpEx: v.otherOpEx,
});

type Vars = typeof DEFAULTS;
type TruckRow = ReturnType<typeof newTruck>;
type Kpis = { revenue:number; fuelCost:number; driverPay:number; dispatchFee:number; overheadFee:number; expenses:number; profit:number; margin:number; breakEvenRPM:number };

function computeTruck(t:TruckRow, v:Vars):Kpis{
  const miles=Number(t.miles)||0, rate=Number(t.rate)||0, mpg=Number(t.mpg)||0, fuelPrice=Number(t.fuelPrice)||0;
  const revenue = miles*rate;
  const fuelCost = mpg>0 ? (miles/mpg)*fuelPrice : 0;
  let driverPay = 0;
  if(t.driverPayType==='flat') driverPay = Number(t.driverPay)||0;
  else if(t.driverPayType==='perMile') driverPay = (Number(t.driverPay)||0)*miles;
  else if(t.driverPayType==='percentage') driverPay = revenue * ((Number(t.driverPercent??25))/100);
  const dispatchFee = revenue * v.dispatchPct;
  const overheadFee = revenue * v.overheadPct;
  const expenses = fuelCost + driverPay + (Number(t.lease)||0) + (Number(t.insurance)||0) + (Number(t.maintReserve)||0) + (Number(t.safetyReserve)||0) + (Number(t.otherOpEx)||0) + dispatchFee + overheadFee;
  const profit = revenue - expenses;
  const margin = revenue>0 ? profit/revenue : 0;
  const breakEvenRPM = miles>0 ? expenses/miles : 0;
  return { revenue, fuelCost, driverPay, dispatchFee, overheadFee, expenses, profit, margin, breakEvenRPM };
}

export default function FleetCalculator() {
  const [vars, setVars] = useState<Vars>(() => {
    try {
      const d = Number(localStorage.getItem("traqiq_dispatchPct"));
      const o = Number(localStorage.getItem("traqiq_overheadPct"));
      return {
        ...DEFAULTS,
        dispatchPct: Number.isFinite(d) && d >= 0 ? d : DEFAULTS.dispatchPct,
        overheadPct: Number.isFinite(o) && o >= 0 ? o : DEFAULTS.overheadPct,
      };
    } catch {
      return DEFAULTS;
    }
  });

  useEffect(()=>{
    localStorage.setItem("traqiq_dispatchPct", String(vars.dispatchPct));
    localStorage.setItem("traqiq_overheadPct", String(vars.overheadPct));
  }, [vars.dispatchPct, vars.overheadPct]);

  const [trucks, setTrucks] = useState<TruckRow[]>([newTruck(0), newTruck(1)]);
  const [driverView, setDriverView] = useState(false);
  const [showChart, setShowChart] = useState(true);

  const rows = useMemo(() => trucks.map(t => ({ t, kpi: computeTruck(t, vars) })), [trucks, vars]);
  const fleet = useMemo(() => {
    const revenue = rows.reduce((s, r) => s + r.kpi.revenue, 0);
    const expenses = rows.reduce((s, r) => s + r.kpi.expenses, 0);
    const profit = revenue - expenses;
    const avgBreakEven = rows.length ? rows.reduce((s, r) => s + r.kpi.breakEvenRPM, 0) / rows.length : 0;
    return { revenue, expenses, profit, avgBreakEven };
  }, [rows]);

  const chartData = [
    { name: 'Revenue', value: Math.round(fleet.revenue) },
    { name: 'Expenses', value: Math.round(fleet.expenses) },
    { name: 'Profit', value: Math.round(fleet.profit) },
  ];

  const removeTruck = (i:number) => setTrucks(ts => ts.filter((_,idx)=>idx!==i));
  const addTruck = () => setTrucks(ts => [...ts, newTruck(ts.length)]);

  return (
    <div className="min-h-screen bg-background text-foreground p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="bg-card border border-border rounded-xl shadow-md p-6 flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Fleet Profit Calculator
          </h1>
          <Button 
            variant="secondary" 
            className={driverView ? "bg-secondary hover:bg-secondary/80" : "bg-primary hover:bg-primary/90"}
            onClick={() => setDriverView(v => !v)}
            data-testid="button-toggle-view"
          >
            <Eye className="w-4 h-4 mr-2"/>
            {driverView ? "Switch to Manager" : "Switch to Driver"}
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <Card className="bg-card border border-border rounded-xl shadow-md p-6 hover:shadow-lg transition-shadow" data-testid="card-revenue">
            <div className="flex items-start justify-between mb-3">
              <DollarSign className="w-8 h-8 text-success" />
            </div>
            <div className="text-sm text-muted-foreground mb-2">Fleet Revenue (wk)</div>
            <div className="text-4xl font-bold text-foreground">{currency0(fleet.revenue)}</div>
          </Card>
          <Card className="bg-card border border-border rounded-xl shadow-md p-6 hover:shadow-lg transition-shadow" data-testid="card-expenses">
            <div className="flex items-start justify-between mb-3">
              <AlertCircle className="w-8 h-8 text-destructive" />
            </div>
            <div className="text-sm text-muted-foreground mb-2">Fleet Expenses (wk)</div>
            <div className="text-4xl font-bold text-foreground">{currency0(fleet.expenses)}</div>
          </Card>
          <Card className="bg-card border border-border rounded-xl shadow-md p-6 hover:shadow-lg transition-shadow" data-testid="card-profit">
            <div className="flex items-start justify-between mb-3">
              <TrendingUp className="w-8 h-8 text-primary" />
            </div>
            <div className="text-sm text-muted-foreground mb-2">Fleet Profit (wk)</div>
            <div className="text-4xl font-bold">
              {fleet.profit >= 0 ? (
                <span className="text-success">{currency0(fleet.profit)}</span>
              ) : (
                <span className="text-destructive">{currency0(Math.abs(fleet.profit))}</span>
              )}
            </div>
          </Card>
          <Card className="bg-card border border-border rounded-xl shadow-md p-6 hover:shadow-lg transition-shadow" data-testid="card-margin">
            <div className="flex items-start justify-between mb-3">
              <Percent className="w-8 h-8 text-purple-500" />
            </div>
            <div className="text-sm text-muted-foreground mb-2">Profit Margin</div>
            <div className="text-4xl font-bold text-foreground">
              {pct(fleet.revenue > 0 ? fleet.profit / fleet.revenue : 0)}
            </div>
          </Card>
        </div>

        <Card className="bg-card border border-border rounded-xl shadow-md">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-foreground font-bold flex items-center gap-2">
              <ChartLine className="w-5 h-5 text-primary"/>
              Revenue vs Expenses vs Profit
            </CardTitle>
            <Button 
              variant="ghost" 
              className="text-foreground hover:text-primary" 
              onClick={() => setShowChart(s => !s)}
              data-testid="button-toggle-chart"
            >
              {showChart ? "Hide Chart" : "Show Chart"}
            </Button>
          </CardHeader>
          <AnimatePresence>
            {showChart && (
              <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration:0.25}}>
                <CardContent className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" stroke="hsl(var(--foreground))" tick={{fill:'hsl(var(--foreground))', fontWeight:600}}/>
                      <YAxis stroke="hsl(var(--foreground))" tick={{fill:'hsl(var(--foreground))'}}/>
                      <RTooltip 
                        formatter={(val:any) => currency0(Number(val)||0)} 
                        contentStyle={{background:'hsl(var(--card))', border:'1px solid hsl(var(--border))', color:'hsl(var(--foreground))', borderRadius: '12px'}}
                      />
                      <Legend wrapperStyle={{color:'hsl(var(--primary))', fontWeight:600}}/>
                      <Bar dataKey="value" name="Amount (USD)" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]}/>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="bg-card border border-border rounded-xl shadow-md p-6" data-testid="card-dispatch">
            <div className="text-sm font-semibold text-foreground mb-3">Dispatch % (Global)</div>
            <Input 
              type="number" 
              step="0.01" 
              value={vars.dispatchPct * 100} 
              onChange={(e) => setVars({...vars, dispatchPct: Number(e.target.value) / 100})} 
              className="w-full text-center bg-input border-border text-foreground mb-2"
              data-testid="input-dispatch-pct"
            />
            <div className="text-xs text-muted-foreground">This week: <span className="font-semibold text-primary">{currency0(fleet.revenue * vars.dispatchPct)}</span></div>
          </Card>
          <Card className="bg-card border border-border rounded-xl shadow-md p-6" data-testid="card-overhead">
            <div className="text-sm font-semibold text-foreground mb-3">Overhead % (Global)</div>
            <Input 
              type="number" 
              step="0.01" 
              value={vars.overheadPct * 100} 
              onChange={(e) => setVars({...vars, overheadPct: Number(e.target.value) / 100})} 
              className="w-full text-center bg-input border-border text-foreground mb-2"
              data-testid="input-overhead-pct"
            />
            <div className="text-xs text-muted-foreground">This week: <span className="font-semibold text-destructive">{currency0(fleet.revenue * vars.overheadPct)}</span></div>
          </Card>
        </div>

        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Truck className="w-6 h-6 text-primary"/>
            Trucks
          </h2>
          <Button 
            onClick={addTruck} 
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
            data-testid="button-add-truck"
          >
            + Add Truck
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-6">
          {rows.map(({t, kpi}, i) => (
            <Card 
              key={t.id} 
              className="bg-card border border-border rounded-xl shadow-md p-6 hover:shadow-lg transition-shadow"
              data-testid={`card-truck-${i}`}
            >
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-center gap-3">
                  <Truck className="w-8 h-8 text-primary" />
                  <div>
                    <Input 
                      value={t.id} 
                      onChange={(e) => setTrucks(ts => ts.map((tt, idx) => idx === i ? {...tt, id: e.target.value} : tt))} 
                      className="text-lg font-bold bg-transparent border-none p-0 h-auto focus-visible:ring-0 text-foreground"
                      data-testid={`input-truck-id-${i}`}
                    />
                    <Input 
                      value={t.driver} 
                      placeholder="Driver name"
                      onChange={(e) => setTrucks(ts => ts.map((tt, idx) => idx === i ? {...tt, driver: e.target.value} : tt))} 
                      className="text-sm bg-transparent border-none p-0 h-auto focus-visible:ring-0 text-muted-foreground mt-1"
                      data-testid={`input-driver-${i}`}
                    />
                  </div>
                </div>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={() => removeTruck(i)} 
                  className="hover:bg-destructive/10 hover:text-destructive"
                  data-testid={`button-delete-truck-${i}`}
                >
                  <Trash2 className="w-5 h-5"/>
                </Button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Weekly Miles</label>
                  <Input 
                    type="number" 
                    value={t.miles} 
                    onChange={(e) => setTrucks(ts => ts.map((tt, idx) => idx === i ? {...tt, miles: Number(e.target.value)} : tt))} 
                    className="bg-input border-border text-foreground"
                    data-testid={`input-miles-${i}`}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Rate/Mile ($)</label>
                  <Input 
                    type="number" 
                    step="0.01" 
                    value={t.rate} 
                    onChange={(e) => setTrucks(ts => ts.map((tt, idx) => idx === i ? {...tt, rate: Number(e.target.value)} : tt))} 
                    className="bg-input border-border text-foreground"
                    data-testid={`input-rate-${i}`}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">MPG</label>
                  <Input 
                    type="number" 
                    step="0.1" 
                    value={t.mpg} 
                    onChange={(e) => setTrucks(ts => ts.map((tt, idx) => idx === i ? {...tt, mpg: Number(e.target.value)} : tt))} 
                    className="bg-input border-border text-foreground"
                    data-testid={`input-mpg-${i}`}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Fuel Price ($)</label>
                  <Input 
                    type="number" 
                    step="0.01" 
                    value={t.fuelPrice} 
                    onChange={(e) => setTrucks(ts => ts.map((tt, idx) => idx === i ? {...tt, fuelPrice: Number(e.target.value)} : tt))} 
                    className="bg-input border-border text-foreground"
                    data-testid={`input-fuel-price-${i}`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Driver Pay ($)</label>
                  <Input 
                    type="number" 
                    value={t.driverPay} 
                    onChange={(e) => setTrucks(ts => ts.map((tt, idx) => idx === i ? {...tt, driverPay: Number(e.target.value)} : tt))} 
                    className="bg-input border-border text-foreground"
                    data-testid={`input-driver-pay-${i}`}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Driver %</label>
                  <Input 
                    type="number" 
                    value={t.driverPercent} 
                    onChange={(e) => setTrucks(ts => ts.map((tt, idx) => idx === i ? {...tt, driverPercent: Number(e.target.value)} : tt))} 
                    className="bg-input border-border text-foreground"
                    data-testid={`input-driver-percent-${i}`}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Lease ($)</label>
                  <Input 
                    type="number" 
                    value={t.lease} 
                    onChange={(e) => setTrucks(ts => ts.map((tt, idx) => idx === i ? {...tt, lease: Number(e.target.value)} : tt))} 
                    className="bg-input border-border text-foreground"
                    data-testid={`input-lease-${i}`}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Insurance ($)</label>
                  <Input 
                    type="number" 
                    value={t.insurance} 
                    onChange={(e) => setTrucks(ts => ts.map((tt, idx) => idx === i ? {...tt, insurance: Number(e.target.value)} : tt))} 
                    className="bg-input border-border text-foreground"
                    data-testid={`input-insurance-${i}`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Maintenance ($)</label>
                  <Input 
                    type="number" 
                    value={t.maintReserve} 
                    onChange={(e) => setTrucks(ts => ts.map((tt, idx) => idx === i ? {...tt, maintReserve: Number(e.target.value)} : tt))} 
                    className="bg-input border-border text-foreground"
                    data-testid={`input-maint-${i}`}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Safety ($)</label>
                  <Input 
                    type="number" 
                    value={t.safetyReserve} 
                    onChange={(e) => setTrucks(ts => ts.map((tt, idx) => idx === i ? {...tt, safetyReserve: Number(e.target.value)} : tt))} 
                    className="bg-input border-border text-foreground"
                    data-testid={`input-safety-${i}`}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Other OpEx ($)</label>
                  <Input 
                    type="number" 
                    value={t.otherOpEx} 
                    onChange={(e) => setTrucks(ts => ts.map((tt, idx) => idx === i ? {...tt, otherOpEx: Number(e.target.value)} : tt))} 
                    className="bg-input border-border text-foreground"
                    data-testid={`input-other-${i}`}
                  />
                </div>
              </div>

              <div className="border-t border-border pt-4">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Revenue</div>
                    <div className="text-lg font-bold text-success" data-testid={`text-revenue-${i}`}>{currency0(kpi.revenue)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Expenses</div>
                    <div className="text-lg font-bold text-destructive" data-testid={`text-expenses-${i}`}>{currency0(kpi.expenses)}</div>
                  </div>
                  {!driverView && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Profit</div>
                      <div className="text-lg font-bold" data-testid={`text-profit-${i}`}>
                        {kpi.profit >= 0 ? (
                          <span className="text-success">{currency0(kpi.profit)}</span>
                        ) : (
                          <span className="text-destructive">{currency0(Math.abs(kpi.profit))}</span>
                        )}
                      </div>
                    </div>
                  )}
                  {!driverView && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Margin</div>
                      <div className="text-lg font-bold text-foreground" data-testid={`text-margin-${i}`}>{pct(kpi.margin)}</div>
                    </div>
                  )}
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Break-even</div>
                    <div className="text-lg font-bold text-primary" data-testid={`text-breakeven-${i}`}>{currency2(kpi.breakEvenRPM)}/mi</div>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>

        <Card className="bg-card border border-border rounded-xl shadow-md p-6 sticky bottom-6">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Total Trucks</div>
              <div className="text-2xl font-bold text-primary">{trucks.length}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Driver Pay (wk)</div>
              <div className="text-2xl font-bold text-foreground">{currency0(rows.reduce((s, r) => s + r.kpi.driverPay, 0))}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Dispatch (wk)</div>
              <div className="text-2xl font-bold text-destructive">{currency0(rows.reduce((s, r) => s + r.kpi.dispatchFee, 0))}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Overhead (wk)</div>
              <div className="text-2xl font-bold text-destructive">{currency0(rows.reduce((s, r) => s + r.kpi.overheadFee, 0))}</div>
            </div>
            <div className="ml-auto">
              <div className="text-xs text-muted-foreground mb-1">Fleet Profit (wk)</div>
              <div className="text-3xl font-bold">
                {fleet.profit >= 0 ? (
                  <span className="text-success">{currency0(fleet.profit)}</span>
                ) : (
                  <span className="text-destructive">{currency0(Math.abs(fleet.profit))}</span>
                )}
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
