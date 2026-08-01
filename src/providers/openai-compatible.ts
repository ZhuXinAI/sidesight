import { providerError, redactSecrets } from "../core/errors.js";
import type { ProviderImage, ProviderRequest, ProviderResponse, ProviderVideo, VisionProvider } from "../core/types.js";

interface ChatMessageTextPart {
  type: "text";
  text: string;
}

interface ChatMessageImagePart {
  type: "image_url";
  image_url: { url: string; detail?: "low" | "high" | "auto" };
}

interface ChatMessageVideoPart {
  type: "video_url";
  video_url: { url: string };
}

type ChatPart = ChatMessageTextPart | ChatMessageImagePart | ChatMessageVideoPart;

export interface OpenAICompatibleOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  profile: string;
  supportsNativeVideo?: boolean;
}

export interface SerializedChatRequest {
  model: string;
  messages: Array<{
    role: "system" | "user";
    content: string | ChatPart[];
  }>;
  max_tokens: number;
}

function dataUri(mimeType: string, data: Buffer): string {
  return `data:${mimeType};base64,${data.toString("base64")}`;
}

export function serializeChatRequest(request: ProviderRequest, supportsNativeVideo: boolean): SerializedChatRequest {
  const parts: ChatPart[] = [{ type: "text", text: request.userPrompt }];
  for (const image of request.images) {
    const imagePart: ChatMessageImagePart = { type: "image_url", image_url: { url: dataUri(image.mimeType, image.data) } };
    if (image.detail) imagePart.image_url.detail = image.detail;
    parts.push(imagePart);
  }
  if (supportsNativeVideo) {
    for (const video of request.videos) parts.push({ type: "video_url", video_url: { url: dataUri(video.mimeType, video.data) } });
  }
  return {
    model: request.model,
    messages: [
      { role: "system", content: request.systemPrompt },
      { role: "user", content: parts },
    ],
    max_tokens: request.maxTokens,
  };
}

function responseText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
      return "";
    }).join("").trim();
  }
  return "";
}

async function readJsonWithinLimit(response: Response, limit: number): Promise<unknown> {
  if (response.headers.get("content-length") && Number(response.headers.get("content-length")) > limit) throw providerError("Vision provider response exceeded the safety size limit.");
  if (!response.body) throw providerError("Vision provider response did not contain a body.");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = Buffer.from(next.value);
      total += chunk.length;
      if (total > limit) throw providerError("Vision provider response exceeded the safety size limit.");
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    throw providerError(`Vision provider returned invalid JSON (HTTP ${response.status}).`, error);
  }
}

function endpointFor(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/chat/completions") ? normalized : `${normalized}/chat/completions`;
}

function providerMessage(payload: unknown): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = payload.error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  }
  return "The provider returned an unsuccessful response.";
}

function isTextOnlyMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (normalized.includes("text only") || normalized.includes("text-only") || normalized.includes("only support text")) && normalized.includes("image");
}

export class OpenAICompatibleProvider implements VisionProvider {
  readonly name: string;
  readonly model: string;
  readonly supportsNativeVideo: boolean;
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(options: OpenAICompatibleOptions) {
    this.name = options.profile;
    this.model = options.model;
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
    this.supportsNativeVideo = options.supportsNativeVideo ?? false;
  }

  async analyze(request: ProviderRequest): Promise<ProviderResponse> {
    const body = serializeChatRequest(request, this.supportsNativeVideo);
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
    let response: Response;
    try {
      response = await fetch(endpointFor(this.baseUrl), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw providerError(`Unable to reach vision provider ${this.name}: ${error instanceof Error ? error.message : String(error)}`, error);
    } finally {
      clearTimeout(timeout);
    }
    let payload: unknown;
    payload = await readJsonWithinLimit(response, 4 * 1024 * 1024);
    if (!response.ok) {
      const message = redactSecrets(providerMessage(payload), this.apiKey ? [this.apiKey] : []);
      if (isTextOnlyMessage(message)) throw providerError("The configured vision model rejected image input because it is text-only. Set SIDESIGHT_MODEL to a multimodal model.", undefined, "TEXT_ONLY_MODEL");
      if (response.status === 401 || response.status === 403) throw providerError("Vision provider authentication failed. Check SIDESIGHT_API_KEY without printing it.");
      if (response.status === 429) throw providerError("Vision provider rate-limited the request. Retry after the provider's backoff window.");
      throw providerError(`Vision provider request failed with HTTP ${response.status}: ${message}`);
    }
    const text = responseText(
      payload && typeof payload === "object" && "choices" in payload && Array.isArray(payload.choices) && payload.choices[0] && typeof payload.choices[0] === "object" && "message" in payload.choices[0]
        ? (payload.choices[0].message && typeof payload.choices[0].message === "object" && "content" in payload.choices[0].message ? payload.choices[0].message.content : "")
        : "",
    );
    if (!text) throw providerError("Vision provider returned no answer.");
    const usage = payload && typeof payload === "object" && "usage" in payload && payload.usage && typeof payload.usage === "object" ? payload.usage : undefined;
    return {
      text,
      inputTokens: usage && "prompt_tokens" in usage && typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : undefined,
      outputTokens: usage && "completion_tokens" in usage && typeof usage.completion_tokens === "number" ? usage.completion_tokens : undefined,
    };
  }
}
