import type { ToolContext, ToolDefinition, ToolExecutionResult } from "@vellumai/plugin-api";
import { downloadTask } from "../src/runway.js";
const tool: ToolDefinition = {
  name: "runway_download_task",
  description: "Download a succeeded Runway task into durable workspace storage and return the generated files as attachments.",
  defaultRiskLevel: "low",
  input_schema: { type: "object", additionalProperties: false, properties: { task_id: { type: "string", format: "uuid", description: "Succeeded Runway task UUID." } }, required: ["task_id"] },
  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolExecutionResult> { return downloadTask(input, ctx); }
};
export default tool;
