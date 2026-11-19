import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  getUiCapability,
  RESOURCE_MIME_TYPE,
  RESOURCE_URI_META_KEY,
} from "@modelcontextprotocol/ext-apps/server";
import {
  AppError,
  failure,
  type Reply,
  type Request,
} from "../shared/types.js";
import { requestApp } from "./transport.js";

export const CANVAS_RESOURCE = "ui://agent-excalidraw/viewer-v1.html";
const identity = z
  .object({
    document: z.string().min(1).max(256),
    epoch: z.string().min(1).max(256),
  })
  .strict();
const readInput = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("head"),
      viewId: z.string().uuid(),
      afterStateToken: z.string().max(256).optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal("chunk"),
      viewId: z.string().uuid(),
      captureId: z.string().uuid(),
      offset: z.number().int().nonnegative(),
      byteCount: z.number().int().min(1).max(65536),
    })
    .strict(),
]);
const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const fallback =
  "Inline canvas is unavailable in this client. Use snapshot and render, or continue in the Agent Excalidraw desktop app. The CLI workflow needs no MCP App UI.";

type Options = {
  capabilities: () => unknown;
  request?: (request: Request) => Promise<Reply>;
  html?: () => Promise<string>;
};
/** One presentation adapter; no host-name branches or domain-tool rewrites. */
export function createCanvasMcp(options: Options) {
  const scope = randomUUID();
  const request =
    options.request ||
    ((input: Request) => requestApp(input, { launch: false }));
  const html =
    options.html ||
    (() =>
      readFile(new URL("../embedded/viewer.html", import.meta.url), "utf8"));
  const supported = () =>
    getUiCapability(options.capabilities() as any)?.mimeTypes?.includes(
      RESOURCE_MIME_TYPE,
    ) === true;
  const tools = () => [
    {
      name: "show_canvas",
      title: "Show canvas",
      description:
        "Show a live read-only mirror of this explicit document and epoch. Open/snapshot the drawing first. Other clients receive ordinary CLI/desktop guidance.",
      inputSchema: z.toJSONSchema(identity),
      annotations,
      ...(supported()
        ? {
            _meta: {
              ui: { resourceUri: CANVAS_RESOURCE, visibility: ["model"] },
              [RESOURCE_URI_META_KEY]: CANVAS_RESOURCE,
            },
          }
        : {}),
    },
    ...(supported()
      ? [
          {
            name: "canvas_read",
            title: "Read canvas preview",
            description:
              "Read a document-bound in-memory preview. This does not save, export, launch, switch or edit a drawing.",
            inputSchema: {
              ...z.toJSONSchema(readInput),
              type: "object" as const,
            },
            annotations,
            _meta: { ui: { visibility: ["app"] } },
          },
        ]
      : []),
  ];
  const errorResult = (error: unknown) => {
    const reply = failure(error);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(reply) }],
      structuredContent: reply,
      isError: true,
    };
  };
  async function call(name: string, input: unknown) {
    try {
      if (name === "show_canvas") {
        const args = identity.parse(input);
        if (!supported())
          return {
            content: [{ type: "text" as const, text: fallback }],
            structuredContent: {
              ok: true,
              result: { mode: "desktop", message: fallback },
            },
            isError: false,
          };
        const reply = await request({
          command: "presentation-open",
          document: args.document,
          epoch: args.epoch,
          args: { scope },
        });
        if (!reply.ok) {
          if (["UNKNOWN_COMMAND", "INVALID_INPUT"].includes(reply.error.code))
            throw new AppError(
              "VIEW_NOT_SUPPORTED",
              "This desktop version does not support embedded previews. Keep drawing with the CLI or update the desktop app after saving your work.",
            );
          return {
            content: [{ type: "text" as const, text: JSON.stringify(reply) }],
            structuredContent: reply,
            isError: true,
          };
        }
        const binding = reply.result;
        if (
          binding?.protocol !== 1 ||
          binding.document !== args.document ||
          binding.epoch !== args.epoch ||
          !z.string().uuid().safeParse(binding.viewId).success ||
          typeof binding.title !== "string" ||
          !Number.isFinite(binding.expiresAt)
        )
          throw new AppError(
            "INVALID_REPLY",
            "The desktop returned an incompatible viewer binding.",
          );
        const safeBinding = {
          protocol: 1,
          viewId: binding.viewId,
          document: args.document,
          epoch: args.epoch,
          title: binding.title,
          expiresAt: binding.expiresAt,
        };
        return {
          content: [
            {
              type: "text" as const,
              text: "Opened a read-only canvas mirror. Human and agent edits remain in the desktop document; Save remains explicit.",
            },
          ],
          _meta: { canvasBinding: safeBinding },
          isError: false,
        };
      }
      if (name === "canvas_read") {
        if (!supported())
          throw new AppError(
            "UI_UNAVAILABLE",
            "This client did not negotiate MCP Apps support.",
          );
        const args = readInput.parse(input);
        const reply = await request({
          command: "presentation-read",
          args: { ...args, scope },
        });
        // Bytes deliberately have no text/image content block or automatic model-context message.
        return { content: [], structuredContent: reply, isError: !reply.ok };
      }
      throw new AppError("UNKNOWN_TOOL", "Unknown presentation tool.");
    } catch (error) {
      if (error instanceof z.ZodError)
        return errorResult(
          new AppError(
            "INVALID_INPUT",
            "Invalid viewer request.",
            error.issues.map((x) => ({ path: x.path, message: x.message })),
          ),
        );
      return errorResult(error);
    }
  }
  async function readResource(uri: string) {
    if (!supported() || uri !== CANVAS_RESOURCE)
      throw new AppError(
        "RESOURCE_UNAVAILABLE",
        "This viewer resource is not available to this client.",
      );
    const text = await html();
    if (Buffer.byteLength(text) > 1024 * 1024)
      throw new AppError(
        "VIEW_TOO_LARGE",
        "The bundled viewer exceeds its 1 MiB limit.",
      );
    return {
      contents: [
        {
          uri: CANVAS_RESOURCE,
          mimeType: RESOURCE_MIME_TYPE,
          text,
          _meta: {
            ui: {
              csp: {
                connectDomains: [],
                resourceDomains: [],
                frameDomains: [],
              },
              prefersBorder: true,
            },
          },
        },
      ],
    };
  }
  return {
    supported,
    tools,
    call,
    readResource,
    owns: (name: string) => name === "show_canvas" || name === "canvas_read",
    resources: () =>
      supported()
        ? [
            {
              uri: CANVAS_RESOURCE,
              name: "Canvas viewer",
              mimeType: RESOURCE_MIME_TYPE,
            },
          ]
        : [],
  };
}
