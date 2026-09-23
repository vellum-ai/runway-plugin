import type { ToolContext, ToolDefinition, ToolExecutionResult } from "@vellumai/plugin-api";
import { createVideo } from "../src/runway.js";

const tool: ToolDefinition = {
  name: "runway_create_video",
  description: "Start a Runway Gen-4.5 text-to-video or image-to-video generation; this spends Runway credits and returns a task ID.",
  defaultRiskLevel: "medium",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      prompt: { type: "string", minLength: 1, maxLength: 1000, description: "Detailed description of the scene, motion, camera, lighting, and style." },
      image: { type: "string", minLength: 1, description: "Optional HTTPS URL, runway:// URI, data URI, or workspace-local JPEG/PNG/WebP path to animate." },
      duration: { type: "integer", minimum: 2, maximum: 10, default: 5, description: "Video length in seconds." },
      ratio: { type: "string", enum: ["1280:720", "720:1280", "1104:832", "960:960", "832:1104", "1584:672"], default: "1280:720", description: "Output dimensions; text-only generation supports 1280:720 or 720:1280." },
      seed: { type: "integer", minimum: 0, maximum: 4294967295, description: "Optional seed for similar results from identical settings." },
      output_format: { type: "string", enum: ["mp4", "prores", "png_sequence", "hdr10", "hlg", "sdr_rec709_10bit", "hdr_pq_12bit_master", "hdr_prores", "hdr_png_sequence", "hdr_exr_sequence", "hdr_exr_acescg_sequence_1_3", "hdr_exr_acescg_sequence_2_0"], default: "mp4", description: "Delivery format; non-MP4 and HDR formats cost additional credits." },
      prores_profile: { type: "string", enum: ["422", "4444", "422 Proxy", "422 LT", "422 HQ", "4444 XQ"], description: "Only valid for prores or hdr_prores output." }
    },
    required: ["prompt"]
  },
  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolExecutionResult> { return createVideo(input, ctx); }
};
export default tool;
