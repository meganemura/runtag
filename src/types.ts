export type JobStatus = "running" | "exited";

export interface Job {
  id: string;
  pid: number;
  supervisor_pid: number;
  cwd: string;
  repo_root: string | null;
  command: string[];
  label: string | null;
  status: JobStatus;
  exit_code: number | null;
  started_at: string;
  ended_at: string | null;
}

export interface OrphanJob extends Job {
  orphan: true;
}

export type JobView = Job | OrphanJob;

export interface SuperviseSpec {
  id: string;
  cwd: string;
  label: string | null;
  command: string[];
}
