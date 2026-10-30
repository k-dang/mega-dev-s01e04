export type JobStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: JobStatus;
  lastError: string | null;
  firstAt: string;
  lastAt: string;
};

export type NightDigest = {
  night: string;
  rows: DigestRow[];
  badLines: number;
  counts: Record<JobStatus, number>;
};

// readNight(runsDir, night): null means missing or invalid night; rows are sorted by job.
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
