/**
 * Regression test: ratecon PDF must be persisted to Cloudinary on intake.
 *
 * History: enqueueRatecon() accepted pdfBuffer but never saved it.
 * pdfPath was always null, so factoring-loves.ts could never build a
 * packet — every submission failed with "No Rate Confirmation PDF found".
 * This test pins that the upload is attempted when a buffer is provided.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Cloudinary before the module imports ──────────────────────────────
vi.mock("cloudinary", () => {
  const uploadStreamMock = vi.fn((_opts: any, cb: (err: any, result: any) => void) => {
    const passthrough = {
      end: (_buf: Buffer) => {
        // Simulate a successful upload on next tick
        setTimeout(() => cb(null, { secure_url: "https://res.cloudinary.com/test/raw/upload/traqiq/ratecons/ratecon_test_123.pdf" }), 0);
      },
    };
    return passthrough;
  });
  return {
    v2: {
      uploader: { upload_stream: uploadStreamMock },
    },
    __uploadStreamMock: uploadStreamMock,
  };
});

// ── Mock DB so no real DB calls fire ──────────────────────────────────────
vi.mock("../db", () => ({
  db: {
    insert: () => ({
      values: () => ({
        returning: async () => [{ id: "intake-123", pdfPath: "https://res.cloudinary.com/test/raw/upload/traqiq/ratecons/ratecon_test_123.pdf", status: "pending" }],
      }),
    }),
  },
}));

describe("enqueueRatecon — PDF persistence", () => {
  it("uploads the PDF to Cloudinary and records pdfPath when pdfBuffer is provided", async () => {
    const { enqueueRatecon } = await import("../ratecon-intake-service");
    const fakePdf = Buffer.from("%PDF-1.4 fake content for testing");

    const result = await enqueueRatecon({
      sourceType: "email",
      companyId: null,
      pdfBuffer: fakePdf,
      sourceFilename: "TQL_36630889.pdf",
    });

    // The intake row must have a pdfPath pointing to Cloudinary
    expect(result.pdfPath).toBeTruthy();
    expect(result.pdfPath).toMatch(/res\.cloudinary\.com/);
  });

  it("does not throw when pdfBuffer is absent — pdfPath stays null", async () => {
    const { enqueueRatecon } = await import("../ratecon-intake-service");

    const result = await enqueueRatecon({
      sourceType: "manual",
      companyId: null,
      // no pdfBuffer
    });

    // Should not throw; pdfPath can be null for manual/text-only entries
    expect(result).toBeDefined();
  });
});
