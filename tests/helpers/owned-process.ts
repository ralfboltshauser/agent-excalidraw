import { execFile, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
const execute = promisify(execFile);

/** The child must be owned by this fixture and, on Unix, launched detached so its PID is its process-group ID. */
export async function killOwnedProcessTree(
  child: ChildProcess,
  timeoutMs = 10000,
) {
  if (!child.pid) return;
  const exited = child.exitCode !== null || child.signalCode !== null;
  const streamsClosed = child.stdio.every(
    (stream) => !stream || stream.destroyed,
  );
  if (exited && streamsClosed) return;
  // 'exit' only observes the main process. Playwright releases its process
  // registry on 'close', after every inherited stdio pipe has reached EOF.
  const closed = once(child, "close");
  if (process.platform === "win32") {
    await execute("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      timeout: 15000,
    });
  } else {
    // Playwright launches a new Unix process group. Kill that owned group even
    // when main has exited: xdg-open/Chromium descendants may still hold pipes.
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error: any) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      closed,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `Owned test process ${child.pid} did not close its inherited stdio after process-tree termination.`,
              ),
            ),
          timeoutMs,
        );
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
