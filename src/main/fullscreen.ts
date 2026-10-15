import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Reports whether a fullscreen app / game / presentation is in the foreground.
 * Windows: asks the shell via SHQueryUserNotificationState (the same signal Windows
 * uses to silence notifications during games), from one long-lived PowerShell.
 * Other platforms: never reports fullscreen.
 */
const PS_SCRIPT = `
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class Quns { [DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int s); }
"@
while ($true) {
  $s = 0
  [void][Quns]::SHQueryUserNotificationState([ref]$s)
  [Console]::Out.WriteLine($s)
  [Console]::Out.Flush()
  Start-Sleep -Seconds 2
}
`;

// QUNS_BUSY = 2, QUNS_RUNNING_D3D_FULL_SCREEN = 3, QUNS_PRESENTATION_MODE = 4
const FULLSCREEN_STATES = new Set([2, 3, 4]);

export function watchFullscreen(onChange: (fullscreen: boolean) => void): () => void {
  if (process.platform !== 'win32') return () => {};
  let current = false;
  let child: ChildProcess | null = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_SCRIPT],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  let buf = '';
  child.stdout?.on('data', (d: Buffer) => {
    buf += d.toString();
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? '';
    const last = Number(lines.filter(Boolean).pop());
    const fs = FULLSCREEN_STATES.has(last);
    if (!Number.isNaN(last) && fs !== current) onChange((current = fs));
  });
  child.on('exit', () => (child = null));
  return () => child?.kill();
}
