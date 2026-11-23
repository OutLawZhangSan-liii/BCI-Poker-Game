import { execFile } from "node:child_process";
import path from "node:path";

/** Disable DWM snapshot transitions for this HWND only; no system settings change. */
export function disableWindowTransitions(handle: Buffer): Promise<void> {
  if (process.platform !== "win32") return Promise.resolve();
  const hwnd = handle.length === 8 ? handle.readBigUInt64LE().toString() : handle.readUInt32LE().toString();
  const script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class WindowTransitions { [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr h, int a, ref int v, int n); }'; $v=1; $h=[IntPtr]::new([long]${hwnd}); $hr=[WindowTransitions]::DwmSetWindowAttribute($h,3,[ref]$v,4); if($hr -ne 0){throw "DWM set failed: $hr"}`;
  const executable = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return new Promise((resolve, reject) => execFile(executable,
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { windowsHide: true, timeout: 10000 }, (error, _stdout, stderr) => error ? reject(new Error(`Window transitions: ${stderr || error.message}`)) : resolve()));
}
