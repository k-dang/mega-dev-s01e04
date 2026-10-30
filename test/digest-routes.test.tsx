import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const configFor = (runsDir: string) => ({
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir,
});

async function withRunsDir(run: (runsDir: string) => Promise<void>) {
  const runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  try {
    await run(runsDir);
  } finally {
    rmSync(runsDir, { recursive: true, force: true });
  }
}

function writeNight(runsDir: string, night: string, content: string) {
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(join(runsDir, `${night}.jsonl`), content, 'utf8');
}

function jobsInHtml(html: string): string[] {
  const rows = [...html.matchAll(/<tr\b[^>]*>(.*?)<\/tr>/gs)].map((match) => match[1]);
  return rows
    .slice(1)
    .map((row) => row.match(/<td\b[^>]*>(.*?)<\/td>/s)?.[1]?.replace(/<[^>]*>/g, '').trim())
    .filter((job): job is string => job !== undefined);
}

describe('digest routes', () => {
  it('renders the night and returns the same ordered rows as JSON', async () => {
    await withRunsDir(async (runsDir) => {
      writeNight(
        runsDir,
        '2026-10-28',
        [
          JSON.stringify({ at: '2026-10-28T01:02:03-04:00', job: 'zeta', status: 'fail', owner: null, error: 'disk full' }),
          JSON.stringify({ at: '2026-10-28T02:00:00+01:00', job: 'alpha', status: 'retry', owner: 'rook', error: 'first try failed' }),
          'not json',
          JSON.stringify({ at: 'not-a-time', job: 'bad-schema', status: 'ok', owner: null }),
          JSON.stringify({ at: '2026-10-28T02:04:05+01:00', job: 'alpha', status: 'ok', owner: 'rook' }),
        ].join('\n'),
      );

      const app = createApp(configFor(runsDir));
      const [htmlResponse, jsonResponse] = await Promise.all([
        app.request('/digest/2026-10-28'),
        app.request('/api/digest/2026-10-28'),
      ]);
      const html = await htmlResponse.text();
      const digest = await jsonResponse.json();

      expect(htmlResponse.status).toBe(200);
      expect(jsonResponse.status).toBe(200);
      expect(html).toMatch(/<h1>[^<]*2026-10-28<\/h1>/);
      expect(digest.rows.map((row: { job: string }) => row.job)).toEqual(['alpha', 'zeta']);
      expect(jobsInHtml(html)).toEqual(digest.rows.map((row: { job: string }) => row.job));
      expect(digest).toMatchObject({
        night: '2026-10-28',
        badLines: 2,
        counts: { ok: 1, retry: 1, fail: 1 },
        rows: [
          {
            job: 'alpha',
            owner: 'rook',
            runs: 2,
            retries: 1,
            lastStatus: 'ok',
            lastError: 'first try failed',
            firstAt: '2026-10-28T02:00:00+01:00',
            lastAt: '2026-10-28T02:04:05+01:00',
          },
          {
            job: 'zeta',
            owner: null,
            runs: 1,
            retries: 0,
            lastStatus: 'fail',
            lastError: 'disk full',
            firstAt: '2026-10-28T01:02:03-04:00',
            lastAt: '2026-10-28T01:02:03-04:00',
          },
        ],
      });
      expect(html).toContain('—');
      expect(html).toContain('2026-10-28T02:00:00+01:00');
      expect(html).toContain('2026-10-28T01:02:03-04:00');
      expect(html).toMatch(/<span class="warn">fail[^<]*<\/span>/);
    });
  });

  it('returns 404 for a missing or invalid night', async () => {
    await withRunsDir(async (runsDir) => {
      writeNight(runsDir, '2026-10-27', '{"at":"2026-10-27T00:00:00Z","job":"broken","status":"maybe","owner":null}');
      const app = createApp(configFor(runsDir));

      for (const path of ['/digest/2026-10-28', '/api/digest/2026-10-28', '/digest/not-a-night', '/api/digest/not-a-night']) {
        const response = await app.request(path);
        expect(response.status, path).toBe(404);
      }
    });
  });

  it('renders an empty night as nothing ran and returns an empty digest', async () => {
    await withRunsDir(async (runsDir) => {
      writeNight(runsDir, '2026-10-29', '');
      const app = createApp(configFor(runsDir));
      const [htmlResponse, jsonResponse] = await Promise.all([
        app.request('/digest/2026-10-29'),
        app.request('/api/digest/2026-10-29'),
      ]);

      expect(htmlResponse.status).toBe(200);
      expect(await htmlResponse.text()).toContain('nothing ran');
      expect(jsonResponse.status).toBe(200);
      expect(await jsonResponse.json()).toMatchObject({
        night: '2026-10-29',
        rows: [],
        badLines: 0,
        counts: { ok: 0, retry: 0, fail: 0 },
      });
    });
  });
});
