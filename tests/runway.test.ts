import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ToolContext } from "@vellumai/plugin-api";
import { cancelTask, createVideo, downloadTask, getTask, prepareVideo, setupApiKey } from "../src/runway.js";

const ROOT = "/workspace/scratch/runway-plugin-test";
const ID = "17f20503-6c24-4c16-946b-35dbbce2af2f";
const ctx = (key: string | null = "runway-secret"): ToolContext => ({
  conversationId: "test",
  workingDir: ROOT,
  requestSecret: async () => ({ value: key, delivery: "transient_send" }),
});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const approved = (input: Record<string, unknown>): Record<string, unknown> => {
  const prepared = prepareVideo(input);
  if (prepared.isError) throw new Error(prepared.content);
  return { ...input, approval_id: JSON.parse(prepared.content).approval_id, user_approved: true };
};

afterEach(async () => { await rm(ROOT, { recursive: true, force: true }); });

describe("Runway API key setup", () => {
  test("securely configures the key before video creation without contacting Runway", async () => {
    let params: Record<string, unknown> | undefined;
    const result = await setupApiKey({
      conversationId: "test",
      workingDir: ROOT,
      requestSecret: async (request) => {
        params = request;
        return { value: "runway-secret", delivery: "transient_send" };
      },
    });
    expect(result.isError).toBe(false);
    expect(params).toMatchObject({
      service: "Runway",
      field: "RUNWAYML_API_SECRET",
      allowedDomains: ["api.dev.runwayml.com"],
    });
    expect(params?.allowedTools).toContain("runway_setup_api_key");
    expect(params?.allowedTools).toContain("runway_create_video");
    expect(result.content).not.toContain("runway-secret");
    expect(JSON.parse(result.content)).toMatchObject({ configured: true, key_exposed: false, credits_spent: 0 });
  });

  test("stops cleanly when the user does not add a key", async () => {
    const result = await setupApiKey(ctx(null));
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Runway API key is required");
  });

  test("reports when secure credential entry is unavailable", async () => {
    const result = await setupApiKey({ conversationId: "test", workingDir: ROOT });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("secure credential entry is unavailable");
  });
});

