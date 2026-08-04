import { z } from "zod";

export const visionTaskIds = [
  "image",
  "ui",
  "ocr",
  "diagnose",
  "diagram",
  "chart",
  "diff",
  "video",
] as const;

export const visionTaskIdSchema = z.enum(visionTaskIds);
export type VisionTaskId = z.infer<typeof visionTaskIdSchema>;

export const detailLevels = ["auto", "overview", "normal", "fine"] as const;
export const detailLevelSchema = z.enum(detailLevels);
export type DetailLevel = z.infer<typeof detailLevelSchema>;

export const visionBackendSchema = z.enum(["cloud", "local"]);
export type VisionBackend = z.infer<typeof visionBackendSchema>;

export const regionSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite(),
    height: z.number().finite(),
  })
  .superRefine((region, context) => {
    if (region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Region must start within the image and have positive dimensions." });
    }
    if (region.x + region.width > 1 || region.y + region.height > 1) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Region must fit inside the normalized image bounds." });
    }
  });
export type NormalizedRegion = z.infer<typeof regionSchema>;

export const evidenceSchema = z.object({
  description: z.string().min(1).max(2_000),
  region: regionSchema.optional(),
});

export const visionModelPayloadSchema = z.object({
  answer: z.string().min(1).max(100_000),
  confidence: z.number().finite().min(0).max(1).optional(),
  warnings: z.array(z.string().min(1).max(500)).max(20).optional(),
  evidence: z.array(evidenceSchema).max(40).optional(),
});
export type VisionModelPayload = z.infer<typeof visionModelPayloadSchema>;

export interface MediaAsset {
  source: string;
  kind: "image" | "video";
  mimeType: string;
  buffer: Buffer;
  width?: number;
  height?: number;
  durationSeconds?: number;
}

export interface ProviderImage {
  data: Buffer;
  mimeType: string;
  detail?: "low" | "high" | "auto";
  source: string;
}

export interface ProviderVideo {
  data: Buffer;
  mimeType: string;
  source: string;
}

export interface ProviderRequest {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  images: ProviderImage[];
  videos: ProviderVideo[];
  maxTokens: number;
  timeoutMs: number;
}

export interface ProviderResponse {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface VisionProvider {
  readonly name: string;
  readonly model: string;
  readonly supportsNativeVideo: boolean;
  analyze(request: ProviderRequest): Promise<ProviderResponse>;
}

export interface VisionRequest {
  task: VisionTaskId;
  sources: string[];
  backend?: VisionBackend;
  model?: string;
  question?: string;
  instructions?: string;
  detail: DetailLevel;
  region?: NormalizedRegion;
  maxTokens?: number;
  timeoutSeconds?: number;
  onProgress?: (message: string) => void;
}

export interface VisionResultEvidence {
  description: string;
  region?: NormalizedRegion;
}

export interface VisionResult {
  task: VisionTaskId;
  answer: string;
  confidence?: number;
  warnings: string[];
  evidence: VisionResultEvidence[];
  rounds: number;
  provider: string;
  model: string;
  media: Array<{
    source: string;
    mimeType: string;
    width?: number;
    height?: number;
    durationSeconds?: number;
  }>;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface LoadedImage extends MediaAsset {
  kind: "image";
  width: number;
  height: number;
}

export interface LoadedVideo extends MediaAsset {
  kind: "video";
}

export interface ZoomCrop {
  region: NormalizedRegion;
  image: Buffer;
  width: number;
  height: number;
}
