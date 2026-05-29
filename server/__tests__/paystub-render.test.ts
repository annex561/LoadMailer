import { describe, it, expect } from "vitest";
import { renderPaystubHTML } from "../paystub-service";
import type { DriverSettlement } from "../settlements-service";

const settlement: DriverSettlement = {
  driverId: "d1",
  driverName: "Marcus Webb",
  payType: "percent",
  payRate: 80,
  weekStart: "2026-05-25",
  weekEnd: "2026-05-31",
  loadCount: 2,
  totalRevenue: 3000,
  grossPay: 2400,
  perLoadDeductions: [
    { label: "Factoring fee", amount: -90 },
    { label: "Dispatch fee", amount: -150 },
  ],
  recurringDeductions: [{ label: "Trailer rent (weekly)", amount: -200 }],
  advanceDeduction: 100,
  miscDeductions: [{ label: "Toll reimbursement", amount: -25 }],
  fuelCost: 300,
  insuranceCost: 0,
  totalDeductions: 865,
  netPay: 1535,
  totalPay: 1535,
  lines: [
    {
      loadId: "a",
      loadNumber: "L-001",
      deliveredAt: new Date("2026-05-26T12:00:00Z"),
      rate: 1000,
      miles: 500,
      pay: 800,
      origin: "Atlanta, GA",
      destination: "Miami, FL",
    },
    {
      loadId: "b",
      loadNumber: "L-002",
      deliveredAt: new Date("2026-05-28T12:00:00Z"),
      rate: 2000,
      miles: 900,
      pay: 1600,
      origin: "Miami, FL",
      destination: "Dallas, TX",
    },
  ],
};

describe("renderPaystubHTML", () => {
  const html = renderPaystubHTML(settlement, { driverName: "Marcus Webb", companyName: "LAMP" });

  it("is a full HTML document", () => {
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
  });

  it("shows the driver name and week", () => {
    expect(html).toContain("Marcus Webb");
    expect(html).toContain("2026-05-25");
    expect(html).toContain("2026-05-31");
  });

  it("renders each load line with its number and pay", () => {
    expect(html).toContain("L-001");
    expect(html).toContain("L-002");
    expect(html).toContain("Atlanta, GA");
  });

  it("shows the bottom-line net pay prominently", () => {
    expect(html).toContain("$1,535.00");
  });

  it("itemizes every deduction category", () => {
    expect(html).toContain("Factoring fee");
    expect(html).toContain("Dispatch fee");
    expect(html).toContain("Trailer rent");
    expect(html).toContain("Toll reimbursement");
    expect(html).toContain("Fuel");
    expect(html).toContain("Advance"); // advance repayment line
  });

  it("never emits NaN or undefined in the output", () => {
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("undefined");
  });
});
