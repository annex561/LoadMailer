import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

interface SettlementLine {
  loadId: string;
  loadNumber: string;
  deliveredAt: string | null;
  rate: number;
  miles: number;
  pay: number;
  origin: string;
  destination: string;
}

interface DriverSettlement {
  driverId: string;
  driverName: string;
  payType: string;
  payRate: number;
  weekStart: string;
  weekEnd: string;
  loadCount: number;
  totalRevenue: number;
  totalPay: number;
  lines: SettlementLine[];
}

interface SettlementsResponse {
  ok: boolean;
  weekStart: string;
  weekEnd: string;
  driverCount: number;
  totalPay: number;
  totalRevenue: number;
  settlements: DriverSettlement[];
}

function todayYMD(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftWeek(ymd: string, deltaDays: number): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function currency(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

function payRuleLabel(s: DriverSettlement): string {
  if (s.payType === "percent") return `${s.payRate}% of rate`;
  if (s.payType === "per_mile") return `$${s.payRate}/mi`;
  return `$${s.payRate}/load`;
}

export default function Settlements() {
  const [weekRef, setWeekRef] = useState<string>(todayYMD());
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery<SettlementsResponse>({
    queryKey: ["/api/settlements", weekRef],
    queryFn: async () => {
      const res = await fetch(`/api/settlements?weekStart=${weekRef}`);
      return res.json();
    },
  });

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Driver Settlements</h1>
          <p className="text-sm text-muted-foreground">
            Weekly pay computed from delivered loads.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWeekRef(shiftWeek(weekRef, -7))}
          >
            ← Prev week
          </Button>
          <Input
            type="date"
            className="w-40"
            value={weekRef}
            onChange={(e) => setWeekRef(e.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWeekRef(shiftWeek(weekRef, 7))}
          >
            Next week →
          </Button>
          <Button variant="outline" size="sm" onClick={() => setWeekRef(todayYMD())}>
            This week
          </Button>
          <Button size="sm" onClick={() => refetch()}>
            Refresh
          </Button>
        </div>
      </div>

      {isLoading && <div>Loading settlements…</div>}

      {data && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>
                Week of {data.weekStart} — {data.weekEnd}
              </CardTitle>
              <CardDescription>
                {data.driverCount} drivers · Revenue {currency(data.totalRevenue)} ·
                Driver pay {currency(data.totalPay)}
              </CardDescription>
            </CardHeader>
          </Card>

          {data.settlements.length === 0 ? (
            <div className="text-muted-foreground">
              No delivered loads for this week.
            </div>
          ) : (
            <div className="space-y-3">
              {data.settlements.map((s) => {
                const isOpen = expanded === s.driverId;
                return (
                  <Card key={s.driverId}>
                    <CardHeader
                      className="cursor-pointer"
                      onClick={() => setExpanded(isOpen ? null : s.driverId)}
                    >
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <CardTitle className="text-lg">{s.driverName}</CardTitle>
                          <CardDescription>
                            {s.loadCount} loads · <Badge variant="outline">{payRuleLabel(s)}</Badge>
                          </CardDescription>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-bold text-green-600">
                            {currency(s.totalPay)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            of {currency(s.totalRevenue)} revenue
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    {isOpen && (
                      <CardContent>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="text-left text-muted-foreground">
                              <tr>
                                <th className="py-2 pr-3">Load</th>
                                <th className="py-2 pr-3">Route</th>
                                <th className="py-2 pr-3">Delivered</th>
                                <th className="py-2 pr-3 text-right">Rate</th>
                                <th className="py-2 pr-3 text-right">Miles</th>
                                <th className="py-2 pr-3 text-right">Pay</th>
                              </tr>
                            </thead>
                            <tbody>
                              {s.lines.map((l) => (
                                <tr key={l.loadId} className="border-t">
                                  <td className="py-2 pr-3 font-mono text-xs">
                                    {l.loadNumber}
                                  </td>
                                  <td className="py-2 pr-3">
                                    {l.origin} → {l.destination}
                                  </td>
                                  <td className="py-2 pr-3 text-xs">
                                    {l.deliveredAt
                                      ? new Date(l.deliveredAt).toLocaleDateString()
                                      : "—"}
                                  </td>
                                  <td className="py-2 pr-3 text-right">
                                    {currency(l.rate)}
                                  </td>
                                  <td className="py-2 pr-3 text-right">
                                    {l.miles || "—"}
                                  </td>
                                  <td className="py-2 pr-3 text-right font-semibold">
                                    {currency(l.pay)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="mt-3 text-xs text-muted-foreground">
                          Change this driver's pay rule:{" "}
                          <code>
                            PATCH /api/drivers/{s.driverId}/pay {"{payType, payRate}"}
                          </code>
                        </div>
                      </CardContent>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
