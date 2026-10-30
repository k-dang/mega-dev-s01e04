import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readNight } from '../src/digest/reader.js';

vi.mock('node:fs', { spy: true });

const night = '2026-10-28';
const event = { at: '2026-10-28T23:00:00+01:00', job: 'lane/sync', status: 'ok', owner: 'rook' };
let runsDir: string;

function writeEvents(events: unknown[]) {
  fs.writeFileSync(join(runsDir, `${night}.jsonl`), events.map((value) => JSON.stringify(value)).join('\n'));
}

beforeEach(() => {
  runsDir = fs.mkdtempSync(join(tmpdir(), 'rig-digest-'));
});

afterEach(() => {
  vi.clearAllMocks();
  fs.rmSync(runsDir, { recursive: true, force: true });
});

describe('readNight', () => {
  it('aggregates the real fixture without changing offsets or losing null owners', () => {
    const digest = readNight('runs', night);
    expect(digest).toMatchObject({ night, badLines: 1, counts: { ok: 10, retry: 4, fail: 1 } });
    expect(digest?.rows.map((row) => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest?.rows[0].owner).toBeNull();
    expect(digest?.rows[1]).toEqual({
      job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3,
      lastStatus: 'ok', lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
    });
  });

  it('counts invalid JSON and schema lines without including them in totals', () => {
    const { owner, ...missingOwner } = event;
    const invalid = [
      null, [], 7, 'event', {}, missingOwner,
      { ...event, owner: 7 }, { ...event, job: '  ' }, { ...event, job: null },
      { ...event, status: 'pending' }, { ...event, error: null }, { ...event, error: 5 },
      { ...event, at: 'yesterday' }, { ...event, at: 0 },
      { ...event, at: '2026-02-30T00:00:00Z' },
      { ...event, at: '2026-10-28T23:00:00' },
    ];
    writeEvents([...invalid, event]);
    fs.appendFileSync(join(runsDir, `${night}.jsonl`), '\n{"broken":\n');
    expect(readNight(runsDir, night)).toMatchObject({
      badLines: invalid.length + 1, counts: { ok: 1, retry: 0, fail: 0 },
      rows: [{ job: event.job, owner: event.owner, runs: 1, retries: 0, lastError: null }],
    });
  });

  it('uses actual time for bounds, status, owner and the latest supplied error', () => {
    writeEvents([
      { ...event, at: '2026-10-29T01:00:00+02:00', status: 'retry', error: 'new error' },
      { ...event, at: '2026-10-28T23:30:00Z', owner: null },
      { ...event, at: '2026-10-29T00:00:00+02:00', status: 'fail', error: 'old error' },
      { ...event, job: 'aaa', owner: null },
    ]);
    expect(readNight(runsDir, night)).toEqual({
      night, badLines: 0, counts: { ok: 2, retry: 1, fail: 1 },
      rows: [
        { job: 'aaa', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: event.at, lastAt: event.at },
        { job: event.job, owner: null, runs: 3, retries: 1, lastStatus: 'ok', lastError: 'new error',
          firstAt: '2026-10-29T00:00:00+02:00', lastAt: '2026-10-28T23:30:00Z' },
      ],
    });
  });

  it('uses the later line for tied latest timestamps and preserves supplied empty errors', () => {
    writeEvents([
      { ...event, status: 'fail', error: 'failure' },
      { ...event, owner: null, error: '' },
      event,
    ]);
    expect(readNight(runsDir, night)?.rows[0]).toMatchObject({
      owner: 'rook', lastStatus: 'ok', lastError: '', runs: 3,
    });
  });

  it('distinguishes missing files and directories from empty or blank nights', () => {
    expect(readNight(runsDir, night)).toBeNull();
    expect(readNight(join(runsDir, 'missing'), night)).toBeNull();
    for (const contents of ['', '\r\n  \n']) {
      fs.writeFileSync(join(runsDir, `${night}.jsonl`), contents);
      expect(readNight(runsDir, night)).toEqual({
        night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
      });
    }
  });

  it('rejects invalid nights before accessing the filesystem', () => {
    const read = vi.mocked(fs.readFileSync);
    for (const invalid of [
      '', '../2026-10-28', '..\\2026-10-28', '/2026-10-28', 'C:\\2026-10-28',
      '2026-10-28/..', '2026-10-28.jsonl', '2026-10-28\0', '2026-10-28\n',
      '2026-02-29', '2026-02-30', '2026-13-01', '2026-1-01',
    ]) {
      expect(readNight(runsDir, invalid)).toBeNull();
    }
    expect(read).not.toHaveBeenCalled();
  });

  it('accepts a leap day and CRLF-delimited events', () => {
    const at = '2024-02-29T23:00:00.123-05:00';
    fs.writeFileSync(join(runsDir, '2024-02-29.jsonl'), `${JSON.stringify({ ...event, at })}\r\n`);
    expect(readNight(runsDir, '2024-02-29')?.rows[0].lastAt).toBe(at);
  });

  it.each(['EACCES', 'EIO', 'ENOTDIR'])('propagates %s filesystem failures', (code) => {
    const error = Object.assign(new Error('read failed'), { code });
    vi.mocked(fs.readFileSync).mockImplementationOnce(() => { throw error; });
    expect(() => readNight(runsDir, night)).toThrow(error);
  });

  it('propagates a real read failure when the night path is a directory', () => {
    fs.mkdirSync(join(runsDir, `${night}.jsonl`));
    expect(() => readNight(runsDir, night)).toThrow();
  });
});
