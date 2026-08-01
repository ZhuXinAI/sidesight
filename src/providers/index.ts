import type { ResolvedConfig } from "../config.js";
import type { VisionProvider } from "../core/types.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";

export function createProvider(config: ResolvedConfig): VisionProvider {
  return new OpenAICompatibleProvider({
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: config.apiKey,
    profile: config.profile,
    supportsNativeVideo: config.supportsNativeVideo,
  });
}

export { OpenAICompatibleProvider, serializeChatRequest } from "./openai-compatible.js";
