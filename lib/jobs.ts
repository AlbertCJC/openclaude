import { spawn, type ChildProcess } from 'child_process';

type Job = { id: string; command: string; proc: ChildProcess; out: string; read: number; exit: number | null };
// ponytail: in-memory, jobs die with the app; fine for a desktop session
export const jobs = new Map<string, Job>();
let n = 0;

export function startJob(command: string, cwd: string) {
  const id = `job${++n}`;
  const proc = spawn(command, { cwd, shell: true, windowsHide: true });
  const job: Job = { id, command, proc, out: '', read: 0, exit: null };
  const add = (b: Buffer) => { job.out = (job.out + b).slice(-1_000_000); job.read = Math.min(job.read, job.out.length); };
  proc.stdout?.on('data', add);
  proc.stderr?.on('data', add);
  proc.on('exit', code => { job.exit = code ?? -1; });
  jobs.set(id, job);
  return id;
}

export function readJob(id: string, filter?: string) {
  const j = jobs.get(id);
  if (!j) throw new Error(`No job ${id}`);
  let text = j.out.slice(j.read);
  j.read = j.out.length;
  if (filter) { const re = new RegExp(filter, 'i'); text = text.split('\n').filter(l => re.test(l)).join('\n'); }
  return `[${j.exit === null ? 'running' : `exited ${j.exit}`}]\n${text.slice(-20000)}`;
}

export function killJob(id: string) {
  const j = jobs.get(id);
  if (!j) throw new Error(`No job ${id}`);
  if (j.exit === null) {
    if (process.platform === 'win32' && j.proc.pid) spawn('taskkill', ['/pid', String(j.proc.pid), '/T', '/F']);
    else j.proc.kill();
  }
  return `Killed ${id}`;
}

export const listJobs = () => [...jobs.values()].map(j => ({ id: j.id, command: j.command, status: j.exit === null ? 'running' : `exited ${j.exit}` }));
