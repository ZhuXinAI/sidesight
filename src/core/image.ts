import sharp from "sharp";
import { mediaError, securityError } from "./errors.js";
import { regionSchema, type LoadedImage, type NormalizedRegion, type ZoomCrop } from "./types.js";

export async function inspectImage(buffer: Buffer, source: string, mimeType: string): Promise<LoadedImage> {
  try {
    const metadata = await sharp(buffer, { animated: false }).metadata();
    const width = metadata.width;
    const height = metadata.height;
    if (!width || !height || width <= 0 || height <= 0) throw new Error("image dimensions are unavailable");
    if (width * height > 50_000_000) throw new Error("image dimensions exceed the 50 megapixel safety limit");
    return { source, kind: "image", mimeType, buffer, width, height };
  } catch (error) {
    throw mediaError(`Unable to decode image ${source}: ${error instanceof Error ? error.message : String(error)}`, error);
  }
}

export async function normalizeGif(buffer: Buffer, source: string): Promise<LoadedImage> {
  try {
    const png = await sharp(buffer, { page: 0 }).png().toBuffer();
    return await inspectImage(png, source, "image/png");
  } catch (error) {
    throw mediaError(`Unable to read the first frame of GIF ${source}.`, error);
  }
}

export async function createOverview(image: LoadedImage, maxEdge: number): Promise<LoadedImage> {
  const edge = Math.max(64, Math.floor(maxEdge));
  if (Math.max(image.width, image.height) <= edge) return image;
  try {
    const overview = await sharp(image.buffer).resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true }).png().toBuffer();
    return await inspectImage(overview, image.source, "image/png");
  } catch (error) {
    throw mediaError(`Unable to create an overview for ${image.source}.`, error);
  }
}

export function validateNormalizedRegion(region: NormalizedRegion): NormalizedRegion {
  const parsed = regionSchema.safeParse(region);
  if (!parsed.success) throw securityError(parsed.error.issues.map((issue) => issue.message).join(" "));
  return parsed.data;
}

export function parseRegion(value: string): NormalizedRegion {
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) throw securityError("Region must be four normalized numbers: x,y,width,height.");
  return validateNormalizedRegion({ x: parts[0] ?? 0, y: parts[1] ?? 0, width: parts[2] ?? 0, height: parts[3] ?? 0 });
}

export async function cropFromOriginal(image: LoadedImage, region: NormalizedRegion): Promise<ZoomCrop> {
  const valid = validateNormalizedRegion(region);
  const left = Math.max(0, Math.floor(valid.x * image.width));
  const top = Math.max(0, Math.floor(valid.y * image.height));
  const right = Math.min(image.width, Math.ceil((valid.x + valid.width) * image.width));
  const bottom = Math.min(image.height, Math.ceil((valid.y + valid.height) * image.height));
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  try {
    const buffer = await sharp(image.buffer).extract({ left, top, width, height }).png().toBuffer();
    return { region: valid, image: buffer, width, height };
  } catch (error) {
    throw mediaError(`Unable to crop ${image.source} at the requested region.`, error);
  }
}

export function defaultZoomRegion(): NormalizedRegion {
  return { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
}

export function gridZoomRegions(): NormalizedRegion[] {
  return [
    { x: 0, y: 0, width: 0.5, height: 0.5 },
    { x: 0.5, y: 0, width: 0.5, height: 0.5 },
    { x: 0, y: 0.5, width: 0.5, height: 0.5 },
    { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
  ];
}
