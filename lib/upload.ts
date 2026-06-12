export const SUPPORTED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export const MAX_IMAGE_UPLOAD_FILE_SIZE = 10 * 1024 * 1024;

export function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
