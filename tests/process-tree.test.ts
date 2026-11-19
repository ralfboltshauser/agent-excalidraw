import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { killOwnedProcessTree } from "./helpers/owned-process.js";

async function processWithInheritedPipes() {
  const child = spawn(
    process.execPath,
    [
      "-e",
      `
    const {spawn}=require('node:child_process');
    const descendant=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore','inherit','inherit']});
    descendant.once('spawn',()=>process.stdout.write('ready\\n'));
    setInterval(()=>{},1000);
  `,
    ],
    { detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  await once(child.stdout!, "data");
  return child;
}
async function cleanup(child: ChildProcess) {
  if (child.pid) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  }
}

test(
  "owned process-tree termination closes descendant-inherited pipes",
  { skip: process.platform === "win32" },
  async () => {
    const child = await processWithInheritedPipes();
    let closed = false;
    child.once("close", () => (closed = true));
    try {
      await killOwnedProcessTree(child, 2000);
      assert(closed);
      assert(child.exitCode !== null || child.signalCode !== null);
    } finally {
      await cleanup(child);
    }
  },
);
test(
  "an exited main process still needs its owned descendants terminated before stdio closes",
  { skip: process.platform === "win32" },
  async () => {
    const child = await processWithInheritedPipes();
    let closed = false;
    child.once("close", () => (closed = true));
    try {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
      await delay(30);
      // Reproduce the Linux worker hang without a GUI: main already exited, but
      // its surviving child's inherited stdout/stderr prevent the close event.
      assert.equal(closed, false);
      assert.equal(child.signalCode, "SIGKILL");
      await killOwnedProcessTree(child, 2000);
      assert.equal(closed, true);
      // A second cleanup is harmless once exit and all stdio streams are closed.
      await killOwnedProcessTree(child, 2000);
    } finally {
      await cleanup(child);
    }
  },
);
