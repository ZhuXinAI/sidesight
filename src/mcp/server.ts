import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ResolvedConfig } from "../config.js";
import { VisionEngine } from "../core/engine.js";
import { asSideSightError, redactSecrets } from "../core/errors.js";
import { formatMarkdown } from "../core/output.js";
import { detailLevelSchema, type DetailLevel, type NormalizedRegion, type VisionTaskId } from "../core/types.js";
import { parseRegion, validateNormalizedRegion } from "../core/image.js";
import { VERSION } from "../version.js";

interface ToolSpec {
  name: string;
  description: string;
  task: VisionTaskId;
  sourceFields: string[];
  required: string[];
}

const commonProperties = {
  question: { type: "string", description: "Focused visual question." },
  detail_level: { type: "string", enum: ["auto", "overview", "normal", "fine"], default: "auto" },
  region: { type: "string", description: "Optional normalized x,y,width,height region." },
  backend: { type: "string", enum: ["cloud", "local"], description: "Use the configured cloud provider, or local macOS Vision OCR for the OCR tool." },
  thinking: { type: "boolean", description: "Request additional reasoning effort from the vision model." },
};

const toolSpecs: ToolSpec[] = [
  { name: "ui_to_artifact", description: "Turn a UI screenshot into implementation guidance, a specification, a prompt, or a description.", task: "ui", sourceFields: ["image"], required: ["image"] },
  { name: "extract_text_from_screenshot", description: "Extract visible screenshot text faithfully.", task: "ocr", sourceFields: ["image"], required: ["image"] },
  { name: "diagnose_error_screenshot", description: "Diagnose an error screenshot with exact visible evidence.", task: "diagnose", sourceFields: ["image"], required: ["image"] },
  { name: "understand_technical_diagram", description: "Interpret architecture, flow, UML, ER, or sequence diagrams.", task: "diagram", sourceFields: ["image"], required: ["image"] },
  { name: "analyze_data_visualization", description: "Analyze charts, dashboards, graphs, and visualized metrics.", task: "chart", sourceFields: ["image"], required: ["image"] },
  { name: "ui_diff_check", description: "Compare expected and actual UI screenshots.", task: "diff", sourceFields: ["expected_image", "actual_image"], required: ["expected_image", "actual_image"] },
  { name: "image_analysis", description: "General-purpose image analysis.", task: "image", sourceFields: ["image"], required: ["image"] },
  { name: "video_analysis", description: "Analyze local or remote video over time.", task: "video", sourceFields: ["video"], required: ["video"] },
];

function toolInputSchema(spec: ToolSpec): Record<string, unknown> {
  const properties: Record<string, unknown> = { ...commonProperties };
  for (const field of spec.sourceFields) properties[field] = { type: "string", description: field === "expected_image" ? "Expected/reference image path, URL, or data URI." : field === "actual_image" ? "Actual image path, URL, or data URI." : "Media path, URL, or data URI." };
  return { type: "object", properties, required: spec.required };
}

function argumentString(args: Record<string, unknown>, name: string, required: boolean): string | undefined {
  const value = args[name];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string.`);
  return value;
}

function argumentRegion(value: unknown): NormalizedRegion | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return parseRegion(value);
  if (value && typeof value === "object") return validateNormalizedRegion(value as NormalizedRegion);
  throw new Error("region must be a normalized x,y,width,height string or object.");
}

function argumentBackend(value: unknown): "cloud" | "local" {
  if (value === undefined) return "cloud";
  if (value === "cloud" || value === "local") return value;
  throw new Error("backend must be cloud or local.");
}

export function createMcpServer(config: ResolvedConfig): Server {
  const server = new Server({ name: "sidesight", version: VERSION }, { capabilities: { tools: {} } });
  const engine = new VisionEngine(config);
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolSpecs.map((spec) => ({ name: spec.name, description: spec.description, inputSchema: toolInputSchema(spec) })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const spec = toolSpecs.find((candidate) => candidate.name === request.params.name);
    if (!spec) return { content: [{ type: "text", text: `Unknown SideSight tool: ${request.params.name}` }], isError: true };
    try {
      const args = request.params.arguments ?? {};
      const sources = spec.sourceFields.map((field) => {
        const source = argumentString(args, field, true);
        if (!source) throw new Error(`${field} is required.`);
        return source;
      });
      const detailCandidate = args.detail_level;
      const detailResult = detailLevelSchema.safeParse(detailCandidate ?? "auto");
      if (!detailResult.success) throw new Error("detail_level must be auto, overview, normal, or fine.");
      const question = argumentString(args, "question", false);
      const backend = argumentBackend(args.backend);
      const thinking = args.thinking === true ? "Spend additional effort checking fine visual details, while remaining grounded in visible evidence." : undefined;
      const result = await engine.analyze({ task: spec.task, sources, backend, question, instructions: thinking, detail: detailResult.data as DetailLevel, region: argumentRegion(args.region), onProgress: (message) => process.stderr.write(`sidesight mcp: ${message}\n`) });
      return { content: [{ type: "text", text: formatMarkdown(result) }], structuredContent: result as unknown as Record<string, unknown> };
    } catch (error) {
      const safe = asSideSightError(error, config.apiKey ? [config.apiKey] : []);
      return { content: [{ type: "text", text: redactSecrets(safe.message) }], structuredContent: { error: { code: safe.code, message: redactSecrets(safe.message) } }, isError: true };
    }
  });
  return server;
}

export async function runMcpServer(config: ResolvedConfig): Promise<void> {
  const server = createMcpServer(config);
  const transport = new StdioServerTransport();
  transport.onerror = (error) => process.stderr.write(`sidesight mcp: ${redactSecrets(error.message)}\n`);
  await server.connect(transport);
}

export { toolSpecs };
