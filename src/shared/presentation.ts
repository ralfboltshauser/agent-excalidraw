import { z } from "zod";

export const PRESENTATION_PROTOCOL = 1 as const;
export const PRESENTATION_MAX_SIDE = 1600;
export const PRESENTATION_MAX_PIXELS = 4_000_000;
export const PRESENTATION_MAX_PNG_BYTES = 4 * 1024 * 1024;
export const PRESENTATION_MAX_CHUNK_BYTES = 64 * 1024;
export const PRESENTATION_CACHE_BYTES = 32 * 1024 * 1024;
export const PRESENTATION_CAPTURES_PER_BINDING = 2;
export const PRESENTATION_BINDINGS_PER_SCOPE = 8;
export const PRESENTATION_ASSET_TTL_MS = 60_000;
export const PRESENTATION_IDLE_TTL_MS = 10 * 60_000;
export const PRESENTATION_HARD_TTL_MS = 2 * 60 * 60_000;
const identity = z.string().min(1).max(256);
const scope = z.uuid();
export const presentationOpenArgsSchema = z.strictObject({ scope });
export const presentationReadArgsSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    scope,
    viewId: z.uuid(),
    mode: z.literal("head"),
    afterStateToken: z.string().min(1).max(256).optional(),
  }),
  z.strictObject({
    scope,
    viewId: z.uuid(),
    mode: z.literal("chunk"),
    captureId: z.uuid(),
    offset: z.number().int().nonnegative(),
    byteCount: z.number().int().min(1).max(PRESENTATION_MAX_CHUNK_BYTES),
  }),
]);
export const presentationOpenRequestSchema = z.strictObject({
  command: z.literal("presentation-open"),
  document: identity,
  epoch: identity,
  args: presentationOpenArgsSchema,
});
export const presentationReadRequestSchema = z.strictObject({
  command: z.literal("presentation-read"),
  args: presentationReadArgsSchema,
});
export const presentationStateSchema = z.strictObject({
  document: identity,
  epoch: identity,
  revision: z.number().int().nonnegative(),
  dirty: z.boolean(),
  saving: z.boolean(),
  title: z.string(),
  observedAt: z.number().nonnegative(),
});
export const presentationCaptureSchema = z.strictObject({
  id: z.uuid(),
  mime: z.literal("image/png"),
  byteLength: z.number().int().positive().max(PRESENTATION_MAX_PNG_BYTES),
  width: z.number().int().positive().max(PRESENTATION_MAX_SIDE),
  height: z.number().int().positive().max(PRESENTATION_MAX_SIDE),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  revision: z.number().int().nonnegative(),
  expiresAt: z.number(),
});
export const presentationOpenResultSchema = z.strictObject({
  protocol: z.literal(PRESENTATION_PROTOCOL),
  viewId: z.uuid(),
  document: identity,
  epoch: identity,
  title: z.string(),
  expiresAt: z.number(),
});
export const presentationHeadResultSchema = z.strictObject({
  kind: z.enum(["frame", "status", "unchanged", "empty", "busy"]),
  state: presentationStateSchema,
  stateToken: identity,
  capture: presentationCaptureSchema.optional(),
});
export const presentationChunkResultSchema = z.strictObject({
  captureId: z.uuid(),
  offset: z.number().int().nonnegative(),
  byteCount: z.number().int().positive().max(PRESENTATION_MAX_CHUNK_BYTES),
  totalBytes: z.number().int().positive().max(PRESENTATION_MAX_PNG_BYTES),
  data: z.string().max(Math.ceil(PRESENTATION_MAX_CHUNK_BYTES / 3) * 4),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  done: z.boolean(),
});
export type PresentationOpenArgs = z.infer<typeof presentationOpenArgsSchema>;
export type PresentationReadRequest = z.infer<
  typeof presentationReadRequestSchema
>;
export type PresentationOpenRequest = z.infer<
  typeof presentationOpenRequestSchema
>;
export type PresentationReadArgs = z.infer<typeof presentationReadArgsSchema>;
export type PresentationOpenResult = z.infer<
  typeof presentationOpenResultSchema
>;
export type PresentationHeadResult = z.infer<
  typeof presentationHeadResultSchema
>;
export type PresentationChunkResult = z.infer<
  typeof presentationChunkResultSchema
>;
export type PresentationState = z.infer<typeof presentationStateSchema>;
export type PresentationCapture = z.infer<typeof presentationCaptureSchema>;
export type PresentationObservation = {
  document: string;
  epoch: string;
  revision: number;
  dirty: boolean;
  busy: boolean;
  empty: boolean;
};
