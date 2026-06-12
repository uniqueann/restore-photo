import { readFile } from "node:fs/promises";
import path from "node:path";

const PHOTO_RESTORE_PROMPT_PATH = path.join(process.cwd(), "prompts", "photo-restore.md");

export async function readPhotoRestorePrompt() {
  const content = await readFile(PHOTO_RESTORE_PROMPT_PATH, "utf8");
  const prompt = content.trim();

  if (!prompt) {
    throw new Error("photo-restore prompt 为空，请检查 prompts/photo-restore.md");
  }

  return prompt;
}
