import type { ToolContext, ToolDefinition, ToolExecutionResult } from "@vellumai/plugin-api";
import { cancelTask } from "../src/runway.js";
const tool: ToolDefinition = {
  name: "runway_cancel_task",
  description: "Cancel a pending, throttled, or running Runway task; terminal tasks are protected from deletion.",
  defaultRiskLevel: "medium",
  input_schema: { type: "object", additionalProperties: false, properties: { task_id: { type: "string", format: "uuid", description: "Active Runway task UUID." } }, required: ["task_id"] },
  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolExecutionResult> { return cancelTask(input, ctx); }
};
export default tool;
