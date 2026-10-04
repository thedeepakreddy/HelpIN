// Runs the API, the worker and the web app together with prefixed output. Ctrl+C stops all three.
import { spawn } from 'node:child_process';

const procs = [
  ['api', '\x1b[32m', ['--filter', '@helpin/api', 'dev']],
  ['worker', '\x1b[33m', ['--filter', '@helpin/api', 'dev:worker']],
  ['web', '\x1b[36m', ['--filter', '@helpin/web', 'dev']],
];

const children = procs.map(([name, color, args]) => {
  const child = spawn('pnpm', args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FORCE_COLOR: '1' } });
  const prefix = `${color}${name.padEnd(6)}\x1b[0m │ `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) out.write(prefix + line + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    process.stdout.write(`${prefix}exited with ${code}\n`);
    stop(code ?? 0);
  });
  return child;
});

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
