// Build identity for /api/health.
//
// WHY
//
// Deploys to this project have repeatedly come down to the question "is the running build
// actually the one I just pushed?", and there was no way to answer it. /api/health returned
// { status, timestamp } — a timestamp that changes on every request and tells you nothing about
// which code produced it. When a change is deliberately invisible (a feature behind a default-off
// flag, a boot-time migration), every endpoint responds identically before and after the deploy,
// so there is no probe that distinguishes them. One field fixes that permanently.
//
// RESOLVED ONCE, AT MODULE LOAD
//
// railway.toml sets healthcheckPath = "/api/health" with a 60s timeout, and the route carries a
// "must respond quickly" comment. Nothing here runs per request: the commit is resolved when the
// module is first imported and then handed out as a constant. The filesystem read in the dev
// fallback happens once, at boot, never on the hot path.
//
// WHAT IS DELIBERATELY NOT EXPOSED
//
// /api/health is unauthenticated and must stay that way — Railway's healthcheck hits it, and
// server/__tests__/loads-drivers-auth.test.ts pins that guarding it would break deploys. So this
// returns a commit SHA and a boot time and nothing else. No branch, no deployment id, no env
// echo. A build identifier is the minimum that answers the question; anything more is an
// unauthenticated information leak for no operational gain.

import { readFileSync, statSync } from 'fs';
import { resolve } from 'path';

export interface BuildInfo {
  /** Short commit SHA, or 'unknown' when no source could supply one. */
  commit: string;
  /** Where the commit came from. Useful when it reads 'unknown' and you need to know why. */
  commitSource: 'railway' | 'env' | 'git' | 'none';
  /** ISO time this process started. Changes only on restart — unlike a per-request timestamp. */
  startedAt: string;
}

/** Commit SHAs are rendered at this length everywhere, so two builds are easy to eyeball apart. */
const SHORT_SHA_LENGTH = 7;

/**
 * Pick a commit SHA out of the environment.
 *
 * Pure, and takes the env as a parameter, so the priority order is testable without mutating
 * process.env. RAILWAY_GIT_COMMIT_SHA is injected automatically on Railway for a
 * GitHub-connected service; the others are escape hatches for any other host or a manual build.
 *
 * Returns null when nothing in the environment supplies one, so the caller can fall back.
 */
export function commitFromEnv(env: NodeJS.ProcessEnv): { sha: string; source: 'railway' | 'env' } | null {
  const railway = normalizeSha(env.RAILWAY_GIT_COMMIT_SHA);
  if (railway) return { sha: railway, source: 'railway' };

  for (const key of ['SOURCE_COMMIT', 'GIT_COMMIT', 'COMMIT_SHA', 'APP_COMMIT']) {
    const v = normalizeSha(env[key]);
    if (v) return { sha: v, source: 'env' };
  }
  return null;
}

/** Trim a SHA to its short form, rejecting anything that is not plausibly a hex commit. */
export function normalizeSha(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!/^[0-9a-f]{7,40}$/i.test(s)) return null;
  return s.slice(0, SHORT_SHA_LENGTH).toLowerCase();
}

/**
 * Read the checked-out commit from .git. Only useful in local development — a deployed build
 * usually has no .git at all, which is exactly why the env sources are tried first.
 *
 * Handles a git WORKTREE, where `.git` is a FILE holding "gitdir: <path>" rather than a
 * directory. This project uses worktrees routinely, so the directory-only version of this
 * function silently reported commit "unknown" for every developer working in one.
 *
 * Never throws: a missing or unreadable .git is the normal production case.
 */
export function commitFromGitDir(cwd: string = process.cwd()): string | null {
  try {
    const gitPath = resolve(cwd, '.git');
    let gitDir = gitPath;

    // Worktree (or submodule): .git is a file pointing at the real git directory.
    if (!statSync(gitPath).isDirectory()) {
      const pointer = readFileSync(gitPath, 'utf8').trim();
      const m = pointer.match(/^gitdir:\s*(.+)$/);
      if (!m) return null;
      gitDir = resolve(cwd, m[1].trim());
    }

    const head = readFileSync(resolve(gitDir, 'HEAD'), 'utf8').trim();

    // Detached HEAD: the file holds the SHA directly.
    const direct = normalizeSha(head);
    if (direct) return direct;

    const m = head.match(/^ref:\s*(.+)$/);
    if (!m) return null;
    const refPath = m[1].trim();

    // A worktree keeps HEAD in its own git dir but shares refs with the main repository, whose
    // location is recorded in `commondir`. Search both, then packed-refs in each.
    const dirs = [gitDir];
    try {
      const common = readFileSync(resolve(gitDir, 'commondir'), 'utf8').trim();
      if (common) dirs.push(resolve(gitDir, common));
    } catch {
      // No commondir means this is a plain repository; gitDir alone is correct.
    }

    for (const dir of dirs) {
      try {
        const sha = normalizeSha(readFileSync(resolve(dir, refPath), 'utf8'));
        if (sha) return sha;
      } catch {
        // Loose ref absent here; fall through to packed-refs below.
      }
    }

    for (const dir of dirs) {
      try {
        const packed = readFileSync(resolve(dir, 'packed-refs'), 'utf8');
        for (const line of packed.split('\n')) {
          if (line.startsWith('#') || line.startsWith('^')) continue;
          const [sha, ref] = line.trim().split(/\s+/);
          if (ref === refPath) return normalizeSha(sha);
        }
      } catch {
        // No packed-refs in this directory.
      }
    }

    return null;
  } catch {
    return null;
  }
}

/** Resolve build identity. Exported for testing; the module-level constant is what callers use. */
export function resolveBuildInfo(env: NodeJS.ProcessEnv = process.env, cwd?: string): BuildInfo {
  const startedAt = new Date().toISOString();

  const fromEnv = commitFromEnv(env);
  if (fromEnv) return { commit: fromEnv.sha, commitSource: fromEnv.source, startedAt };

  const fromGit = commitFromGitDir(cwd);
  if (fromGit) return { commit: fromGit, commitSource: 'git', startedAt };

  return { commit: 'unknown', commitSource: 'none', startedAt };
}

/** Resolved once, when this module is first imported. The health route just reads it. */
export const BUILD_INFO: BuildInfo = resolveBuildInfo();

/** The exact body /api/health returns. One definition, so the two callers cannot drift. */
export function healthPayload(now: Date = new Date()) {
  return {
    status: 'ok',
    timestamp: now.toISOString(),
    commit: BUILD_INFO.commit,
    commitSource: BUILD_INFO.commitSource,
    startedAt: BUILD_INFO.startedAt,
    uptimeSeconds: Math.max(0, Math.round((now.getTime() - new Date(BUILD_INFO.startedAt).getTime()) / 1000)),
  };
}
