import { useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { Truck, Trash2, ChartLine, Eye } from "lucide-react";
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
    <div className="min-h-screen bg-background text-foreground p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Truck className="w-8 h-8 text-primary" data-testid="icon-truck"/> 
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

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-primary font-bold flex items-center gap-2">
              <ChartLine className="w-5 h-5"/>
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
                <CardContent className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" stroke="hsl(var(--foreground))" tick={{fill:'hsl(var(--foreground))', fontWeight:600}}/>
                      <YAxis stroke="hsl(var(--foreground))" tick={{fill:'hsl(var(--foreground))'}}/>
                      <RTooltip 
                        formatter={(val:any) => currency0(Number(val)||0)} 
                        contentStyle={{background:'hsl(var(--card))', border:'1px solid hsl(var(--border))', color:'hsl(var(--foreground))', borderRadius: '8px'}}
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

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-card border-border hover:border-primary/30 transition-all" data-testid="card-revenue">
            <CardContent className="pt-6">
              <div className="text-sm text-muted-foreground font-semibold mb-2">Fleet Revenue (wk)</div>
              <div className="text-2xl font-bold text-primary">{currency0(fleet.revenue)}</div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border hover:border-destructive/30 transition-all" data-testid="card-expenses">
            <CardContent className="pt-6">
              <div className="text-sm text-muted-foreground font-semibold mb-2">Fleet Expenses (wk)</div>
              <div className="text-2xl font-bold text-destructive">{currency0(fleet.expenses)}</div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border hover:border-success/30 transition-all" data-testid="card-profit">
            <CardContent className="pt-6">
              <div className="text-sm text-muted-foreground font-semibold mb-2">Fleet Profit (wk)</div>
              <div className="text-2xl font-bold">
                {fleet.profit >= 0 ? (
                  <span className="text-success">+ {currency0(fleet.profit)}</span>
                ) : (
                  <span className="text-destructive">− {currency0(Math.abs(fleet.profit))}</span>
                )}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border hover:border-primary/30 transition-all" data-testid="card-breakeven">
            <CardContent className="pt-6">
              <div className="text-sm text-muted-foreground font-semibold mb-2">Avg Break-even RPM</div>
              <div className="text-2xl font-bold text-primary">{currency2(fleet.avgBreakEven)}/mi</div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="bg-card border-border p-6 flex flex-col items-center justify-center" data-testid="card-dispatch">
            <div className="text-sm font-semibold mb-2">Dispatch % (Global)</div>
            <Input 
              type="number" 
              step="0.01" 
              value={vars.dispatchPct * 100} 
              onChange={(e) => setVars({...vars, dispatchPct: Number(e.target.value) / 100})} 
              className="w-32 text-center bg-input border-border text-foreground"
              data-testid="input-dispatch-pct"
            />
            <div className="text-xs text-primary mt-2">This week: {currency0(fleet.revenue * vars.dispatchPct)}</div>
          </Card>
          <Card className="bg-card border-border p-6 flex flex-col items-center justify-center" data-testid="card-overhead">
            <div className="text-sm font-semibold mb-2">Overhead % (Global)</div>
            <Input 
              type="number" 
              step="0.01" 
              value={vars.overheadPct * 100} 
              onChange={(e) => setVars({...vars, overheadPct: Number(e.target.value) / 100})} 
              className="w-32 text-center bg-input border-border text-foreground"
              data-testid="input-overhead-pct"
            />
            <div className="text-xs text-destructive mt-2">This week: {currency0(fleet.revenue * vars.overheadPct)}</div>
          </Card>
        </div>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-primary flex items-center gap-2">
              <Truck className="w-5 h-5"/>
              Trucks (details)
            </CardTitle>
            <Button 
              onClick={addTruck} 
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
              data-testid="button-add-truck"
            >
              + Add Truck
            </Button>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-20 bg-card/95 backdrop-blur border-b border-primary/30">
                  <tr className="text-left text-foreground font-semibold">
                    <th className="p-3">Truck</th>
                    <th className="p-3">Driver</th>
                    <th className="p-3">Miles</th>
                    <th className="p-3">Rate/mi</th>
                    <th className="p-3">MPG</th>
                    <th className="p-3">Fuel ($)</th>
                    <th className="p-3">Driver Pay</th>
                    <th className="p-3">Driver %</th>
                    <th className="p-3">Lease ($)</th>
                    <th className="p-3">Insurance ($)</th>
                    <th className="p-3">Maint ($)</th>
                    <th className="p-3">Safety ($)</th>
                    <th className="p-3">Other ($)</th>
                    <th className="p-3">Dispatch ($)</th>
                    <th className="p-3">Overhead ($)</th>
                    <th className="p-3">Revenue</th>
                    <th className="p-3">Profit</th>
                    <th className="p-3">Margin</th>
                    <th className="p-3">Total Exp ($)</th>
                    <th className="p-3">Break-even $/mi</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({t, kpi}, i) => (
                    <tr 
                      key={t.id} 
                      className="border-b border-border hover:bg-muted/50 transition-all" 
                      data-testid={`row-truck-${i}`}
                    >
                      <td className="p-3">
                        <Input 
                          value={t.id} 
                          onChange={(e) => setTrucks(ts => ts.map((tt, idx) => idx === i ? {...tt, id: e.target.value} : tt))} 
                          className="h-9 w-32 bg-input border-border text-foreground"
                          data-testid={`input-truck-id-${i}`}
                        />
                      </td>
                      <td className="p-3">
                        <Input 
                          value={t.driver} 
                          onChange={(e) => setTrucks(ts => ts.map((tt, idx) => idx === i ? {...tt, driver: e.target.value} : tt))} 
                          className="h-9 w-40 bg-input border-border text-foreground"
                          data-testid={`input-driver-${i}`}
                        />
                      </td>
                      <td className="p-3">
                        <Input 
                          type="number" 
                          value={t.miles} 
                          onChange={(e) => setTrucks(ts => ts.map((tt, idx) => idx === i ? {...tt, miles: Number(e.target.value)} : tt))} 
                          className="h-9 w-28 bg-input border-border text-foreground text-right"
                          data-testid={`input-miles-${i}`}
                        />
                      </td>
                      <td className="p-3">
                        <Input 
                          type="number" 
                          step="0.01" 
                          value={t.rate} 
                          onChange={(e) => setTrucks(ts => ts.map((tt, idx) => idx === i ? {...tt, rate: Number(e.target.value)} : tt))} 
                          className="h-9 w-24 bg-input border-border text-foreground text-right"
                          data-testid={`input-rate-${i}`}
                        />
                      </td>
                      <td className="p-3">
                        <Input 
                          type="number" 
                          step="0.1" 
                          value={t.mpg} 
                          onChange={(e) => setTrucks(ts => ts.map((tt, idx) => idx === i ? {...tt, mpg: Number(e.target.value)} : tt))} 
                          className="h-9 w-20 bg-input border-border text-foreground text-right"
                          data-testid={`input-mpg-${i}`}
                        />
                      </td>
                      <td className="p-3 text-right text-destructive font-medium" data-testid={`text-fuel-cost-${i}`}>
                        {currency0(kpi.fuelCost)}
                      </td>
                      <td className="p-3">
                        <Input 
                          type="number" 
                          value={t.driverPay} 
                          onChange={(e) => setTrucks(ts => ts.map((tt, idx) => idx === i ? {...tt, driverPay: Number(e.target.value)} : tt))} 
                          className="h-9 w-28 bg-input border-border text-foreground text-right"
                          data-testid={`input-driver-pay-${i}`}
                        />
                      </td>
                      <td className="p-3">
                        <Input 
                          type="number" 
                          value={t.driverPercent} 
                          onChange={(e) => setTrucks(ts => ts.map((tt, idx) => idx === i ? {...tt, driverPercent: Number(e.target.value)} : tt))} 
                          className="h-9 w-20 bg-input border-border text-foreground text-right"
                          data-testid={`input-driver-percent-${i}`}
                        />
                      </td>
                      <td className="p-3">
                        <Input 
                          type="number" 
                          value={t.lease} 
                          onChange={(e) => setTrucks(ts => ts.map((tt, idx) => idx === i ? {...tt, lease: Number(e.target.value)} : tt))} 
                          className="h-9 w-28 bg-input border-border text-foreground text-right"
                          data-testid={`input-lease-${i}`}
                        />
                      </td>
                      <td className="p-3">
                        <Input 
                          type="number" 
                          value={t.insurance} 
                          onChange={(e) => setTrucks(ts => ts.map((tt, idx) => idx === i ? {...tt, insurance: Number(e.target.value)} : tt))} 
                          className="h-9 w-28 bg-input border-border text-foreground text-right"
                          data-testid={`input-insurance-${i}`}
                        />
                      </td>
                      <td className="p-3">
                        <Input 
                          type="number" 
                          value={t.maintReserve} 
                          onChange={(e) => setTrucks(ts => ts.map((tt, idx) => idx === i ? {...tt, maintReserve: Number(e.target.value)} : tt))} 
                          className="h-9 w-24 bg-input border-border text-foreground text-right"
                          data-testid={`input-maint-${i}`}
                        />
                      </td>
                      <td className="p-3">
                        <Input 
                          type="number" 
                          value={t.safetyReserve} 
                          onChange={(e) => setTrucks(ts => ts.map((tt, idx) => idx === i ? {...tt, safetyReserve: Number(e.target.value)} : tt))} 
                          className="h-9 w-24 bg-input border-border text-foreground text-right"
                          data-testid={`input-safety-${i}`}
                        />
                      </td>
                      <td className="p-3">
                        <Input 
                          type="number" 
                          value={t.otherOpEx} 
                          onChange={(e) => setTrucks(ts => ts.map((tt, idx) => idx === i ? {...tt, otherOpEx: Number(e.target.value)} : tt))} 
                          className="h-9 w-24 bg-input border-border text-foreground text-right"
                          data-testid={`input-other-${i}`}
                        />
                      </td>
                      <td className="p-3 text-right text-destructive font-medium" data-testid={`text-dispatch-fee-${i}`}>
                        {currency0(kpi.dispatchFee)}
                      </td>
                      <td className="p-3 text-right text-destructive font-medium" data-testid={`text-overhead-fee-${i}`}>
                        {currency0(kpi.overheadFee)}
                      </td>
                      {!driverView && (
                        <td className="p-3 text-right text-primary font-semibold" data-testid={`text-revenue-${i}`}>
                          {currency0(kpi.revenue)}
                        </td>
                      )}
                      {!driverView && (
                        <td className="p-3 text-right font-bold" data-testid={`text-profit-${i}`}>
                          {kpi.profit >= 0 ? (
                            <span className="text-success">{currency0(kpi.profit)}</span>
                          ) : (
                            <span className="text-destructive">-{currency0(Math.abs(kpi.profit))}</span>
                          )}
                        </td>
                      )}
                      {!driverView && (
                        <td className="p-3 text-muted-foreground" data-testid={`text-margin-${i}`}>
                          {pct(kpi.margin)}
                        </td>
                      )}
                      <td className="p-3 text-right font-medium text-destructive" data-testid={`text-expenses-${i}`}>
                        {currency0(kpi.expenses)}
                      </td>
                      <td className="p-3 text-right text-primary font-medium" data-testid={`text-breakeven-${i}`}>
                        {currency2(kpi.breakEvenRPM)}
                      </td>
                      <td className="p-3 text-right">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => removeTruck(i)} 
                          className="hover:bg-destructive/10 hover:text-destructive"
                          data-testid={`button-delete-truck-${i}`}
                        >
                          <Trash2 className="w-4 h-4"/>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <div className="sticky bottom-0 left-0 right-0 bg-card/95 backdrop-blur border-t border-primary/30 px-6 py-4 flex flex-wrap items-center gap-6 rounded-lg">
          <div className="text-sm text-muted-foreground">
            Trucks: <span className="font-semibold text-primary">{trucks.length}</span>
          </div>
          <div className="text-sm text-muted-foreground">
            Driver Pay (wk): <span className="font-semibold text-primary">{currency0(rows.reduce((s, r) => s + r.kpi.driverPay, 0))}</span>
          </div>
          <div className="text-sm text-muted-foreground">
            Dispatch (wk): <span className="font-semibold text-destructive">{currency0(rows.reduce((s, r) => s + r.kpi.dispatchFee, 0))}</span>
          </div>
          <div className="text-sm text-muted-foreground">
            Overhead (wk): <span className="font-semibold text-destructive">{currency0(rows.reduce((s, r) => s + r.kpi.overheadFee, 0))}</span>
          </div>
          <div className="ml-auto text-sm text-muted-foreground">
            Fleet Profit (wk): {fleet.profit >= 0 ? (
              <span className="font-bold text-success text-lg">+ {currency0(fleet.profit)}</span>
            ) : (
              <span className="font-bold text-destructive text-lg">− {currency0(Math.abs(fleet.profit))}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
