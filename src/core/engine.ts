import type { ResolvedConfig } from "../config.js";
import { createProvider } from "../providers/index.js";
import { composePrompt, getTaskDefinition, parseModelPayload } from "./prompts.js";
import { createOverview, cropFromOriginal, defaultZoomRegion, gridZoomRegions } from "./image.js";
import { loadImages, loadVideo } from "./media.js";
import { providerError, usageError } from "./errors.js";
import { safeMediaLabel } from "./security.js";
import { framesToProviderImages, sampleVideoFrames } from "./video.js";
import { analyzeLocalOcr, runMacOsVisionOcr, type LocalOcrRunner } from "../local/ocr.js";
import type {
  LoadedImage,
  NormalizedRegion,
  ProviderImage,
  ProviderRequest,
  ProviderVideo,
  VisionModelPayload,
  VisionProvider,
  VisionRequest,
  VisionResult,
  VisionResultEvidence,
} from "./types.js";

function toProviderImage(image: LoadedImage, detail: "auto" | "high"): ProviderImage {
  return { data: image.buffer, mimeType: image.mimeType, detail, source: image.source };
}

function metadataForMedia(asset: { source: string; mimeType: string; width?: number; height?: number; durationSeconds?: number }): VisionResult["media"][number] {
  const metadata: VisionResult["media"][number] = { source: safeMediaLabel(asset.source), mimeType: asset.mimeType };
  if (asset.width !== undefined) metadata.width = asset.width;
  if (asset.height !== undefined) metadata.height = asset.height;
  if (asset.durationSeconds !== undefined) metadata.durationSeconds = asset.durationSeconds;
  return metadata;
}

function shouldZoom(detail: VisionRequest["detail"], payload: VisionModelPayload, explicitRegion: boolean): boolean {
  if (detail === "overview") return false;
  if (explicitRegion || detail === "fine") return true;
  if (payload.confidence !== undefined && payload.confidence >= 0.84 && detail === "auto") return false;
  const text = `${payload.answer} ${(payload.warnings ?? []).join(" ")}`.toLowerCase();
  return payload.confidence === undefined || payload.confidence < 0.84 || /uncertain|unclear|illegible|too small|cannot read|can't read|not readable/.test(text);
}

function regionFromPayload(payload: VisionModelPayload): NormalizedRegion | undefined {
  for (const evidence of payload.evidence ?? []) {
    if (evidence.region) return evidence.region;
  }
  return undefined;
}

function mergePayload(initial: VisionModelPayload, final: VisionModelPayload, cropRegion: NormalizedRegion | undefined): VisionModelPayload {
  const evidence: VisionResultEvidence[] = [...(final.evidence ?? [])];
  if (cropRegion && !evidence.some((item) => item.region)) evidence.push({ description: "Full-resolution detail crop inspected during bounded zoom.", region: cropRegion });
  const warnings = [...new Set([...(initial.warnings ?? []), ...(final.warnings ?? [])])];
  const merged: VisionModelPayload = { answer: final.answer, warnings, evidence };
  if (final.confidence !== undefined) merged.confidence = final.confidence;
  else if (initial.confidence !== undefined) merged.confidence = initial.confidence;
  return merged;
}

export class VisionEngine {
  readonly provider: VisionProvider;
  private readonly config: ResolvedConfig;

  constructor(config: ResolvedConfig, provider: VisionProvider = createProvider(config), private readonly localOcrRunner: LocalOcrRunner = runMacOsVisionOcr) {
    this.config = config;
    this.provider = provider;
  }

  async analyze(request: VisionRequest): Promise<VisionResult> {
    const definition = getTaskDefinition(request.task);
    const expectedSourceCount = request.task === "diff" ? 2 : 1;
    if (request.sources.length !== expectedSourceCount) throw usageError(`${request.task} expects ${expectedSourceCount} media source${expectedSourceCount === 1 ? "" : "s"}.`);
    if (request.sources.length > Math.min(definition.maxImages, this.config.maxImages) && request.task !== "video") throw usageError(`${request.task} accepts at most ${Math.min(definition.maxImages, this.config.maxImages)} images.`);
    if (request.backend === "local") return analyzeLocalOcr(request, this.config, this.localOcrRunner);
    if (request.task === "video") return this.analyzeVideo(request);
    return this.analyzeImages(request);
  }

  private async callProvider(
    request: VisionRequest,
    prompts: { systemPrompt: string; userPrompt: string },
    images: ProviderImage[],
    videos: ProviderVideo[] = [],
  ): Promise<{ payload: VisionModelPayload; inputTokens?: number; outputTokens?: number }> {
    const providerRequest: ProviderRequest = {
      model: request.model ?? this.provider.model,
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
      images,
      videos,
      maxTokens: request.maxTokens ?? this.config.maxTokens,
      timeoutMs: (request.timeoutSeconds ?? this.config.timeoutSeconds) * 1000,
    };
    const response = await this.provider.analyze(providerRequest);
    try {
      return { payload: parseModelPayload(response.text), inputTokens: response.inputTokens, outputTokens: response.outputTokens };
    } catch (error) {
      throw providerError(`Vision provider returned an unusable answer: ${error instanceof Error ? error.message : String(error)}`, error);
    }
  }

