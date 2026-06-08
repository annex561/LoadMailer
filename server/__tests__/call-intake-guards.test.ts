import { describe, it, expect } from "vitest";
import { shouldTranscribe, withinRateCeiling } from "../call-intake-service";

describe("shouldTranscribe", () => {
  it("skips when feature disabled", () => {
    expect(shouldTranscribe(30, false).transcribe).toBe(false);
  });
  it("skips zero-duration and over-cap recordings", () => {
    expect(shouldTranscribe(0, true).transcribe).toBe(false);
    expect(shouldTranscribe(99999, true, 1200).transcribe).toBe(false);
  });
  it("transcribes a normal enabled call", () => {
    expect(shouldTranscribe(45, true, 1200).transcribe).toBe(true);
  });
});

describe("withinRateCeiling", () => {
  it("allows below the ceiling and blocks at/above it", () => {
    expect(withinRateCeiling(29, 30)).toBe(true);
    expect(withinRateCeiling(30, 30)).toBe(false);
  });
});
