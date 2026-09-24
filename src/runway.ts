import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { ContentBlock, ToolContext, ToolExecutionResult } from "@vellumai/plugin-api";

const API_ROOT = "https://api.dev.runwayml.com/v1";
const API_VERSION = "2024-11-06";
const MAX_PROMPT_CHARS = 1000;
const MAX_LOCAL_IMAGE_BYTES = 3_300_000;
const MAX_DOWNLOAD_BYTES = 150 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 180_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TEXT_RATIOS = new Set(["1280:720", "720:1280"]);
const IMAGE_RATIOS = new Set(["1280:720", "720:1280", "1104:832", "960:960", "832:1104", "1584:672"]);
const OUTPUT_FORMATS = new Set([
  "mp4", "prores", "png_sequence", "hdr10", "hlg", "sdr_rec709_10bit",
  "hdr_pq_12bit_master", "hdr_prores", "hdr_png_sequence", "hdr_exr_sequence",
  "hdr_exr_acescg_sequence_1_3", "hdr_exr_acescg_sequence_2_0",
]);
const PRORES_PROFILES = new Set(["422", "4444", "422 Proxy", "422 LT", "422 HQ", "4444 XQ"]);
const ACTIVE_STATUSES = new Set(["PENDING", "THROTTLED", "RUNNING"]);
const ALL_TOOLS = ["runway_prepare_video", "runway_create_video", "runway_get_task", "runway_download_task", "runway_cancel_task"];

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type SecretResult = { value?: unknown } | null | undefined;
type JsonRecord = Record<string, unknown>;

export interface RunwayDeps {
  fetchImpl?: FetchLike;
  requestTimeoutMs?: number;
  downloadTimeoutMs?: number;
  outputRoot?: string;
}

function error(content: string): ToolExecutionResult {
  return { content, isError: true };
}

function ok(content: string, contentBlocks?: ContentBlock[]): ToolExecutionResult {
  return { content, isError: false, ...(contentBlocks?.length ? { contentBlocks } : {}) };
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseTaskId(value: unknown): string | ToolExecutionResult {
  const id = safeString(value);
  return id && UUID.test(id) ? id : error("Error: task_id must be a valid Runway task UUID.");
}

async function requestKey(ctx: ToolContext, purpose: string): Promise<string | ToolExecutionResult> {
  if (!ctx.requestSecret) return error("Error: secure credential entry is unavailable in this session.");
  let secret: SecretResult;
  try {
    secret = (await ctx.requestSecret({
      service: "Runway",
      field: "RUNWAYML_API_SECRET",
      label: "Runway API key",
      description: "Enter your Runway Dev API key; Vellum stores it securely and only sends it to Runway Dev.",
      placeholder: "key_…",
      purpose,
      allowedTools: ALL_TOOLS,
      allowedDomains: ["api.dev.runwayml.com"],
    })) as SecretResult;
  } catch {
    return error("Error: could not obtain the Runway credential.");
  }
  const key = typeof secret?.value === "string" ? secret.value.trim() : "";
  return key || error("Error: a Runway API key is required.");
}

function isResult(value: string | ToolExecutionResult): value is ToolExecutionResult {
  return typeof value !== "string";
}

function isToolResult(value: JsonRecord | ToolExecutionResult): value is ToolExecutionResult {
  return typeof value.content === "string" && typeof value.isError === "boolean";
}

async function apiError(response: Response): Promise<ToolExecutionResult> {
  const status = response.status;
  if (status === 401 || status === 403) return error("Error: Runway credentials were rejected.");
  if (status === 404) return error("Error: Runway could not find that task.");
  if (status === 429) return error("Error: Runway rate or concurrency limit reached; try again shortly.");
  if (status === 400 || status === 422) {
    const raw = await response.text().catch(() => "");
    if (/not (?:have )?enough credits/i.test(raw)) {
      return error("Error: the Runway Dev account does not have enough credits for this generation.");
    }
    return error("Error: Runway rejected the generation settings or media input.");
  }
  if (status >= 500) return error("Error: Runway is temporarily unavailable.");
  return error("Error: Runway returned an unexpected response.");
}

function combineSignal(parent: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), timeoutMs);
  const abort = () => controller.abort(parent?.reason ?? new DOMException("Request aborted", "AbortError"));
  parent?.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
    },
  };
}

