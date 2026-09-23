declare module "@vellumai/plugin-api" {
  export interface ToolContext {
    conversationId: string;
    workingDir: string;
    signal?: AbortSignal;
    requestSecret?: (params: {
      service: string;
      field: string;
      label: string;
      description?: string;
      placeholder?: string;
      purpose?: string;
      allowedTools?: string[];
      allowedDomains?: string[];
    }) => Promise<unknown>;
  }

  export interface FileContent {
    type: "file";
    source: {
      type: "base64";
      media_type: string;
      data: string;
      filename?: string;
    };
  }

  export type ContentBlock = FileContent;

  export interface ToolExecutionResult {
    content: string;
    isError: boolean;
    contentBlocks?: ContentBlock[];
  }

  export interface ToolDefinition {
    name?: string;
    description?: string;
    defaultRiskLevel?: "low" | "medium" | "high";
    input_schema?: Record<string, unknown>;
    execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolExecutionResult>;
  }
}
