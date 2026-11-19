#!/usr/bin/env node
import { Command, Option, InvalidArgumentError } from "commander";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { commands } from "../shared/commands.js";
import { failure, success, AppError, type Reply } from "../shared/types.js";
import {
  dataDirectory,
  endpoint,
  launchApp,
  requestApp,
  VERSION,
} from "./transport.js";
import { schemaDocument, validateRequest, shapeFor } from "./schema.js";
import { coreInstructions } from "./core.js";
import { installSkills, uninstallSkills, roots } from "./skills.js";
import { installApp } from "./installer.js";

function output(reply: Reply, json: boolean) {
  if (json) {
    console.log(JSON.stringify(reply));
  } else if (!reply.ok) {
    console.error(`${reply.error.code}: ${reply.error.message}`);
  } else if (typeof reply.result === "string") console.log(reply.result);
  else console.log(JSON.stringify(reply.result, null, 2));
  if (!reply.ok) process.exitCode = 1;
}
async function inputFile(path: string) {
  let raw: string;
  if (path === "-") {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      size += Buffer.byteLength(chunk);
      if (size > 8 * 1024 * 1024)
        throw new AppError("INPUT_TOO_LARGE", "Input exceeds 8 MiB.");
      chunks.push(Buffer.from(chunk));
    }
    raw = Buffer.concat(chunks).toString();
  } else {
    const absolute = resolve(path);
    if ((await stat(absolute)).size > 8 * 1024 * 1024)
      throw new AppError("INPUT_TOO_LARGE", "Input exceeds 8 MiB.");
    raw = await readFile(absolute, "utf8");
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError(
      "INVALID_INPUT",
      "Input must be valid JSON. Use an object with command arguments, or an operation array for apply.",
    );
  }
}
function decorate(command: Command, name: string) {
  command
    .option("--json", "Print a machine-readable Reply envelope")
    .option("--input <path>", "Read arguments from JSON file; use - for stdin")
    .option("--document <id>", "Target the returned document ID")
    .option("--epoch <epoch>", "Expected runtime document epoch")
    .option("--expected-revision <n>", "Expected live content revision", (v) =>
      Number(v),
    )
    .option("--request-id <id>", "Unique ID for this exact operation")
    .option("--session <name>", "Agent session name")
    .option("--no-launch", "Do not launch a stopped app");
  const shape = shapeFor(name);
  for (const key of Object.keys(shape)) {
    if (
      [
        "document",
        "epoch",
        "expectedRevision",
        "requestId",
        "session",
      ].includes(key)
    )
      continue;
    const flag = key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
    if (key === "background")
      command
        .option("--background", shape[key].description || key)
        .option(
          "--no-background",
          "Create a transparent export without the canvas background",
        )
        .setOptionValue("background", undefined);
    else if (["compact", "embedScene", "selection", "focus"].includes(key))
      command.option(`--${flag}`, shape[key].description || key);
    else if (["ids"].includes(key))
      command.option(`--${flag} <ids>`, "Comma-separated stable IDs", (v) =>
        v.split(",").filter(Boolean),
      );
    else if (
      [
        "zoom",
        "scrollX",
        "scrollY",
        "scale",
        "gap",
        "offset",
        "limit",
        "x",
        "y",
      ].includes(key)
    )
      command.option(`--${flag} <number>`, shape[key].description || key, (v) =>
        Number(v),
      );
    else if (key !== "operations" && key !== "region")
      command.option(`--${flag} <value>`, shape[key].description || key);
  }
  const preconditions = ["apply", "layout", "revert-last-agent-batch"].includes(
    name,
  )
    ? "This scene mutation requires document, epoch, expectedRevision and requestId from a current snapshot."
    : shape.document && !shape.document.isOptional()
      ? "This command requires document and epoch from a current snapshot. It does not require expectedRevision or requestId."
      : ["new", "open", "path-suggest"].includes(name)
        ? "No document, epoch, revision or request ID is required. An explicit path wins; new allocates a file and open uses an existing file."
        : "No scene-mutation preconditions are required. See the input contract for optional targeting and filters.";
  command.addHelpText(
    "after",
    () =>
      `\nInput contract:\n${JSON.stringify(schemaDocument().commands.find((c) => c.name === name)?.inputSchema, null, 2)}\n\n${preconditions}\n`,
  );
  command.action(async () => {
    const options = command.opts();
    try {
      let payload: any = options.input ? await inputFile(options.input) : {};
      if (Array.isArray(payload)) {
        if (name !== "apply")
          throw new AppError(
            "INVALID_INPUT",
            "An array input is supported only for apply.",
          );
        payload = { operations: payload };
      }
      if (!payload || typeof payload !== "object")
        throw new AppError(
          "INVALID_INPUT",
          "Command input must be a JSON object.",
        );
      // Permit a saved Request envelope as well as the concise args-only form.
      if (payload.args) {
        if (payload.command !== undefined && payload.command !== name)
          throw new AppError(
            "INVALID_INPUT",
            `Input envelope command ${payload.command} does not match ${name}.`,
          );
        const { args, command: inputCommand, ...envelope } = payload;
        payload = { ...args, ...envelope };
      }
      const { json, input, launch, ...overrides } = options;
      payload = {
        ...payload,
        ...Object.fromEntries(
          Object.entries(overrides).filter(([, value]) => value !== undefined),
        ),
      };
      const request = validateRequest(name, payload);
      output(
        await requestApp(request, {
          launch: !["status", "quit"].includes(name) && launch !== false,
        }),
        !!json,
      );
    } catch (error: any) {
      if (error.name === "ZodError")
        error = new AppError(
          "INVALID_INPUT",
          error.issues
            .map((i: any) => `${i.path.join(".") || "input"}: ${i.message}`)
            .join("; "),
        );
      if (
        name === "quit" &&
        ["APP_NOT_RUNNING", "APP_UNAVAILABLE"].includes(error.code)
      )
        output(success({ closed: true, alreadyClosed: true }), !!options.json);
      else output(failure(error), !!options.json);
    }
  });
}
export async function main(argv = process.argv) {
  const jsonRequested = argv.includes("--json");
  // Keep root flags scoped before a subcommand: install --version names an app
  // release, while a root --version only prints this CLI version.
  const program = new Command()
    .enablePositionalOptions()
    .name("agent-excalidraw")
    .description(
      "Local Excalidraw for people and agents. Full CLI; optional MCP.",
    )
    .version(VERSION)
    .showHelpAfterError()
    .exitOverride();
  if (jsonRequested) program.configureOutput({ writeErr: () => {} });
  program.addHelpText(
    "after",
    "\nFirst use: agent-excalidraw launch\nAgent guide: agent-excalidraw skills get core\nDiscover exact JSON contracts: agent-excalidraw schema\n",
  );
  for (const command of commands)
    decorate(
      program.command(command.name).description(command.description),
      command.name,
    );
  const path = program
    .command("path")
    .description("Choose a deterministic local drawing location");
  decorate(
    path
      .command("suggest")
      .description("Suggest a location without creating a file"),
    "path-suggest",
  );
  const operation = program
    .command("operation")
    .description("Reconcile uncertain results");
  decorate(
    operation
      .command("status")
      .description("Look up a request in the current epoch"),
    "operation-status",
  );
  program
    .command("launch")
    .description("Launch the workspace without creating a drawing")
    .option("--json")
    .action(async (opts) => {
      try {
        await launchApp();
        output(success({ launched: true }), !!opts.json);
      } catch (error) {
        output(failure(error), !!opts.json);
      }
    });
  program
    .command("version")
    .description("Print the installed CLI version")
    .option("--json")
    .action((opts) =>
      output(success({ version: VERSION, protocol: 1 }), !!opts.json),
    );
  program
    .command("schema")
    .description("Print all command input schemas without launching the app")
    .option("--json")
    .action((opts) => output(success(schemaDocument()), !!opts.json));
  program
    .command("doctor")
    .description(
      "Diagnose install, discovery and app availability without launching",
    )
    .option("--json")
    .action(async (opts) => {
      let ep: any;
      try {
        const value = await endpoint();
        ep = {
          available: true,
          version: value.version,
          protocol: value.protocol,
          pid: value.pid,
        };
      } catch (error: any) {
        ep = { available: false, code: error.code, message: error.message };
      }
      let running: Reply | undefined;
      if (ep.available) {
        try {
          running = await requestApp(
            { command: "status" },
            { launch: false, timeout: 3000 },
          );
        } catch (error) {
          running = failure(error);
        }
      }
      output(
        success({
          cliVersion: VERSION,
          nodeVersion: process.version,
          platform: process.platform,
          architecture: process.arch,
          dataDirectory: dataDirectory(),
          endpoint: ep,
          app: running,
          skillRoots: roots(),
          remoteHost: !!(
            process.env.SSH_CONNECTION || process.env.WSL_DISTRO_NAME
          ),
          remoteHostNote:
            "The CLI must run on the same host as the desktop. Remote/WSL environments are not bridged automatically.",
        }),
        !!opts.json,
      );
    });
  const skills = program
    .command("skills")
    .description("Version-matched guide and one-source skill discovery");
  skills
    .command("get [name]")
    .description("Read instructions for this installed CLI version")
    .action((name = "core") => {
      if (name !== "core")
        throw new AppError(
          "UNKNOWN_GUIDE",
          "Only the core guide is available.",
        );
      console.log(coreInstructions);
    });
  const skillHelp = `
Default links use AGENTS_HOME/skills, CODEX_HOME/skills and CLAUDE_CONFIG_DIR/skills when configured; otherwise ~/.agents/skills, ~/.codex/skills and ~/.claude/skills.
--home overrides all three agent-root environment settings. --data-dir controls the canonical source and overrides AGENT_EXCALIDRAW_DATA_DIR. With --home, the default canonical app-data directory is also derived from that home unless AGENT_EXCALIDRAW_DATA_DIR is set.
Preview a fully isolated installation without changing global skills:
  agent-excalidraw skills install --home /tmp/excalidraw-trial --data-dir /tmp/excalidraw-trial/app-data --hosts codex,claude --dry-run --json
Remove --dry-run to install there; use the same --home and --data-dir when uninstalling.
`;
  function skillOptions(command: Command) {
    return command
      .option(
        "--hosts <names>",
        "Comma-separated selection: agents,codex,claude",
        "agents,codex,claude",
      )
      .option(
        "--home <path>",
        "Place all selected agent roots under this home; ignore inherited host-root settings",
      )
      .option(
        "--data-dir <path>",
        "Canonical source app-data directory; overrides AGENT_EXCALIDRAW_DATA_DIR",
      )
      .option(
        "--dry-run",
        "Preview exact source and link paths without changing files",
      )
      .option("--json")
      .addHelpText("after", skillHelp);
  }
  skillOptions(
    skills
      .command("install")
      .description(
        "Install one canonical skill and link it into selected host folders",
      ),
  ).action(async (opts) => {
    try {
      output(
        success(
          await installSkills({
            hosts: opts.hosts.split(",").map((host: string) => host.trim()),
            home: opts.home,
            dir: opts.dataDir,
            dryRun: opts.dryRun,
          }),
        ),
        !!opts.json,
      );
    } catch (error) {
      output(failure(error), !!opts.json);
    }
  });
  skillOptions(
    skills
      .command("uninstall")
      .description("Remove only owned links; preserve drawings")
      .option(
        "--remove-source",
        "Also remove the owned canonical source when no selected host still needs it",
      ),
  ).action(async (opts) => {
    try {
      output(
        success(
          await uninstallSkills({
            hosts: opts.hosts.split(",").map((host: string) => host.trim()),
            home: opts.home,
            dir: opts.dataDir,
            dryRun: opts.dryRun,
            removeSource: opts.removeSource,
          }),
        ),
        !!opts.json,
      );
    } catch (error) {
      output(failure(error), !!opts.json);
    }
  });
  program
    .command("install")
    .description("Download and verify a compatible released desktop app")
    .addOption(
      new Option("--version <version>", "Specific app release version")
        .default(VERSION)
        .argParser((value) => {
          if (value.startsWith("-"))
            throw new InvalidArgumentError(
              "Expected a release version after --version, not another option.",
            );
          return value;
        }),
    )
    .option("--json")
    .action(async (opts) => {
      try {
        output(
          success(await installApp({ version: opts.version })),
          !!opts.json,
        );
      } catch (error) {
        output(failure(error), !!opts.json);
      }
    });
  program
    .command("mcp")
    .description("Expose the same drawing commands over MCP stdio")
    .action(async () => {
      const { runMcp } = await import("./mcp.js");
      await runMcp();
    });
  if (argv.length <= 2) {
    program.outputHelp();
    return;
  }
  try {
    await program.parseAsync(argv);
  } catch (error: any) {
    if (typeof error.code === "string" && error.code.startsWith("commander.")) {
      if (error.exitCode === 0) return;
      if (jsonRequested)
        output(
          failure(
            new AppError(
              "INVALID_ARGUMENT",
              error.message.replace(/^error:\s*/, ""),
            ),
          ),
          true,
        );
      else process.exitCode = error.exitCode || 1;
      return;
    }
    throw error;
  }
}
main().catch((error) => {
  output(failure(error), process.argv.includes("--json"));
});
