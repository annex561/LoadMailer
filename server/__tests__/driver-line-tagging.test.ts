import { describe, it, expect } from "vitest";
import { resolveCallSource } from "../driver-line-service";

describe("resolveCallSource", () => {
  it("tags a matched driver call as twilio_driver with the driver's id + company", () => {
    expect(resolveCallSource({ id: "drv1", companyId: "comp1" }, {})).toEqual({
      source: "twilio_driver", driverId: "drv1", companyId: "comp1",
    });
  });
  it("falls back to twilio_main / nulls when no driver matched", () => {
    expect(resolveCallSource(undefined, {})).toEqual({
      source: "twilio_main", driverId: null, companyId: null,
    });
  });
  it("honors explicit job overrides when no driver matched", () => {
    expect(resolveCallSource(null, { source: "twilio_portal", driverId: "d", companyId: "c" })).toEqual({
      source: "twilio_portal", driverId: "d", companyId: "c",
    });
  });
});
