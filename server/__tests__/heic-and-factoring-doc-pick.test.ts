/**
 * Behavior tests for two targeted fixes:
 *
 * (a) HEIC upload normalization — recordDirectUploadedPhoto and
 *     recordExternalPhotoUpload must store a Cloudinary f_jpg URL so
 *     that iPhone HEIC uploads are served as JPEG and can be embedded
 *     in the factoring PDF packet.
 *
 * (b) Factoring doc selection priority — source pins verify the query
 *     uses ORDER BY + in-memory priority sort. Pure sort-logic tests
 *     verify delivery_pod > delivery_signed_bol > pod > bol > pickup_bol,
 *     newest-first within same type.
 *
 * No network. db / storage / Cloudinary / email calls are mocked.
 * Pattern follows upload-direct-cloudinary.test.ts (lazy vi.mock + await import).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// ─────────────────────────────────────────────────────────────────────────────
// Heavy-dep mocks — must appear before any import of load-photos-service so
// vitest never tries to resolve the real (large) modules. These prevent the
// "[vitest-worker]: Timeout calling 'fetch' with ['/shared/schema.ts','ssr']"
// timeouts that occur when workers resolve @shared/schema under parallel load.
// ─────────────────────────────────────────────────────────────────────────────
vi.mock("@shared/schema", () => ({
  loadDocuments: {
    id: {},
    fileUrl: {},
    documentType: {},
    approvalStatus: {},
    loadId: {},
    createdAt: {},
  },
  loads: { id: {}, loadNumber: {}, driverId: {} },
  drivers: {},
  driverLocations: { latitude: {}, longitude: {}, loadId: {}, driverId: {} },
}));

vi.mock("cloudinary", () => ({
  v2: {
    config: vi.fn(),
    uploader: { upload: vi.fn(), destroy: vi.fn() },
    utils: { api_sign_request: vi.fn(() => "mock-sig") },
  },
}));

vi.mock("../sms-service", () => ({
  smsLoadService: { sendSms: vi.fn(), notifyDriver: vi.fn() },
}));

vi.mock("../upload-page-client-source", () => ({
  UPLOAD_PAGE_CLIENT_JS: "// mock client js",
}));

// ─────────────────────────────────────────────────────────────────────────────
// DB mock — findFirst is a vi.fn() so tests can override per-call.
// insert is a plain function that writes to the shared arrays.
// ─────────────────────────────────────────────────────────────────────────────
const insertedDocs: any[] = [];
const insertedLocations: any[] = [];

vi.mock("../db", () => ({
  db: {
    query: {
      loads: {
        findFirst: vi.fn(async () => ({
          id: "load-99",
          loadNumber: "LD-99",
          driverId: "driver-1",
        })),
      },
    },
    insert: (_t: any) => ({
      values: (v: any) => {
        const isLocation = "latitude" in v;
        if (isLocation) {
          insertedLocations.push(v);
        } else {
          insertedDocs.push({ id: "doc-" + insertedDocs.length, ...v });
        }
        const result = isLocation ? [] : [insertedDocs[insertedDocs.length - 1]];
        return {
          returning: async () => result,
          then: (onFulfilled: any, onRejected: any) =>
            Promise.resolve(result).then(onFulfilled, onRejected),
        };
      },
    }),
    select: vi.fn(),
    update: vi.fn(() => ({
      set: () => ({
        where: () => ({ then: (r: any) => Promise.resolve([]).then(r) }),
      }),
    })),
  },
}));

beforeEach(() => {
  insertedDocs.length = 0;
  insertedLocations.length = 0;
  vi.clearAllMocks();
  // Re-apply default fixture after clearAllMocks resets the spy.
  import("../db").then(({ db }) => {
    (db.query.loads.findFirst as any).mockResolvedValue({
      id: "load-99",
      loadNumber: "LD-99",
      driverId: "driver-1",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (a) normalizeCloudinaryJpgUrl — pure helper (no db needed)
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeCloudinaryJpgUrl — pure helper", () => {
  it("injects f_jpg/ after /upload/ in a plain HEIC URL", async () => {
    const { normalizeCloudinaryJpgUrl } = await import("../load-photos-service");
    expect(
      normalizeCloudinaryJpgUrl(
        "https://res.cloudinary.com/lamp/image/upload/v1234/traqiq/loads/LD-99/pickup_bol.heic",
      ),
    ).toBe(
      "https://res.cloudinary.com/lamp/image/upload/f_jpg/v1234/traqiq/loads/LD-99/pickup_bol.heic",
    );
  });

  it("leaves non-Cloudinary URLs unchanged", async () => {
    const { normalizeCloudinaryJpgUrl } = await import("../load-photos-service");
    const url = "https://example.com/bol.heic";
    expect(normalizeCloudinaryJpgUrl(url)).toBe(url);
  });

  it("is idempotent — does not re-inject f_jpg when already present", async () => {
    const { normalizeCloudinaryJpgUrl } = await import("../load-photos-service");
    const already =
      "https://res.cloudinary.com/lamp/image/upload/f_jpg/v123/x.jpg";
    expect(normalizeCloudinaryJpgUrl(already)).toBe(already);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (a) recordDirectUploadedPhoto — stores f_jpg URL
// ─────────────────────────────────────────────────────────────────────────────

describe("recordDirectUploadedPhoto — HEIC URL stored as f_jpg", () => {
  it("normalizes HEIC URL before inserting into load_documents", async () => {
    const { recordDirectUploadedPhoto } = await import("../load-photos-service");
    const heicUrl =
      "https://res.cloudinary.com/lamp/image/upload/v1234/traqiq/loads/LD-99/pickup_bol_1234.heic";
    const result = await recordDirectUploadedPhoto({
      loadId: "load-99",
      stage: "pickup_bol",
      fileUrl: heicUrl,
      fileName: "IMG_001.heic",
      fileSize: 2048000,
      mimeType: "image/heic",
    });

    expect(result.ok).toBe(true);
    expect(insertedDocs).toHaveLength(1);
    // Must have f_jpg so the factoring PDF builder gets JPEG bytes.
    expect(insertedDocs[0].fileUrl).toContain("f_jpg");
    expect(insertedDocs[0].fileUrl).not.toBe(heicUrl);
    expect(insertedDocs[0].fileUrl).toMatch(/^https:\/\/res\.cloudinary\.com\//);
  });

  it("rejects non-Cloudinary URLs before normalization", async () => {
    const { recordDirectUploadedPhoto } = await import("../load-photos-service");
    const result = await recordDirectUploadedPhoto({
      loadId: "load-99",
      stage: "pickup_bol",
      fileUrl: "https://evil.example.com/bol.jpg",
      fileName: "bol.jpg",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Invalid file URL/);
    expect(insertedDocs).toHaveLength(0);
  });

  it("also injects f_jpg for regular JPEG uploads (harmless, guarantees contract)", async () => {
    const { recordDirectUploadedPhoto } = await import("../load-photos-service");
    const jpgUrl =
      "https://res.cloudinary.com/lamp/image/upload/v1234/traqiq/loads/LD-99/pickup_bol.jpg";
    await recordDirectUploadedPhoto({
      loadId: "load-99",
      stage: "pickup_bol",
      fileUrl: jpgUrl,
      fileName: "bol.jpg",
      mimeType: "image/jpeg",
    });
    expect(insertedDocs[0].fileUrl).toContain("f_jpg");
    expect(insertedDocs[0].fileUrl).toMatch(/^https:\/\/res\.cloudinary\.com\//);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (a) recordExternalPhotoUpload — stores f_jpg URL
// ─────────────────────────────────────────────────────────────────────────────

describe("recordExternalPhotoUpload — HEIC URL stored as f_jpg", () => {
  it("normalizes HEIC cloudinaryUrl and returns the normalized URL", async () => {
    const { recordExternalPhotoUpload } = await import("../load-photos-service");
    const heicUrl =
      "https://res.cloudinary.com/lamp/image/upload/v999/traqiq/loads/LD-99/delivery_pod.heic";
    const result = await recordExternalPhotoUpload({
      loadId: "load-99",
      stage: "delivery_pod",
      cloudinaryUrl: heicUrl,
      cloudinaryPublicId: "traqiq/loads/LD-99/delivery_pod",
      mimeType: "image/heic",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toContain("f_jpg");
    }
    expect(insertedDocs[0].fileUrl).toContain("f_jpg");
    expect(insertedDocs[0].fileUrl).toMatch(/^https:\/\/res\.cloudinary\.com\//);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) Factoring doc selection — source-text pins for the DB query fix
// ─────────────────────────────────────────────────────────────────────────────

const _factoringLovesSrc = readFileSync(
  join(__dirname, "..", "factoring-loves.ts"),
  "utf8",
);

describe("factoring-loves.ts — doc selection query fix (source pins)", () => {
  it("query uses orderBy(desc(createdAt)) — not bare limit(1)", () => {
    expect(_factoringLovesSrc).toMatch(/orderBy\(desc\(loadDocuments\.createdAt\)\)/);
    // The old bare .limit(1) directly on the BOL query must be gone.
    const approvedSection = _factoringLovesSrc.slice(
      _factoringLovesSrc.indexOf("approvedBolDocs"),
      _factoringLovesSrc.indexOf("sortedDocs"),
    );
    expect(approvedSection).not.toMatch(/\.limit\(1\)/);
  });

  it("priority map ranks delivery_pod=4 highest, pickup_bol=0 lowest", () => {
    expect(_factoringLovesSrc).toMatch(/delivery_pod.*:\s*4/);
    expect(_factoringLovesSrc).toMatch(/delivery_signed_bol.*:\s*3/);
    expect(_factoringLovesSrc).toMatch(/pod.*:\s*2/);
    expect(_factoringLovesSrc).toMatch(/bol.*:\s*1/);
    expect(_factoringLovesSrc).toMatch(/pickup_bol.*:\s*0/);
  });

  it("supplemental pickup_bol page is attached when a delivery doc is primary", () => {
    expect(_factoringLovesSrc).toMatch(/Pickup BOL \(supplemental\)/);
    expect(_factoringLovesSrc).toMatch(/pickupBolDoc/);
    expect(_factoringLovesSrc).toMatch(/DELIVERY_DOC_TYPES/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) Factoring doc selection — pure sort logic (no db, no imports)
// ─────────────────────────────────────────────────────────────────────────────

describe("factoring doc selection — pure sort logic (mirrors buildFactoringPacket)", () => {
  // Mirror the priority map from factoring-loves.ts so tests are independent.
  const DOC_PRIORITY: Record<string, number> = {
    pickup_bol: 0,
    bol: 1,
    pod: 2,
    delivery_signed_bol: 3,
    delivery_pod: 4,
  };

  function makeDoc(type: string, createdAt: Date) {
    return {
      id: type + "-" + createdAt.getTime(),
      fileUrl: `https://res.cloudinary.com/lamp/image/upload/f_jpg/${type}.jpg`,
      documentType: type,
      createdAt,
    };
  }

  function sortDocs(docs: ReturnType<typeof makeDoc>[]) {
    return [...docs].sort((a, b) => {
      const pa = DOC_PRIORITY[a.documentType] ?? -1;
      const pb = DOC_PRIORITY[b.documentType] ?? -1;
      if (pb !== pa) return pb - pa;
      return (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);
    });
  }

  const T = new Date("2026-10-26T10:00:00Z");

  it("delivery_pod beats pickup_bol regardless of array order", () => {
    const docs = [
      makeDoc("pickup_bol", T),
      makeDoc("delivery_pod", T),
    ];
    expect(sortDocs(docs)[0].documentType).toBe("delivery_pod");
  });

  it("delivery_pod beats delivery_signed_bol", () => {
    expect(sortDocs([makeDoc("delivery_signed_bol", T), makeDoc("delivery_pod", T)])[0].documentType).toBe("delivery_pod");
  });

  it("delivery_signed_bol beats pod", () => {
    expect(sortDocs([makeDoc("pod", T), makeDoc("delivery_signed_bol", T)])[0].documentType).toBe("delivery_signed_bol");
  });

  it("pod beats bol", () => {
    expect(sortDocs([makeDoc("bol", T), makeDoc("pod", T)])[0].documentType).toBe("pod");
  });

  it("bol beats pickup_bol", () => {
    expect(sortDocs([makeDoc("pickup_bol", T), makeDoc("bol", T)])[0].documentType).toBe("bol");
  });

  it("newest wins within the same type", () => {
    const older = new Date("2026-10-25T06:00:00Z");
    const newer = new Date("2026-10-26T08:00:00Z");
    expect(
      sortDocs([makeDoc("delivery_pod", older), makeDoc("delivery_pod", newer)])[0].createdAt,
    ).toEqual(newer);
  });

  it("pickup_bol supplemental: only added when primary is a delivery type", () => {
    const DELIVERY_DOC_TYPES = new Set(["delivery_pod", "delivery_signed_bol", "pod"]);
    // Primary is delivery_pod → should include pickup_bol as supplemental
    const allDocs = [
      makeDoc("pickup_bol", T),
      makeDoc("delivery_pod", T),
    ];
    const sorted = sortDocs(allDocs);
    const primary = sorted[0];
    const pickupBolDoc = DELIVERY_DOC_TYPES.has(primary.documentType)
      ? allDocs.find((d) => d.documentType === "pickup_bol")
      : null;
    expect(primary.documentType).toBe("delivery_pod");
    expect(pickupBolDoc).toBeDefined();
    expect(pickupBolDoc?.documentType).toBe("pickup_bol");
  });

  it("pickup_bol NOT supplemental when pickup_bol is the primary doc", () => {
    const DELIVERY_DOC_TYPES = new Set(["delivery_pod", "delivery_signed_bol", "pod"]);
    const allDocs = [makeDoc("pickup_bol", T)];
    const sorted = sortDocs(allDocs);
    const primary = sorted[0];
    const pickupBolDoc = DELIVERY_DOC_TYPES.has(primary.documentType)
      ? allDocs.find((d) => d.documentType === "pickup_bol")
      : null;
    expect(primary.documentType).toBe("pickup_bol");
    expect(pickupBolDoc).toBeNull();
  });
});
