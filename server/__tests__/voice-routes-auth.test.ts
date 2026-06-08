/**
 * Regression guard: /api/voice/* routes must be behind the dispatcher/admin
 * auth prefix guard.
 *
 * Why this exists: the SP1 call-data routes (GET /api/voice/calls, the recording
 * audio proxy, POST /api/voice/calls/:id/convert) shipped WITHOUT being added to
 * an auth prefix guard, so call transcripts, caller phone numbers, and recording
 * audio were readable by anonymous internet requests. Same class of bug as the
 * unauthenticated SMS/test endpoints (see test-endpoints-auth.test.ts).
 *
 * Source-level tripwire: asserts '/api/voice' is listed inside the
 * adminOrDispatcherOrApiKey prefix-guard block in server/routes.ts. Fails on the
 * pre-fix code and on any future edit that drops the prefix from the guard.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routesSrc = readFileSync(resolve(__dirname, "../routes.ts"), "utf8");

describe("/api/voice routes require dispatcher/admin auth", () => {
  it("'/api/voice' is inside the adminOrDispatcherOrApiKey prefix guard", () => {
    const block = routesSrc.match(
      /app\.use\(\s*\[([\s\S]*?)\]\s*,\s*adminOrDispatcherOrApiKey\s*\)/,
    );
    expect(
      block,
      "could not find the adminOrDispatcherOrApiKey prefix-guard block in routes.ts",
    ).toBeTruthy();
    expect(
      /['"`]\/api\/voice['"`]/.test(block![1]),
      "'/api/voice' must be inside the adminOrDispatcherOrApiKey prefix guard — voice routes expose call transcripts + caller numbers + recording audio and must not be public.",
    ).toBe(true);
  });
});
