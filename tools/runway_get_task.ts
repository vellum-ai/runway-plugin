import type { ToolContext, ToolDefinition, ToolExecutionResult } from "@vellumai/plugin-api";
import { getTask } from "../src/runway.js";
const tool: ToolDefinition = {
  name: "runway_get_task",
  description: "Check a Runway task's status, progress, and credit usage without exposing expiring output URLs.",
  defaultRiskLevel: "low",
  input_schema: { type: "object", additionalProperties: false, properties: { task_id: { type: "string", format: "uuid", description: "Runway task UUID." } }, required: ["task_id"] },
  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolExecutionResult> { return getTask(input, ctx); }
};
export default tool;
