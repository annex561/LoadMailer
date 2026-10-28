import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";

// Regression guard: annex561/LoadMailer was public with the GA SQLite DB committed
// (data/traqiq.db + WAL: broker names, emails, phones, rates) and a pasted file
// holding a live-format Telegram bot token. Both fail this test on the old tree.
// See docs/FIX-LEDGER.md, "Committed SQLite DB exposed broker data on a public repo".

const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8", cwd: process.cwd() });

describe("repo hygiene", () => {
  it("tracks no SQLite database, WAL or SHM files", () => {
    const tracked = git("ls-files").split("\n");
    expect(tracked.filter((f) => /\.db(-wal|-shm)?$/.test(f))).toEqual([]);
  });

  it("tracks no Telegram-bot-token-shaped strings", () => {
    let hits = "";
    try {
      hits = git("grep", "-I", "-l", "-E", "[0-9]{8,10}:[A-Za-z0-9_-]{35}", "--", ":!node_modules");
    } catch {
      // git grep exits 1 when nothing matches
    }
    expect(hits.trim().split("\n").filter(Boolean)).toEqual([]);
  });
});
