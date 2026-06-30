const { execFileSync } = require('child_process');
const path = require('path');

const port = Number(process.argv[2] || 3000);
const projectRoot = path.resolve(__dirname, '..').toLowerCase();

function run(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function killPid(pid) {
  if (!pid || Number(pid) === process.pid) return false;
  try {
    process.kill(Number(pid), 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

function commandBelongsToProject(commandLine) {
  return commandLine.toLowerCase().includes(projectRoot);
}

function killWindowsPortOwner() {
  const pids = run('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`,
  ])
    .split(/\s+/)
    .filter(Boolean);

  for (const pid of pids) {
    const commandLine = run('powershell.exe', [
      '-NoProfile',
      '-Command',
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
    ]);
    if (!commandBelongsToProject(commandLine)) {
      console.error(`Port ${port} is used by another process (${pid}). Not killing it.`);
      process.exit(1);
    }
    if (killPid(pid)) console.log(`Stopped old dev server on port ${port} (pid ${pid}).`);
  }
}

function killUnixPortOwner() {
  const pids = run('sh', ['-c', `lsof -ti tcp:${port} -sTCP:LISTEN 2>/dev/null || true`])
    .split(/\s+/)
    .filter(Boolean);

  for (const pid of pids) {
    const commandLine = run('ps', ['-p', pid, '-o', 'command=']);
    if (!commandBelongsToProject(commandLine)) {
      console.error(`Port ${port} is used by another process (${pid}). Not killing it.`);
      process.exit(1);
    }
    if (killPid(pid)) console.log(`Stopped old dev server on port ${port} (pid ${pid}).`);
  }
}

if (process.platform === 'win32') killWindowsPortOwner();
else killUnixPortOwner();
