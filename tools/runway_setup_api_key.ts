import type { ToolContext, ToolDefinition, ToolExecutionResult } from "@vellumai/plugin-api";
import { setupApiKey } from "../src/runway.js";

const tool: ToolDefinition = {
  name: "runway_setup_api_key",
  description: "Prompt the user to securely add or confirm their Runway Dev API key before any video-generation workflow; stores it in Vellum's credential vault and spends no credits.",
  defaultRiskLevel: "low",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  async execute(_input: Record<string, unknown>, ctx: ToolContext): Promise<ToolExecutionResult> {
    return setupApiKey(ctx);
  },
};

export default tool;
