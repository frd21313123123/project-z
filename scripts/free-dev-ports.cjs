const { execFileSync } = require('node:child_process');

const ports = new Set(['3000', '3001']);

function listWindowsListeners() {
  const output = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
  const pids = new Set();

  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const localAddress = parts[1] || '';
    const state = parts[3] || '';
    const pid = parts[4] || '';
    const port = localAddress.match(/:(\d+)$/)?.[1];

    if (state === 'LISTENING' && port && ports.has(port) && /^\d+$/.test(pid)) {
      pids.add(pid);
    }
  }

  return [...pids];
}

function killPid(pid) {
  try {
    execFileSync('taskkill', ['/PID', pid, '/F', '/T'], { stdio: 'ignore' });
    console.log(`Freed dev port process PID ${pid}`);
  } catch {
    // The process may have already exited.
  }
}

if (process.platform === 'win32') {
  for (const pid of listWindowsListeners()) {
    if (pid !== String(process.pid)) killPid(pid);
  }
} else {
  console.log('Port cleanup is only configured for Windows; skipping.');
}
