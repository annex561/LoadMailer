// Guards for server/version.ts and the /api/health payload.
//
// The point of the commit field is deploy verification, so the assertions that matter are the
// ones protecting that: the priority order must put the host's own variable first, a garbage
// value must never be rendered as if it were a build, and `status: "ok"` must survive — Railway's
// healthcheck reads this endpoint and a broken shape fails the deploy rather than the test.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  commitFromEnv,
  normalizeSha,
  resolveBuildInfo,
  healthPayload,
} from '../version';

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe('normalizeSha', () => {
  it('shortens a full SHA to seven characters, lowercased', () => {
    expect(normalizeSha('4BA0157E9C2D1F3A5B7C9E1D3F5A7B9C1E3D5F7A')).toBe('4ba0157');
  });

  it('accepts a SHA that is already short', () => {
    expect(normalizeSha('defccf2')).toBe('defccf2');
  });

  it('rejects anything that is not plausibly a commit', () => {
    // A bad value must become "unknown", never get rendered as if it were a real build.
    for (const bad of ['', '   ', 'main', 'v1.0.0', 'abc', 'zzzzzzz', 'not-a-sha', undefined, null]) {
      expect(normalizeSha(bad as any), `value ${JSON.stringify(bad)}`).toBeNull();
    }
  });

  it('trims surrounding whitespace, as read from a git ref file', () => {
    expect(normalizeSha('  2109c89abcdef\n')).toBe('2109c89');
  });
});

describe('commitFromEnv — priority order', () => {
  it("prefers Railway's own variable over every fallback", () => {
    const got = commitFromEnv(env({
      RAILWAY_GIT_COMMIT_SHA: 'aaaaaaa1111',
      SOURCE_COMMIT: 'bbbbbbb2222',
      GIT_COMMIT: 'ccccccc3333',
    }));
    expect(got).toEqual({ sha: 'aaaaaaa', source: 'railway' });
  });

  it('falls through the escape hatches in order', () => {
    expect(commitFromEnv(env({ SOURCE_COMMIT: 'bbbbbbb2222' }))).toEqual({ sha: 'bbbbbbb', source: 'env' });
    expect(commitFromEnv(env({ GIT_COMMIT: 'ccccccc3333' }))).toEqual({ sha: 'ccccccc', source: 'env' });
    expect(commitFromEnv(env({ COMMIT_SHA: 'ddddddd4444' }))).toEqual({ sha: 'ddddddd', source: 'env' });
  });

  it('skips a present-but-unusable value instead of returning it', () => {
    // Railway sets the var to an empty string in some contexts. Falling through beats
    // reporting commit: "" as though it identified a build.
    const got = commitFromEnv(env({ RAILWAY_GIT_COMMIT_SHA: '', SOURCE_COMMIT: 'bbbbbbb2222' }));
    expect(got).toEqual({ sha: 'bbbbbbb', source: 'env' });
  });

  it('returns null when the environment supplies nothing', () => {
    expect(commitFromEnv(env({}))).toBeNull();
  });
});

describe('resolveBuildInfo', () => {
  it('reports the source so an "unknown" commit is diagnosable', () => {
    const info = resolveBuildInfo(env({ RAILWAY_GIT_COMMIT_SHA: 'aaaaaaa1111' }));
    expect(info.commit).toBe('aaaaaaa');
    expect(info.commitSource).toBe('railway');
  });

  it('degrades to unknown rather than throwing when there is no source at all', () => {
    // A directory with no .git and no env vars — the worst case must still boot.
    const info = resolveBuildInfo(env({}), '/nonexistent-path-for-test');
    expect(info.commit).toBe('unknown');
    expect(info.commitSource).toBe('none');
    expect(() => new Date(info.startedAt).toISOString()).not.toThrow();
  });

  it('reads the commit from .git when the environment is empty', () => {
    // This repo has a .git directory, so the dev fallback should resolve here.
    const info = resolveBuildInfo(env({}), resolve(__dirname, '../..'));
    expect(info.commitSource).toBe('git');
    expect(info.commit).toMatch(/^[0-9a-f]{7}$/);
  });
});

describe('healthPayload — Railway reads this, do not break the shape', () => {
  it('still reports status ok', () => {
    // railway.toml healthcheckPath = "/api/health". Losing this field fails the deploy.
    expect(healthPayload().status).toBe('ok');
  });

  it('carries the build commit and a boot time', () => {
    const p = healthPayload();
    expect(p).toHaveProperty('commit');
    expect(p).toHaveProperty('commitSource');
    expect(p).toHaveProperty('startedAt');
    expect(typeof p.commit).toBe('string');
  });

  it('keeps a per-request timestamp distinct from the fixed boot time', () => {
    // timestamp moves, startedAt does not — that difference is what makes a restart visible.
    const a = healthPayload(new Date('2026-09-11T10:00:00Z'));
    const b = healthPayload(new Date('2026-09-11T10:05:00Z'));
    expect(a.timestamp).not.toBe(b.timestamp);
    expect(a.startedAt).toBe(b.startedAt);
  });

  it('reports uptime that grows with wall clock and never goes negative', () => {
    const started = new Date(healthPayload().startedAt).getTime();
    expect(healthPayload(new Date(started + 90_000)).uptimeSeconds).toBe(90);
    expect(healthPayload(new Date(started - 90_000)).uptimeSeconds).toBe(0);
  });

  it('leaks nothing beyond build identity', () => {
    // The endpoint is unauthenticated by design. Adding branch names, deployment ids or env
    // echoes here hands them to anyone who asks.
    expect(Object.keys(healthPayload()).sort()).toEqual(
      ['commit', 'commitSource', 'startedAt', 'status', 'timestamp', 'uptimeSeconds'],
    );
  });
});

describe('/api/health is registered exactly once', () => {
  it('lives in index.ts and not in routes.ts', () => {
    // routes.ts used to declare a second, identical handler. index.ts registers at import time,
    // long before registerRoutes() runs, so that one never matched and was free to drift.
    const strip = (f: string) =>
      readFileSync(resolve(__dirname, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
    expect(strip('../index.ts')).toMatch(/app\.get\("\/api\/health"/);
    expect(strip('../routes.ts')).not.toMatch(/app\.get\(['"]\/api\/health['"]/);
  });

  it('builds the body from healthPayload rather than an inline literal', () => {
    const src = readFileSync(resolve(__dirname, '../index.ts'), 'utf8');
    expect(src).toMatch(/res\.json\(healthPayload\(\)\)/);
  });
});