async function apiRequest(
  path: string,
  key: string,
  init: RequestInit,
  ctx: ToolContext,
  deps: RunwayDeps,
): Promise<Response | ToolExecutionResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const linked = combineSignal(ctx.signal, deps.requestTimeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${API_ROOT}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${key}`,
        "X-Runway-Version": API_VERSION,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
      signal: linked.signal,
    });
    return response.ok ? response : await apiError(response);
  } catch (cause) {
    if (cause instanceof DOMException && (cause.name === "AbortError" || cause.name === "TimeoutError")) {
      return error("Error: the Runway request timed out or was cancelled.");
    }
    return error("Error: unable to reach Runway.");
  } finally {
    linked.cleanup();
  }
}

function imageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString() === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString() === "WEBP") return "image/webp";
  return null;
}

async function resolveImage(value: string, ctx: ToolContext): Promise<string | ToolExecutionResult> {
  if (value.startsWith("https://") || value.startsWith("runway://")) return value;
  if (value.startsWith("data:image/")) {
    return value.length <= 5 * 1024 * 1024 ? value : error("Error: image data URI exceeds Runway's 5 MB encoded limit.");
  }

  const root = resolve(ctx.workingDir || "/workspace");
  const candidate = isAbsolute(value) ? value : resolve(root, value);
  try {
    const actual = await realpath(candidate);
    const rel = relative(root, actual);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      return error("Error: local images must be inside the workspace.");
    }
    const info = await stat(actual);
    if (!info.isFile()) return error("Error: image must refer to a file.");
    if (info.size > MAX_LOCAL_IMAGE_BYTES) {
      return error("Error: local image must be 3.3 MB or smaller for Runway's data-URI limit.");
    }
    const bytes = await readFile(actual);
    const mime = imageMime(bytes);
    if (!mime) return error("Error: local image must be a JPEG, PNG, or WebP file.");
    const uri = `data:${mime};base64,${bytes.toString("base64")}`;
    return uri.length <= 5 * 1024 * 1024 ? uri : error("Error: encoded image exceeds Runway's 5 MB data-URI limit.");
  } catch {
    return error("Error: local image could not be read.");
  }
}

function parseCreateInput(input: JsonRecord):
  | {
      prompt: string;
      image: string | null;
      duration: number;
      ratio: string;
      seed?: number;
      outputFormat?: string;
      proresProfile?: string;
    }
  | ToolExecutionResult {
  const prompt = safeString(input.prompt);
  if (!prompt) return error("Error: prompt is required.");
  if (prompt.length > MAX_PROMPT_CHARS) return error(`Error: prompt must be ${MAX_PROMPT_CHARS} characters or fewer.`);
  const image = input.image === undefined ? null : safeString(input.image);
  if (input.image !== undefined && !image) return error("Error: image must be a non-empty URL, Runway URI, data URI, or workspace path.");
  const duration = input.duration === undefined ? 5 : input.duration;
  if (typeof duration !== "number" || !Number.isInteger(duration) || duration < 2 || duration > 10) {
    return error("Error: duration must be a whole number from 2 to 10 seconds.");
  }
  const ratio = input.ratio === undefined ? "1280:720" : safeString(input.ratio);
  const allowedRatios = image ? IMAGE_RATIOS : TEXT_RATIOS;
  if (!ratio || !allowedRatios.has(ratio)) {
    return error(`Error: ratio is not supported for ${image ? "image-to-video" : "text-to-video"} with Gen-4.5.`);
  }
  const seed = input.seed;
  if (seed !== undefined && (typeof seed !== "number" || !Number.isInteger(seed) || seed < 0 || seed > 4_294_967_295)) {
    return error("Error: seed must be a whole number from 0 to 4294967295.");
  }
  const outputFormat = input.output_format === undefined ? undefined : safeString(input.output_format);
  if (outputFormat !== undefined && (!outputFormat || !OUTPUT_FORMATS.has(outputFormat))) return error("Error: unsupported output_format.");
  const proresProfile = input.prores_profile === undefined ? undefined : safeString(input.prores_profile);
  if (proresProfile !== undefined && (!proresProfile || !PRORES_PROFILES.has(proresProfile))) return error("Error: unsupported prores_profile.");
  if (proresProfile && outputFormat !== "prores" && outputFormat !== "hdr_prores") {
    return error("Error: prores_profile is only valid with prores or hdr_prores output.");
  }
  return { prompt, image, duration, ratio, ...(seed !== undefined ? { seed } : {}), ...(outputFormat ? { outputFormat } : {}), ...(proresProfile ? { proresProfile } : {}) };
}

type ParsedCreateInput = Exclude<ReturnType<typeof parseCreateInput>, ToolExecutionResult>;

function approvalId(parsed: ParsedCreateInput): string {
  const bound = JSON.stringify({
    prompt: parsed.prompt,
    image: parsed.image,
    duration: parsed.duration,
    ratio: parsed.ratio,
    seed: parsed.seed ?? null,
    output_format: parsed.outputFormat ?? "mp4",
    prores_profile: parsed.proresProfile ?? null,
  });
  return `runway-v1-${createHash("sha256").update(bound).digest("hex")}`;
}

export function prepareVideo(input: JsonRecord): ToolExecutionResult {
  const parsed = parseCreateInput(input);
  if ("isError" in parsed) return parsed;
  return ok(JSON.stringify({
    approval_id: approvalId(parsed),
    approval_required: true,
    final_prompt: parsed.prompt,
    settings: {
      mode: parsed.image ? "image-to-video" : "text-to-video",
      image: parsed.image,
      duration: parsed.duration,
      ratio: parsed.ratio,
      seed: parsed.seed ?? null,
      output_format: parsed.outputFormat ?? "mp4",
      prores_profile: parsed.proresProfile ?? null,
    },
    estimated_base_credits: parsed.duration * 12,
    next_step: "Show this exact prompt and settings to the user. Generate only after explicit approval; any change requires a new approval ID.",
  }, null, 2));
}

function validateApproval(input: JsonRecord, parsed: ParsedCreateInput): ToolExecutionResult | null {
  if (input.user_approved !== true) {
    return error("Error: explicit user approval is required before generation; prepare and show the final prompt and settings first.");
  }
  const supplied = safeString(input.approval_id);
  if (!supplied) {
    return error("Error: approval_id from runway_prepare_video is required.");
  }
  if (supplied !== approvalId(parsed)) {
    return error("Error: approval does not match this exact prompt and settings; prepare the revised version and obtain fresh user approval.");
  }
  return null;
}

async function responseJson(response: Response): Promise<JsonRecord | ToolExecutionResult> {
  try {
    const value = await response.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : error("Error: Runway returned malformed JSON.");
  } catch {
    return error("Error: Runway returned malformed JSON.");
  }
}

export async function createVideo(input: JsonRecord, ctx: ToolContext, deps: RunwayDeps = {}): Promise<ToolExecutionResult> {
  const parsed = parseCreateInput(input);
  if ("isError" in parsed) return parsed;
  const approvalError = validateApproval(input, parsed);
  if (approvalError) return approvalError;
  const key = await requestKey(ctx, "Create an explicitly approved Runway video generation");
  if (isResult(key)) return key;
  const image = parsed.image ? await resolveImage(parsed.image, ctx) : null;
  if (image && isResult(image)) return image;
  const body: JsonRecord = {
    model: "gen4.5",
    promptText: parsed.prompt,
    duration: parsed.duration,
    ratio: parsed.ratio,
    ...(image ? { promptImage: image } : {}),
    ...(parsed.seed !== undefined ? { seed: parsed.seed } : {}),
    ...(parsed.outputFormat ? { outputFormat: parsed.outputFormat } : {}),
    ...(parsed.proresProfile ? { proresProfile: parsed.proresProfile } : {}),
  };
  const endpoint = image ? "/image_to_video" : "/text_to_video";
  const response = await apiRequest(endpoint, key, { method: "POST", body: JSON.stringify(body) }, ctx, deps);
  if (!(response instanceof Response)) return response;
  const json = await responseJson(response);
  if (isToolResult(json)) return json;
  const id = safeString(json.id);
  if (!id) return error("Error: Runway created a task but returned no task ID.");
  const estimate = json.estimatedCost as JsonRecord | undefined;
  const credits = typeof estimate?.credits === "number" ? estimate.credits : null;
  return ok(JSON.stringify({ task_id: id, status: "PENDING", model: "gen4.5", mode: image ? "image-to-video" : "text-to-video", estimated_credits: credits }, null, 2));
}

async function fetchTask(id: string, key: string, ctx: ToolContext, deps: RunwayDeps): Promise<JsonRecord | ToolExecutionResult> {
  const response = await apiRequest(`/tasks/${encodeURIComponent(id)}`, key, { method: "GET" }, ctx, deps);
  if (!(response instanceof Response)) return response;
  return responseJson(response);
}

function publicTask(task: JsonRecord): JsonRecord {
  const status = safeString(task.status) ?? "UNKNOWN";
  const result: JsonRecord = { task_id: task.id, status, created_at: task.createdAt };
  if (typeof task.progress === "number") result.progress_percent = Math.round(task.progress * 100);
  const estimatedCost = task.estimatedCost as JsonRecord | undefined;
  const cost = task.cost as JsonRecord | undefined;
  if (typeof estimatedCost?.credits === "number") result.estimated_credits = estimatedCost.credits;
  if (typeof cost?.credits === "number") result.credits_charged = cost.credits;
  if (status === "SUCCEEDED" && Array.isArray(task.output)) result.output_count = task.output.length;
  if (status === "FAILED") {
    result.failure_code = safeString(task.failureCode) ?? "generation_failed";
    result.message = "Runway could not complete this generation.";
  }
  return result;
}

export async function getTask(input: JsonRecord, ctx: ToolContext, deps: RunwayDeps = {}): Promise<ToolExecutionResult> {
  const id = parseTaskId(input.task_id);
  if (isResult(id)) return id;
  const key = await requestKey(ctx, "Check a Runway generation task");
  if (isResult(key)) return key;
  const task = await fetchTask(id, key, ctx, deps);
  return isToolResult(task) ? task : ok(JSON.stringify(publicTask(task), null, 2));
}

function outputDescriptor(response: Response, url: string, index: number): { mediaType: string; extension: string } {
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() || "application/octet-stream";
  const byType: Record<string, string> = {
    "video/mp4": ".mp4", "video/quicktime": ".mov", "application/zip": ".zip",
    "audio/wav": ".wav", "audio/mpeg": ".mp3", "image/png": ".png", "image/jpeg": ".jpg",
  };
  let extension = byType[mediaType] ?? "";
  if (!extension) {
    try {
      const candidate = extname(new URL(url).pathname).toLowerCase();
      if (/^\.[a-z0-9]{1,8}$/.test(candidate)) extension = candidate;
    } catch { /* use fallback */ }
  }
  return { mediaType, extension: extension || `.output-${index + 1}` };
}

async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) throw new Error("too-large");
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new Error("too-large");
    return bytes;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) throw new Error("too-large");
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}

export async function downloadTask(input: JsonRecord, ctx: ToolContext, deps: RunwayDeps = {}): Promise<ToolExecutionResult> {
  const id = parseTaskId(input.task_id);
  if (isResult(id)) return id;
  const key = await requestKey(ctx, "Download a completed Runway generation");
  if (isResult(key)) return key;
  const task = await fetchTask(id, key, ctx, deps);
  if (isToolResult(task)) return task;
  if (task.status !== "SUCCEEDED" || !Array.isArray(task.output) || task.output.length === 0) {
    return error(`Error: task is ${safeString(task.status) ?? "not ready"}; only succeeded tasks can be downloaded.`);
  }

  const outputRoot = deps.outputRoot ?? join(resolve(ctx.workingDir || "/workspace"), "scratch", "runway");
  const taskDir = join(outputRoot, id);
  await mkdir(taskDir, { recursive: true });
  const blocks: ContentBlock[] = [];
  const paths: string[] = [];
  let remaining = MAX_DOWNLOAD_BYTES;
  const fetchImpl = deps.fetchImpl ?? fetch;

  try {
    for (let index = 0; index < task.output.length; index += 1) {
      const url = task.output[index];
      if (typeof url !== "string" || !url.startsWith("https://")) return error("Error: Runway returned an invalid output URL.");
      const linked = combineSignal(ctx.signal, deps.downloadTimeoutMs ?? DOWNLOAD_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetchImpl(url, { signal: linked.signal });
      } finally {
        linked.cleanup();
      }
      if (!response.ok) return error("Error: a Runway output could not be downloaded; refresh the task and try again.");
      const bytes = await readBounded(response, remaining);
      remaining -= bytes.length;
      const descriptor = outputDescriptor(response, url, index);
      const filename = `${id}-${index + 1}${descriptor.extension}`;
      const finalPath = join(taskDir, filename);
      const tempPath = join(taskDir, `.${filename}.tmp`);
      await writeFile(tempPath, bytes, { flag: "wx" });
      await rename(tempPath, finalPath);
      paths.push(finalPath);
      blocks.push({ type: "file", source: { type: "base64", media_type: descriptor.mediaType, data: Buffer.from(bytes).toString("base64"), filename } });
    }
    return ok(JSON.stringify({ task_id: id, downloaded: paths.length, files: paths }, null, 2), blocks);
  } catch (cause) {
    await Promise.all(paths.map((path) => rm(path, { force: true })));
    if (cause instanceof Error && cause.message === "too-large") return error("Error: Runway outputs exceed the plugin's 150 MB download limit.");
    if (cause instanceof DOMException && (cause.name === "AbortError" || cause.name === "TimeoutError")) return error("Error: the Runway download timed out or was cancelled.");
    return error("Error: unable to save the Runway output.");
  }
}

export async function cancelTask(input: JsonRecord, ctx: ToolContext, deps: RunwayDeps = {}): Promise<ToolExecutionResult> {
  const id = parseTaskId(input.task_id);
  if (isResult(id)) return id;
  const key = await requestKey(ctx, "Cancel an active Runway generation task");
  if (isResult(key)) return key;
  const task = await fetchTask(id, key, ctx, deps);
  if (isToolResult(task)) return task;
  const status = safeString(task.status) ?? "UNKNOWN";
  if (!ACTIVE_STATUSES.has(status)) {
    return error(`Error: task is ${status}; refusing to delete a terminal task or its outputs.`);
  }
  const response = await apiRequest(`/tasks/${encodeURIComponent(id)}`, key, { method: "DELETE" }, ctx, deps);
  if (!(response instanceof Response)) return response;
  return ok(JSON.stringify({ task_id: id, status: "CANCEL_REQUESTED", previous_status: status }, null, 2));
}