  private async analyzeImages(request: VisionRequest): Promise<VisionResult> {
    const originals = await loadImages(request.sources, this.config);
    const prompts = composePrompt(request.task, request.question, request.instructions, originals.map((image) => image.source));
    const overviews = await Promise.all(originals.map((image) => createOverview(image, this.config.maxOverviewEdge)));
    request.onProgress?.("Sending the bounded overview to the configured vision provider.");
    const initial = await this.callProvider(request, prompts, overviews.map((image) => toProviderImage(image, "auto")));
    let payload = initial.payload;
    let rounds = 0;
    let lastRegion: NormalizedRegion | undefined;
    const maxRounds = Math.max(0, this.config.maxZoomRounds);
    const wantsZoom = shouldZoom(request.detail, payload, Boolean(request.region));
    const candidateRegions = request.region ? [request.region] : [regionFromPayload(payload) ?? defaultZoomRegion(), ...gridZoomRegions()];
    let candidateIndex = 0;
    let inputTokens = initial.inputTokens;
    let outputTokens = initial.outputTokens;
    while (wantsZoom && rounds < maxRounds && candidateIndex < candidateRegions.length) {
      const region = candidateRegions[candidateIndex++];
      if (!region) break;
      const crops = await Promise.all(originals.map((image) => cropFromOriginal(image, region)));
      request.onProgress?.(`Inspecting full-resolution detail crop ${rounds + 1}/${maxRounds}.`);
      const focusedPrompt = { ...prompts, userPrompt: `${prompts.userPrompt}\n\nA bounded full-resolution crop is attached. Re-check the focused question against this detail and correct any uncertain reading.` };
      const focused = await this.callProvider(request, focusedPrompt, crops.map((crop, index) => ({ data: crop.image, mimeType: "image/png", detail: "high" as const, source: `${originals[index]?.source ?? "image"} region ${crop.region.x},${crop.region.y},${crop.region.width},${crop.region.height}` })));
      payload = mergePayload(payload, focused.payload, region);
      lastRegion = region;
      inputTokens = (inputTokens ?? 0) + (focused.inputTokens ?? 0) || undefined;
      outputTokens = (outputTokens ?? 0) + (focused.outputTokens ?? 0) || undefined;
      rounds += 1;
      if (focused.payload.confidence !== undefined && focused.payload.confidence >= 0.9) break;
      if (request.detail !== "fine") break;
    }
    const media = originals.map(metadataForMedia);
    const result: VisionResult = {
      task: request.task,
      answer: payload.answer,
      warnings: payload.warnings ?? [],
      evidence: payload.evidence ?? (lastRegion ? [{ description: "Detail region inspected.", region: lastRegion }] : []),
      rounds,
      provider: this.provider.name,
      model: this.provider.model,
      media,
    };
    if (payload.confidence !== undefined) result.confidence = payload.confidence;
    if (inputTokens !== undefined || outputTokens !== undefined) result.usage = { inputTokens, outputTokens };
    return result;
  }

  private async analyzeVideo(request: VisionRequest): Promise<VisionResult> {
    const source = request.sources[0];
    if (!source) throw usageError("video expects one media source.");
    const video = await loadVideo(source, this.config);
    const prompts = composePrompt(request.task, request.question, request.instructions, [video.source]);
    let images: ProviderImage[] = [];
    let videos: ProviderVideo[] = [];
    if (this.provider.supportsNativeVideo) {
      videos = [{ data: video.buffer, mimeType: video.mimeType, source: video.source }];
      request.onProgress?.("Sending the video to the provider's native video input.");
    } else {
      request.onProgress?.("Sampling bounded, ordered video frames with ffmpeg.");
      const frames = await sampleVideoFrames(video, Math.min(this.config.videoFrames, this.config.maxImages), this.config.ffmpegPath);
      images = framesToProviderImages(frames, Math.min(this.config.videoFrames, this.config.maxImages));
      const timeline = frames.map((frame) => `${frame.timestampSeconds.toFixed(2)}s: ${frame.source}`).join("\n");
      prompts.userPrompt = `${prompts.userPrompt}\n\nOrdered frame timestamps:\n${timeline}`;
    }
    const response = await this.callProvider(request, prompts, images, videos);
    const result: VisionResult = {
      task: "video",
      answer: response.payload.answer,
      warnings: response.payload.warnings ?? [],
      evidence: response.payload.evidence ?? [],
      rounds: 0,
      provider: this.provider.name,
      model: this.provider.model,
      media: [metadataForMedia(video)],
    };
    if (response.payload.confidence !== undefined) result.confidence = response.payload.confidence;
    if (response.inputTokens !== undefined || response.outputTokens !== undefined) result.usage = { inputTokens: response.inputTokens, outputTokens: response.outputTokens };
    return result;
  }
}
