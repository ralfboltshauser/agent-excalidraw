import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  readFile,
  mkdir,
  rm,
  symlink,
  lstat,
  realpath,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer, type Server } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { send, dataDirectory, VERSION } from "../src/cli/transport.js";
import { installSkills, uninstallSkills, roots } from "../src/cli/skills.js";
import { validateRequest, schemaDocument } from "../src/cli/schema.js";
import { commands } from "../src/shared/commands.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const exec = promisify(execFile);
const cli = resolve("src/cli/index.ts");
const tsx = import.meta.resolve("tsx");
async function temporary() {
  return mkdtemp(join(tmpdir(), "ae-cli-"));
}
async function fakeApp(
  dir: string,
  handler: (request: any, socket: any) => void,
) {
  const socket =
    process.platform === "win32"
      ? `\\\\.\\pipe\\ae-cli-test-${process.pid}-${Math.random()}`
      : join(dir, "s");
  const server = createServer((connection) => {
    connection.setEncoding("utf8");
    let input = "";
    connection.on("data", (data) => {
      input += data;
      if (input.includes("\n"))
        handler(JSON.parse(input.split("\n")[0]), connection);
    });
  });
  await new Promise<void>((r, e) => {
    server.once("error", e);
    server.listen(socket, r);
  });
  await writeFile(
    join(dir, "endpoint.json"),
    JSON.stringify({
      socket,
      token: "test-secret",
      pid: process.pid,
      version: "0.1.0",
      protocol: 1,
    }),
    { mode: 0o600 },
  );
  return {
    server,
    close: () =>
      new Promise<void>((r, e) =>
        server.close((error) => (error ? e(error) : r())),
      ),
  };
}
test("transport authenticates the local request and preserves UTF-8 replies", async () => {
  const dir = await temporary();
  const app = await fakeApp(dir, (request, socket) => {
    assert.equal(request.token, "test-secret");
    const data = Buffer.from(
      JSON.stringify({ ok: true, result: { title: "你好 Café" } }) + "\n",
    );
    const middle = data.indexOf(Buffer.from("你")) + 1;
    socket.write(data.subarray(0, middle));
    setTimeout(() => socket.end(data.subarray(middle)), 5);
  });
  try {
    assert.deepEqual(await send({ command: "status" }, { dir }), {
      ok: true,
      result: { title: "你好 Café" },
    });
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("lost reply after delivery is outcome unknown, not a retryable connection error", async () => {
  const dir = await temporary();
  const app = await fakeApp(dir, (_, socket) => socket.end());
  try {
    await assert.rejects(
      send({ command: "apply", requestId: "once" }, { dir }),
      { code: "OUTCOME_UNKNOWN" },
    );
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("CLI input file maps to the same validated request as the MCP contract", async () => {
  const dir = await temporary();
  let received: any;
  const app = await fakeApp(dir, (request, socket) => {
    received = request;
    socket.end(
      JSON.stringify({
        ok: true,
        result: { document: "d", epoch: "e", revision: 1 },
      }) + "\n",
    );
  });
  const payload = {
    operations: [{ op: "create", ref: "a", type: "rectangle", label: "Hello" }],
  };
  await writeFile(join(dir, "batch.json"), JSON.stringify(payload));
  try {
    const { stdout } = await exec(
      process.execPath,
      [
        "--import",
        tsx,
        cli,
        "apply",
        "--no-launch",
        "--document",
        "d",
        "--epoch",
        "e",
        "--expected-revision",
        "0",
        "--request-id",
        "once",
        "--input",
        join(dir, "batch.json"),
        "--json",
      ],
      { env: { ...process.env, AGENT_EXCALIDRAW_DATA_DIR: dir } },
    );
    assert.equal(JSON.parse(stdout).ok, true);
    assert.deepEqual(received.args, payload);
    assert.equal(received.document, "d");
    assert.equal(received.expectedRevision, 0);
    assert.equal(received.requestId, "once");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("MCP enumerates shared commands and invokes the same app protocol", async () => {
  const dir = await temporary();
  let received: any;
  const app = await fakeApp(dir, (request, socket) => {
    received = request;
    socket.end(
      JSON.stringify({
        ok: true,
        result: { document: "d", epoch: "e", revision: 1 },
      }) + "\n",
    );
  });
  const env = Object.fromEntries(
    Object.entries({ ...process.env, AGENT_EXCALIDRAW_DATA_DIR: dir }).filter(
      ([, v]) => typeof v === "string",
    ),
  ) as Record<string, string>;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", tsx, cli, "mcp"],
    env,
    stderr: "pipe",
  });
  const client = new Client({ name: "cli-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((t) => t.name).sort(),
      [...commands.map((c) => c.name.replaceAll("-", "_")), "show_canvas"].sort(),
    );
    const result = await client.callTool({
      name: "apply",
      arguments: {
        document: "d",
        epoch: "e",
        expectedRevision: 0,
        requestId: "mcp-once",
        operations: [{ op: "create", type: "rectangle", label: "MCP" }],
      },
    });
    assert.equal(result.isError, false);
    assert.equal(received.command, "apply");
    assert.equal(received.requestId, "mcp-once");
    assert.equal(received.args.operations[0].label, "MCP");
    const invalid = await client.callTool({
      name: "apply",
      arguments: { operations: [] },
    });
    assert.equal(invalid.isError, true);
    assert.match(JSON.stringify(invalid.content), /INVALID_INPUT/);
  } finally {
    await client.close();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("skill installation has one source, idempotent links and leaves unrelated skills intact", async () => {
  const base = await temporary(),
    home = join(base, "home"),
    dir = join(base, "data");
  await mkdir(home);
  const opts = { home, dir, env: {} };
  try {
    const installed = await installSkills(opts);
    assert.equal(installed.links.length, 3);
    assert(installed.verified);
    assert(new Set(installed.links.map((l) => l.target)).size === 1);
    await installSkills(opts);
    await uninstallSkills(opts);
    for (const link of installed.links)
      await assert.rejects(lstat(link.path), { code: "ENOENT" });
    assert(
      (
        await readFile(join(installed.canonical, "SKILL.md"), "utf8")
      ).startsWith("---"),
    );
    const unrelated = join(home, ".codex", "skills", "agent-excalidraw");
    await mkdir(unrelated);
    await writeFile(join(unrelated, "mine"), "preserve");
    await assert.rejects(installSkills(opts), { code: "SKILL_CONFLICT" });
    assert.equal(await readFile(join(unrelated, "mine"), "utf8"), "preserve");
    const removed = await uninstallSkills(opts);
    assert(removed.kept.includes(unrelated));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
test("existing canonical folder without ownership marker is preserved", async () => {
  const base = await temporary();
  const canonical = join(base, "data", "skills", "agent-excalidraw");
  await mkdir(canonical, { recursive: true });
  await writeFile(join(canonical, "mine"), "keep");
  try {
    await assert.rejects(
      installSkills({
        home: join(base, "home"),
        dir: join(base, "data"),
        env: {},
      }),
      { code: "SKILL_CONFLICT" },
    );
    assert.equal(await readFile(join(canonical, "mine"), "utf8"), "keep");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
test("mutation schema requires live preconditions; every command has discoverable schema", () => {
  assert.throws(() => validateRequest("apply", { operations: [] }), {
    code: "INVALID_INPUT",
  });
  assert.throws(
    () =>
      validateRequest("apply", {
        document: "d",
        epoch: "e",
        expectedRevision: -1,
        requestId: "x",
        operations: [],
      }),
    { code: "INVALID_INPUT" },
  );
  assert.equal(schemaDocument().commands.length, commands.length);
  assert.equal(
    dataDirectory({}, "win32", "C:\\Users\\test"),
    join("C:\\Users\\test", "AppData", "Roaming", "agent-excalidraw"),
  );
});
test("agent operation schema exposes styles and rejects ignored nested or misspelled fields", () => {
  const preconditions = {
    document: "d",
    epoch: "e",
    expectedRevision: 0,
    requestId: "styled",
  };
  const operation = {
    op: "create",
    type: "rectangle",
    ref: "node",
    x: 20,
    y: 30,
    width: 180,
    height: 90,
    strokeColor: "#6965db",
    backgroundColor: "#eeedff",
    fillStyle: "solid",
    strokeStyle: "solid",
    strokeWidth: 2,
    roughness: 1,
    opacity: 95,
    roundness: { type: 3 },
    label: {
      text: "Hello",
      fontFamily: 5,
      fontSize: 20,
      textAlign: "left",
      verticalAlign: "top",
    },
  };
  const request = validateRequest("apply", {
    ...preconditions,
    operations: [operation],
  });
  assert.deepEqual(request.args?.operations, [operation]);
  assert.throws(
    () =>
      validateRequest("apply", {
        ...preconditions,
        operations: [
          {
            op: "create",
            type: "rectangle",
            style: { strokeColor: "#ff0000" },
          },
        ],
      }),
    (error) =>
      (error as any).code === "INVALID_INPUT" &&
      /Put style fields/.test((error as Error).message),
  );
  assert.throws(
    () =>
      validateRequest("apply", {
        ...preconditions,
        operations: [{ op: "update", id: "a", stokeColor: "#ff0000" }],
      }),
    (error) =>
      (error as any).code === "INVALID_INPUT" &&
      /stokeColor/.test((error as Error).message),
  );
  assert.throws(
    () =>
      validateRequest("apply", {
        ...preconditions,
        operations: [{ op: "delete", id: "a", backgroundColor: "#ff0000" }],
      }),
    { code: "INVALID_INPUT" },
  );
  assert.throws(
    () =>
      validateRequest("apply", {
        ...preconditions,
        operations: [
          { op: "create", type: "text", text: "Hello", label: "Ignored" },
        ],
      }),
    { code: "INVALID_INPUT" },
  );
  assert.throws(
    () =>
      validateRequest("apply", {
        ...preconditions,
        operations: [{ op: "create", type: "text" }],
      }),
    { code: "INVALID_INPUT" },
  );
  assert.throws(
    () =>
      validateRequest("apply", {
        ...preconditions,
        operations: [{ op: "create", type: "rectangle", fontFamily: 4 }],
      }),
    { code: "INVALID_INPUT" },
  );
  const updated = validateRequest("apply", {
    ...preconditions,
    operations: [
      {
        op: "update",
        id: "a",
        label: {
          text: "Updated",
          fontFamily: 6,
          fontSize: 24,
          textAlign: "right",
          verticalAlign: "bottom",
        },
      },
    ],
  });
  assert.equal(updated.args?.operations[0].label.fontFamily, 6);
  const published = JSON.stringify(
    schemaDocument().commands.find((c) => c.name === "apply")?.inputSchema,
  );
  for (const key of [
    "strokeColor",
    "backgroundColor",
    "fillStyle",
    "roundness",
    "fontFamily",
    "fontSize",
    "textAlign",
    "verticalAlign",
    "points",
  ])
    assert(published.includes('"' + key + '"'));
  assert(published.includes('"additionalProperties":false'));
});
test("render schema advertises exact bounds, transparency, selection and explicit scene embedding", () => {
  const base = { document: "d", epoch: "e", output: "/tmp/render.png" };
  assert.deepEqual(
    validateRequest("render", {
      ...base,
      scale: 4,
      background: false,
      embedScene: true,
      selection: true,
    }).args,
    {
      output: "/tmp/render.png",
      background: false,
      embedScene: true,
      scale: 4,
      selection: true,
    },
  );
  for (const scale of [0, 0.09, 4.01, 5])
    assert.throws(() => validateRequest("render", { ...base, scale }), {
      code: "INVALID_INPUT",
    });
  assert.equal(
    validateRequest("render", { ...base, scale: 0.1 }).args?.scale,
    0.1,
  );
  const inputSchema = schemaDocument().commands.find(
    (c) => c.name === "render",
  )!.inputSchema as any;
  assert.equal(inputSchema.properties.scale.minimum, 0.1);
  assert.equal(inputSchema.properties.scale.maximum, 4);
  assert.equal(inputSchema.properties.embedScene.type, "boolean");
  assert.equal(inputSchema.properties.background.type, "boolean");
  const snapshot = validateRequest("snapshot", {
    selection: true,
    group: "g",
    region: { x: 0, y: 0, width: 100, height: 100 },
  });
  assert.equal(snapshot.args?.group, "g");
  assert.equal(snapshot.args?.selection, true);
});
test("CLI --no-background sends false and leaves input-file false intact without a flag", async () => {
  const dir = await temporary();
  const received: any[] = [];
  const app = await fakeApp(dir, (request, socket) => {
    received.push(request);
    socket.end(
      JSON.stringify({ ok: true, result: { output: "/tmp/render.png" } }) +
        "\n",
    );
  });
  const env = { ...process.env, AGENT_EXCALIDRAW_DATA_DIR: dir };
  try {
    await exec(
      process.execPath,
      [
        "--import",
        tsx,
        cli,
        "render",
        "--no-launch",
        "--document",
        "d",
        "--epoch",
        "e",
        "--output",
        "/tmp/render.png",
        "--no-background",
        "--embed-scene",
        "--scale",
        "2",
        "--json",
      ],
      { env },
    );
    assert.equal(received[0].args.background, false);
    assert.equal(received[0].args.embedScene, true);
    assert.equal(received[0].args.scale, 2);
    assert(!("editable" in received[0].args));
    await writeFile(
      join(dir, "render.json"),
      JSON.stringify({
        document: "d",
        epoch: "e",
        output: "/tmp/render.png",
        background: false,
        embedScene: false,
      }),
    );
    await exec(
      process.execPath,
      [
        "--import",
        tsx,
        cli,
        "render",
        "--no-launch",
        "--input",
        join(dir, "render.json"),
        "--json",
      ],
      { env },
    );
    assert.equal(received[1].args.background, false);
    assert.equal(received[1].args.embedScene, false);
    await exec(
      process.execPath,
      [
        "--import",
        tsx,
        cli,
        "render",
        "--no-launch",
        "--document",
        "d",
        "--epoch",
        "e",
        "--output",
        "/tmp/render.png",
        "--background",
        "--json",
      ],
      { env },
    );
    assert.equal(received[2].args.background, true);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("unknown domain arguments are rejected by name and layout coordinates are discoverable", () => {
  assert.throws(
    () =>
      validateRequest("new", { title: "Trial", project_dir: "/tmp/project" }),
    (error) =>
      (error as any).code === "INVALID_INPUT" &&
      /project_dir/.test((error as Error).message),
  );
  const schema = schemaDocument().commands.find(
    (command) => command.name === "new",
  )!.inputSchema as any;
  assert.equal(schema.additionalProperties, false);
  const layout = validateRequest("layout", {
    document: "d",
    epoch: "e",
    expectedRevision: 0,
    requestId: "layout",
    x: 20,
    y: 40,
  });
  assert.equal(layout.args?.x, 20);
  assert.equal(layout.args?.y, 40);
});
test("explicit skill home isolates every root despite inherited host settings, with mutation-free preview", async () => {
  const dir = await temporary();
  const selectedHome = join(dir, "isolated-home"),
    store = join(dir, "isolated-data");
  const actualRoots = roots();
  async function snapshotGlobals() {
    const result: any = {};
    for (const [host, path] of Object.entries(actualRoots)) {
      try {
        const info = await lstat(path);
        result[host] = {
          mode: info.mode,
          ino: info.ino,
          mtime: info.mtimeMs,
          entries: (await readdir(path)).sort(),
        };
        const target = join(path, "agent-excalidraw");
        try {
          const targetInfo = await lstat(target);
          result[host].skill = {
            mode: targetInfo.mode,
            ino: targetInfo.ino,
            mtime: targetInfo.mtimeMs,
          };
        } catch (error: any) {
          result[host].skill = error.code;
        }
      } catch (error: any) {
        result[host] = { error: error.code };
      }
    }
    return result;
  }
  const before = await snapshotGlobals();
  // The child inherits real host roots deliberately. --home must override all of
  // them; --data-dir must also override the inherited canonical-source setting.
  const env = {
    ...process.env,
    AGENTS_HOME: resolve(actualRoots.agents, ".."),
    CODEX_HOME: resolve(actualRoots.codex, ".."),
    CLAUDE_CONFIG_DIR: resolve(actualRoots.claude, ".."),
    AGENT_EXCALIDRAW_DATA_DIR: join(dir, "inherited-data"),
  };
  const args = [
    "--home",
    selectedHome,
    "--data-dir",
    store,
    "--hosts",
    "agents,codex,claude",
    "--json",
  ];
  try {
    const preview = JSON.parse(
      (
        await exec(
          process.execPath,
          ["--import", tsx, cli, "skills", "install", ...args, "--dry-run"],
          { env, cwd: dir },
        )
      ).stdout,
    );
    assert.equal(preview.ok, true);
    assert.equal(preview.result.dryRun, true);
    assert.equal(
      preview.result.canonical,
      join(store, "skills", "agent-excalidraw"),
    );
    assert.deepEqual(
      preview.result.links.map((l: any) => l.path),
      [".agents", ".codex", ".claude"].map((host) =>
        join(selectedHome, host, "skills", "agent-excalidraw"),
      ),
    );
    await assert.rejects(lstat(selectedHome), { code: "ENOENT" });
    await assert.rejects(lstat(store), { code: "ENOENT" });
    const installed = JSON.parse(
      (
        await exec(
          process.execPath,
          ["--import", tsx, cli, "skills", "install", ...args],
          { env, cwd: dir },
        )
      ).stdout,
    );
    assert.equal(installed.ok, true);
    assert.equal(installed.result.verified, true);
    const canonical = await realpath(installed.result.canonical);
    for (const link of installed.result.links) {
      assert((await lstat(link.path)).isSymbolicLink());
      assert.equal(await realpath(link.path), canonical);
    }
    await exec(
      process.execPath,
      ["--import", tsx, cli, "skills", "install", ...args],
      { env, cwd: dir },
    );
    const removalPreview = JSON.parse(
      (
        await exec(
          process.execPath,
          [
            "--import",
            tsx,
            cli,
            "skills",
            "uninstall",
            ...args,
            "--dry-run",
            "--remove-source",
          ],
          { env, cwd: dir },
        )
      ).stdout,
    );
    assert.equal(removalPreview.result.wouldRemove.length, 3);
    for (const link of installed.result.links)
      assert((await lstat(link.path)).isSymbolicLink());
    const removed = JSON.parse(
      (
        await exec(
          process.execPath,
          [
            "--import",
            tsx,
            cli,
            "skills",
            "uninstall",
            ...args,
            "--remove-source",
          ],
          { env, cwd: dir },
        )
      ).stdout,
    );
    assert.equal(removed.result.removed.length, 3);
    assert.equal(removed.result.sourceRemoved, true);
    for (const link of installed.result.links)
      await assert.rejects(lstat(link.path), { code: "ENOENT" });
    await assert.rejects(lstat(installed.result.canonical), { code: "ENOENT" });
    await assert.rejects(lstat(env.AGENT_EXCALIDRAW_DATA_DIR), {
      code: "ENOENT",
    });
    assert.deepEqual(await snapshotGlobals(), before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("skill host choices reject unknown, inherited prototype names and empty selections before mutation", async () => {
  const dir = await temporary(),
    home = join(dir, "home"),
    store = join(dir, "data");
  try {
    for (const hosts of [["other"], ["__proto__"], ["toString"], [""], []])
      await assert.rejects(
        installSkills({ home, dir: store, hosts, dryRun: true }),
        { code: "UNKNOWN_HOST" },
      );
    await assert.rejects(lstat(home), { code: "ENOENT" });
    await assert.rejects(lstat(store), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("removing a source still used by an unselected host preserves every owned link", async () => {
  const dir = await temporary(),
    options = { home: join(dir, "home"), dir: join(dir, "data") };
  try {
    const installed = await installSkills({
      ...options,
      hosts: ["codex", "claude"],
    });
    await assert.rejects(
      uninstallSkills({ ...options, hosts: ["codex"], removeSource: true }),
      { code: "SKILL_SOURCE_IN_USE" },
    );
    for (const link of installed.links)
      assert((await lstat(link.path)).isSymbolicLink());
    assert((await lstat(installed.canonical)).isDirectory());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("public skill help exposes isolation and command help states only its actual preconditions", async () => {
  const skillsHelp = (
    await exec(process.execPath, [
      "--import",
      tsx,
      cli,
      "skills",
      "install",
      "--help",
    ])
  ).stdout;
  for (const term of [
    "--home",
    "--data-dir",
    "--dry-run",
    "AGENT_EXCALIDRAW_DATA_DIR",
    "CODEX_HOME",
    "/tmp/excalidraw-trial",
  ])
    assert(skillsHelp.includes(term));
  const newHelp = (
    await exec(process.execPath, ["--import", tsx, cli, "new", "--help"])
  ).stdout;
  assert(
    newHelp.includes("No document, epoch, revision or request ID is required."),
  );
  assert(!newHelp.includes("This scene mutation requires"));
  const saveHelp = (
    await exec(process.execPath, ["--import", tsx, cli, "save", "--help"])
  ).stdout;
  assert(saveHelp.includes("This command requires document and epoch"));
  assert(saveHelp.includes("does not require expectedRevision or requestId"));
  const applyHelp = (
    await exec(process.execPath, ["--import", tsx, cli, "apply", "--help"])
  ).stdout;
  assert(
    applyHelp.includes(
      "This scene mutation requires document, epoch, expectedRevision and requestId",
    ),
  );
});
test("unknown flags and missing option values return structured JSON errors while help remains successful", async () => {
  for (const args of [
    ["new", "--json", "--project_dir", "/tmp/never-created"],
    ["new", "--json", "--path"],
  ]) {
    try {
      await exec(process.execPath, ["--import", tsx, cli, ...args]);
      assert.fail("invalid arguments must fail");
    } catch (error: any) {
      assert.equal(error.code, 1);
      const reply = JSON.parse(error.stdout);
      assert.equal(reply.ok, false);
      assert.equal(reply.error.code, "INVALID_ARGUMENT");
      assert.match(
        reply.error.message,
        args.includes("--project_dir") ? /project_dir/ : /path/,
      );
      assert.equal(error.stderr, "");
    }
  }
  const help = await exec(process.execPath, [
    "--import",
    tsx,
    cli,
    "new",
    "--help",
    "--json",
  ]);
  assert(help.stdout.includes("Usage:"));
  assert.equal(help.stderr, "");
  const version = await exec(process.execPath, [
    "--import",
    tsx,
    cli,
    "--version",
  ]);
  assert.equal(version.stdout.trim(), VERSION);
});
test("shared canonical skill records both homes and refuses source removal until the other home disconnects", async () => {
  const dir = await temporary(),
    store = join(dir, "data"),
    first = { home: join(dir, "first"), dir: store, hosts: ["codex"] },
    second = { home: join(dir, "second"), dir: store, hosts: ["claude"] };
  try {
    const a = await installSkills(first),
      b = await installSkills(second);
    const markerPath = join(a.canonical, ".agent-excalidraw-owned.json");
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    assert(marker.links.includes(a.links[0].path));
    assert(marker.links.includes(b.links[0].path));
    for (const dryRun of [true, false])
      await assert.rejects(
        uninstallSkills({ ...first, removeSource: true, dryRun }),
        (error) =>
          (error as any).code === "SKILL_SOURCE_IN_USE" &&
          (error as Error).message.includes(b.links[0].path),
      );
    assert((await lstat(a.links[0].path)).isSymbolicLink());
    assert((await lstat(b.links[0].path)).isSymbolicLink());
    assert((await lstat(a.canonical)).isDirectory());
    await uninstallSkills(second);
    await assert.rejects(lstat(b.links[0].path), { code: "ENOENT" });
    const updated = JSON.parse(await readFile(markerPath, "utf8"));
    assert(!updated.links.includes(b.links[0].path));
    assert(updated.links.includes(a.links[0].path));
    const removed = await uninstallSkills({ ...first, removeSource: true });
    assert.equal(removed.sourceRemoved, true);
    await assert.rejects(lstat(a.canonical), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("recorded marker paths are inspection hints: live unselected links block removal but are never unlinked", async () => {
  const dir = await temporary(),
    options = {
      home: join(dir, "home"),
      dir: join(dir, "data"),
      hosts: ["codex"],
    };
  try {
    const installed = await installSkills(options),
      external = join(dir, "unselected-external-link"),
      sentinel = join(dir, "unrelated.txt");
    await writeFile(sentinel, "preserve");
    await symlink(
      installed.canonical,
      external,
      process.platform === "win32" ? "junction" : "dir",
    );
    const markerPath = join(
        installed.canonical,
        ".agent-excalidraw-owned.json",
      ),
      marker = JSON.parse(await readFile(markerPath, "utf8"));
    marker.links.push(
      external,
      sentinel,
      "relative-path",
      { path: "invalid" },
      null,
    );
    await writeFile(markerPath, JSON.stringify(marker));
    await assert.rejects(uninstallSkills({ ...options, removeSource: true }), {
      code: "SKILL_SOURCE_IN_USE",
    });
    assert((await lstat(external)).isSymbolicLink());
    assert((await lstat(installed.links[0].path)).isSymbolicLink());
    assert.equal(await readFile(sentinel, "utf8"), "preserve");
    // Ordinary unlink only removes the explicitly selected host, despite the
    // untrusted marker recording another path that also points at our source.
    await uninstallSkills(options);
    await assert.rejects(lstat(installed.links[0].path), { code: "ENOENT" });
    assert((await lstat(external)).isSymbolicLink());
    assert.equal(await readFile(sentinel, "utf8"), "preserve");
    assert((await lstat(installed.canonical)).isDirectory());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("aliased agent root directories remove one selected physical link without a false source-in-use error", async () => {
  const dir = await temporary(),
    home = join(dir, "home"),
    data = join(dir, "data");
  try {
    await mkdir(join(home, ".agents", "skills"), { recursive: true });
    await mkdir(join(home, ".codex"), { recursive: true });
    await symlink(
      join(home, ".agents", "skills"),
      join(home, ".codex", "skills"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const installed = await installSkills({
      home,
      dir: data,
      hosts: ["agents", "codex"],
    });
    assert.equal(
      await realpath(installed.links[0].path),
      await realpath(installed.links[1].path),
    );
    const removed = await uninstallSkills({
      home,
      dir: data,
      hosts: ["agents", "codex"],
      removeSource: true,
    });
    assert(removed.sourceRemoved);
    for (const link of installed.links)
      await assert.rejects(lstat(link.path), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("list pagination and search remain discoverable through the public CLI contract", async () => {
  const request = validateRequest("list", {
    query: "onboarding",
    offset: 50,
    limit: 100,
  });
  assert.deepEqual(request.args, {
    query: "onboarding",
    offset: 50,
    limit: 100,
  });
  assert.throws(() => validateRequest("list", { offset: -1 }), {
    code: "INVALID_INPUT",
  });
  assert.throws(() => validateRequest("list", { limit: 501 }), {
    code: "INVALID_INPUT",
  });
  const help = (
    await exec(process.execPath, ["--import", tsx, cli, "list", "--help"])
  ).stdout;
  for (const flag of ["--query", "--offset", "--limit"])
    assert(help.includes(flag));
  assert(help.includes("nextOffset"));
});
test("install --version selects the requested release instead of invoking the root version flag", async () => {
  const directory = await temporary();
  const hook = join(directory, "fake-release-fetch.mjs");
  const fetchLog = join(directory, "requested-release.txt");
  await writeFile(
    hook,
    `
    import { appendFile } from 'node:fs/promises';
    globalThis.fetch = async (url) => {
      await appendFile(process.env.AGENT_EXCALIDRAW_FETCH_TEST_LOG, String(url) + '\\n');
      return new Response('{"message":"Not Found"}', { status: 404 });
    };
  `,
  );
  const argumentsBeforeCommand = [
    "--import",
    tsx,
    "--import",
    pathToFileURL(hook).href,
    cli,
  ];
  const env = { ...process.env, AGENT_EXCALIDRAW_FETCH_TEST_LOG: fetchLog };
  async function failedJson(args: string[]) {
    try {
      await exec(process.execPath, [...argumentsBeforeCommand, ...args], {
        env,
      });
      assert.fail("This invocation must fail with a structured error");
    } catch (error: any) {
      assert.equal(error.code, 1);
      assert.equal(error.stderr, "");
      return JSON.parse(error.stdout);
    }
  }
  try {
    const requested = await failedJson([
      "install",
      "--version",
      "0.1.37",
      "--json",
    ]);
    assert.equal(requested.ok, false);
    assert.equal(requested.error.code, "RELEASE_NOT_AVAILABLE");
    assert.equal(
      (await readFile(fetchLog, "utf8")).trim(),
      "https://api.github.com/repos/ralfboltshauser/agent-excalidraw/releases/tags/v0.1.37",
    );
    const rootVersion = await exec(
      process.execPath,
      [...argumentsBeforeCommand, "--version"],
      { env },
    );
    assert.equal(rootVersion.stdout.trim(), VERSION);
    assert.equal(rootVersion.stderr, "");
    const explicitVersion = await exec(
      process.execPath,
      [...argumentsBeforeCommand, "version", "--json"],
      { env },
    );
    assert.equal(JSON.parse(explicitVersion.stdout).result.version, VERSION);
    const missing = await failedJson(["install", "--version", "--json"]);
    assert.equal(missing.error.code, "INVALID_ARGUMENT");
    assert.match(missing.error.message, /version/);
    const unknown = await failedJson([
      "install",
      "--unknown-install-flag",
      "--json",
    ]);
    assert.equal(unknown.error.code, "INVALID_ARGUMENT");
    assert.match(unknown.error.message, /unknown-install-flag/);
    // All other parser paths above must complete without attempting a download.
    assert.equal(
      (await readFile(fetchLog, "utf8")).trim().split("\n").length,
      1,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
