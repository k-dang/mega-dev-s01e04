import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, JobStatus, ReadNight } from './types.js';

type RunEvent = {
  at: string;
  job: string;
  status: JobStatus;
  owner: string | null;
  error?: string;
};

function isNight(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function isRunEvent(value: unknown): value is RunEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.at === 'string' &&
    /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(event.at) &&
    isNight(event.at.slice(0, 10)) &&
    Number.isFinite(Date.parse(event.at)) &&
    typeof event.job === 'string' && event.job.trim().length > 0 &&
    (event.status === 'ok' || event.status === 'retry' || event.status === 'fail') &&
    (event.owner === null || typeof event.owner === 'string') &&
    (!('error' in event) || typeof event.error === 'string')
  );
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!isNight(night)) return null;

  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  const jobs = new Map<string, {
    row: DigestRow;
    firstTime: number;
    lastTime: number;
    errorTime: number;
  }>();
  const counts = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;

  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      badLines++;
      continue;
    }
    if (!isRunEvent(event)) {
      badLines++;
      continue;
    }

    counts[event.status]++;
    const time = Date.parse(event.at);
    let job = jobs.get(event.job);
    if (!job) {
      job = {
        row: {
          job: event.job, owner: event.owner, runs: 0, retries: 0,
          lastStatus: event.status, lastError: null, firstAt: event.at, lastAt: event.at,
        },
        firstTime: time, lastTime: time, errorTime: -Infinity,
      };
      jobs.set(event.job, job);
    }
    job.row.runs++;
    if (event.status === 'retry') job.row.retries++;
    if (time < job.firstTime) {
      job.firstTime = time;
      job.row.firstAt = event.at;
    }
    if (time >= job.lastTime) {
      job.lastTime = time;
      job.row.lastAt = event.at;
      job.row.lastStatus = event.status;
      job.row.owner = event.owner;
    }
    if (event.error !== undefined && time >= job.errorTime) {
      job.errorTime = time;
      job.row.lastError = event.error;
    }
  }

  const rows = [...jobs.keys()].sort().map((name) => jobs.get(name)!.row);
  return { night, rows, badLines, counts };
};