describe("Runway prompt approval", () => {
  test("prepares the exact prompt and settings without credentials or credits", () => {
    const result = prepareVideo({
      prompt: "A cobalt passenger train crosses a snow-covered alpine bridge as sunrise catches the metal; a steady lateral tracking camera holds the train in profile while mist drifts through the valley, realistic motion, restrained warm-and-cobalt palette.",
      duration: 5,
      ratio: "1280:720",
    });
    expect(result.isError).toBe(false);
    const prepared = JSON.parse(result.content);
    expect(prepared.approval_required).toBe(true);
    expect(prepared.approval_id).toStartWith("runway-v1-");
    expect(prepared.final_prompt).toContain("steady lateral tracking camera");
    expect(prepared.settings).toMatchObject({ mode: "text-to-video", duration: 5, ratio: "1280:720", output_format: "mp4" });
    expect(prepared.estimated_base_credits).toBe(60);
  });

  test("blocks generation without explicit approval before requesting credentials", async () => {
    let prompted = false;
    let fetched = false;
    const draft = { prompt: "A cobalt train at sunrise", duration: 5, ratio: "1280:720" };
    const prepared = JSON.parse(prepareVideo(draft).content);
    const result = await createVideo(
      { ...draft, approval_id: prepared.approval_id, user_approved: false },
      { ...ctx(), requestSecret: async () => { prompted = true; return { value: "x" }; } },
      { fetchImpl: async () => { fetched = true; return json({ id: ID }); } },
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("explicit user approval");
    expect(prompted).toBe(false);
    expect(fetched).toBe(false);
  });

  test("rejects stale approval after the prompt changes", async () => {
    let prompted = false;
    const draft = { prompt: "A cobalt train at sunrise", duration: 5, ratio: "1280:720" };
    const prepared = JSON.parse(prepareVideo(draft).content);
    const result = await createVideo(
      { ...draft, prompt: "A cobalt train at sunset", approval_id: prepared.approval_id, user_approved: true },
      { ...ctx(), requestSecret: async () => { prompted = true; return { value: "x" }; } },
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("does not match this exact prompt and settings");
    expect(prompted).toBe(false);
  });
});

describe("runway_create_video", () => {
  test("validates before requesting a credential", async () => {
    let prompted = false;
    const result = await createVideo({ prompt: "", duration: 5 }, { ...ctx(), requestSecret: async () => { prompted = true; return { value: "x" }; } });
    expect(result.isError).toBe(true);
    expect(prompted).toBe(false);
  });

  test("creates an approved text-to-video task with Gen-4.5", async () => {
    let url = "";
    let init: RequestInit | undefined;
    const input = approved({ prompt: "A cobalt train at sunrise", duration: 5, ratio: "1280:720" });
    const result = await createVideo(
      input,
      ctx(),
      { fetchImpl: async (request, options) => { url = String(request); init = options; return json({ id: ID, estimatedCost: { credits: 125 } }); } },
    );
    expect(result.isError).toBe(false);
    expect(url).toEndWith("/v1/text_to_video");
    expect(JSON.parse(String(init?.body))).toEqual({ model: "gen4.5", promptText: "A cobalt train at sunrise", duration: 5, ratio: "1280:720" });
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${"runway-secret"}`);
    expect(result.content).toContain('"estimated_credits": 125');
  });

  test("reports insufficient credits precisely for an approved version", async () => {
    const result = await createVideo(
      approved({ prompt: "A cobalt train at sunrise", duration: 2, ratio: "1280:720" }),
      ctx(),
      { fetchImpl: async () => json({ error: "You do not have enough credits to run this task." }, 400) },
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("does not have enough credits");
  });

  test("encodes a workspace-local PNG for an approved image-to-video version", async () => {
    await mkdir(ROOT, { recursive: true });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    await writeFile(join(ROOT, "frame.png"), png);
    let body: Record<string, unknown> = {};
    const result = await createVideo(
      approved({ prompt: "Clouds race overhead", image: "frame.png", ratio: "960:960" }),
      ctx(),
      { fetchImpl: async (_input, init) => { body = JSON.parse(String(init?.body)); return json({ id: ID, estimatedCost: { credits: 126 } }); } },
    );
    expect(result.isError).toBe(false);
    expect(String(body.promptImage)).toStartWith("data:image/png;base64,");
    expect(body.ratio).toBe("960:960");
  });
});

describe("task management", () => {
  test("reports progress without leaking ephemeral output URLs", async () => {
    const result = await getTask({ task_id: ID }, ctx(), { fetchImpl: async () => json({ id: ID, status: "RUNNING", createdAt: "2026-09-23T12:00:00Z", progress: 0.42, estimatedCost: { credits: 125 } }) });
    expect(result.isError).toBe(false);
    expect(result.content).toContain('"progress_percent": 42');
    expect(result.content).not.toContain("https://");
  });

  test("downloads succeeded output into durable storage and returns an attachment", async () => {
    let calls = 0;
    const result = await downloadTask(
      { task_id: ID },
      ctx(),
      {
        outputRoot: join(ROOT, "out"),
        fetchImpl: async () => {
          calls += 1;
          if (calls === 1) return json({ id: ID, status: "SUCCEEDED", createdAt: "2026-09-23T12:00:00Z", cost: { credits: 125 }, output: ["https://cdn.example/output.mp4"] });
          return new Response(Buffer.from([0, 0, 0, 24, 102, 116, 121, 112]), { headers: { "content-type": "video/mp4", "content-length": "8" } });
        },
      },
    );
    expect(result.isError).toBe(false);
    expect(result.contentBlocks?.[0]).toMatchObject({ type: "file", source: { media_type: "video/mp4", filename: `${ID}-1.mp4` } });
    expect(await readFile(join(ROOT, "out", ID, `${ID}-1.mp4`))).toHaveLength(8);
  });

  test("cancels active tasks", async () => {
    const methods: string[] = [];
    const result = await cancelTask(
      { task_id: ID },
      ctx(),
      { fetchImpl: async (_url, init) => { methods.push(String(init?.method)); return methods.length === 1 ? json({ id: ID, status: "RUNNING", createdAt: "2026-09-23T12:00:00Z", progress: 0.1, estimatedCost: { credits: 125 } }) : new Response(null, { status: 204 }); } },
    );
    expect(result.isError).toBe(false);
    expect(methods).toEqual(["GET", "DELETE"]);
  });

  test("refuses to delete terminal tasks", async () => {
    const methods: string[] = [];
    const result = await cancelTask(
      { task_id: ID },
      ctx(),
      { fetchImpl: async (_url, init) => { methods.push(String(init?.method)); return json({ id: ID, status: "SUCCEEDED", createdAt: "2026-09-23T12:00:00Z", cost: { credits: 125 }, output: ["https://cdn.example/output.mp4"] }); } },
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("refusing to delete");
    expect(methods).toEqual(["GET"]);
  });
});
