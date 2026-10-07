// Catalogue image rules, shared by the upload UI (instant feedback) and the
// Server Actions (authoritative: they also check the file's actual bytes).
// The Storage buckets enforce the same size and MIME limits (migrations 012/014).

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];
/** For <input accept>. */
export const IMAGE_ACCEPT = IMAGE_MIME_TYPES.join(",");
export const ALT_TEXT_MAX_LENGTH = 300;

export const PRODUCT_IMAGES_BUCKET = "product-images";
export const CATEGORY_IMAGES_BUCKET = "category-images";

export type ImageFileError = "imageType" | "imageSize" | "imageEmpty";

export function isImageMimeType(value: string): value is ImageMimeType {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

/** Declared type + size check (cheap; usable in the browser). */
export function validateImageFile(file: { type: string; size: number }): ImageFileError | null {
  if (file.size === 0) return "imageEmpty";
  if (!isImageMimeType(file.type)) return "imageType";
  if (file.size > IMAGE_MAX_BYTES) return "imageSize";
  return null;
}

export const extensionFor: Record<ImageMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Detects JPEG / PNG / WebP from the file signature (never trusts the name or declared type). */
export function sniffImageType(bytes: Uint8Array): ImageMimeType | null {
  const startsWith = (signature: number[], offset = 0) =>
    signature.every((byte, index) => bytes[offset + index] === byte);
  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }
  return null;
}
