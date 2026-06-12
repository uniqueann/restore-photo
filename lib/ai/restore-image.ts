type RestoreImageInput = {
  image: File;
  prompt: string;
};

export type RestoreTaskStatus =
  | {
      status: "processing";
      progress: number | null;
    }
  | {
      status: "completed";
      imageUrl: string;
    }
  | {
      status: "failed";
      error: string;
    };

export type RestoredImageDownload = {
  bytes: Buffer;
  imageBase64: string;
  mimeType: string;
};

type DragonCodeSubmitResponse = {
  code?: number;
  data?: Array<{
    status?: string;
    task_id?: string;
  }>;
  message?: string;
};

type DragonCodeTaskResponse = {
  code?: number;
  data?: {
    id?: string;
    status?: string;
    progress?: number;
    error?: {
      message?: string;
    };
    result?: {
      images?: Array<{
        url?: string[];
      }>;
    };
  };
  message?: string;
};

const DEFAULT_BASE_URL = "https://dragoncode.codes/gpt-image/v1";
const DEFAULT_MODEL = "gpt-image-2";
const DEFAULT_SIZE = "1:1";
const DEFAULT_RESOLUTION = "1k";
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_REQUEST_RETRY_COUNT = 2;
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

export class RestoreImageError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "RestoreImageError";
    this.status = status;
  }
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new RestoreImageError(`缺少环境变量 ${name}。`, 500);
  }

  return value;
}

function getNumberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]?.trim());

  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function getDragonCodeRestoreTimeoutMs() {
  return getNumberEnv("DRAGONCODE_RESTORE_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
}

function getDragonCodeConfig() {
  return {
    apiKey: requireEnv("DRAGONCODE_API_KEY"),
    baseUrl:
      process.env.DRAGONCODE_BASE_URL?.trim().replace(/\/+$/, "") ||
      DEFAULT_BASE_URL,
    model: process.env.DRAGONCODE_IMAGE_MODEL?.trim() || DEFAULT_MODEL,
    size: process.env.DRAGONCODE_IMAGE_SIZE?.trim() || DEFAULT_SIZE,
    resolution:
      process.env.DRAGONCODE_IMAGE_RESOLUTION?.trim() || DEFAULT_RESOLUTION,
    requestTimeoutMs: getNumberEnv(
      "DRAGONCODE_REQUEST_TIMEOUT_MS",
      DEFAULT_REQUEST_TIMEOUT_MS,
    ),
    requestRetryCount: getNumberEnv(
      "DRAGONCODE_REQUEST_RETRY_COUNT",
      DEFAULT_REQUEST_RETRY_COUNT,
    ),
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseJsonResponse<T>(response: Response) {
  const data = (await response.json().catch(() => null)) as T | null;

  if (!response.ok) {
    const message =
      data && typeof data === "object" && "message" in data
        ? String(data.message)
        : `第三方图片接口请求失败，状态码 ${response.status}`;

    throw new RestoreImageError(message, response.status);
  }

  if (!data) {
    throw new RestoreImageError("第三方图片接口返回了空响应。", 502);
  }

  return data;
}

async function fetchJson<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  retryCount: number,
) {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      return await parseJsonResponse<T>(response);
    } catch (error) {
      lastError = error;

      const isAbortError =
        error instanceof Error && error.name === "AbortError";
      const isRetryableStatus =
        error instanceof RestoreImageError &&
        RETRYABLE_STATUS_CODES.has(error.status);

      if (attempt >= retryCount || (!isAbortError && !isRetryableStatus)) {
        if (isAbortError) {
          throw new RestoreImageError("第三方修复接口请求超时，请稍后重试。", 504);
        }

        throw error;
      }

      await sleep(Math.min(1_000 * 2 ** attempt, 5_000));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new RestoreImageError("第三方修复接口请求失败，请稍后重试。", 502);
}

async function fileToDataUrl(image: File) {
  const arrayBuffer = await image.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const mimeType = image.type || "image/png";

  return `data:${mimeType};base64,${base64}`;
}

async function fetchRestoredImage(
  imageUrl: string,
  timeoutMs: number,
): Promise<RestoredImageDownload> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(imageUrl, {
      method: "GET",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`下载修复结果失败，状态码 ${response.status}`);
    }

    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim();

    if (!mimeType?.startsWith("image/")) {
      throw new Error("第三方修复结果不是有效图片。");
    }

    const arrayBuffer = await response.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);

    return {
      bytes,
      imageBase64: bytes.toString("base64"),
      mimeType,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function submitRestoreTaskWithDragonCode(input: RestoreImageInput) {
  const config = getDragonCodeConfig();
  const imageDataUrl = await fileToDataUrl(input.image);
  const response = await fetchJson<DragonCodeSubmitResponse>(
    `${config.baseUrl}/images/generations`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        prompt: input.prompt,
        n: 1,
        size: config.size,
        resolution: config.resolution,
        image_urls: [imageDataUrl],
      }),
    },
    config.requestTimeoutMs,
    config.requestRetryCount,
  );

  const taskId = response.data?.[0]?.task_id?.trim();

  if (response.code !== 200 || !taskId) {
    throw new RestoreImageError(response.message || "第三方修复任务提交失败。", 502);
  }

  return {
    model: config.model,
    taskId,
  };
}

export async function getRestoreTaskStatusWithDragonCode(
  taskId: string,
): Promise<RestoreTaskStatus> {
  const config = getDragonCodeConfig();
  const response = await fetchJson<DragonCodeTaskResponse>(
    `${config.baseUrl}/tasks/${encodeURIComponent(taskId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
    },
    config.requestTimeoutMs,
    config.requestRetryCount,
  );

  const task = response.data;
  const status = task?.status;

  if (response.code !== 200 || !task) {
    throw new RestoreImageError(response.message || "第三方修复任务查询失败。", 502);
  }

  if (status === "completed") {
    const imageUrl = task.result?.images?.[0]?.url?.[0]?.trim();

    if (!imageUrl) {
      throw new RestoreImageError("第三方修复任务完成，但未返回图片地址。", 502);
    }

    return {
      status: "completed",
      imageUrl,
    };
  }

  if (status === "failed") {
    return {
      status: "failed",
      error: task.error?.message || "第三方修复任务失败。",
    };
  }

  return {
    status: "processing",
    progress: typeof task.progress === "number" ? task.progress : null,
  };
}

export async function downloadRestoredImageWithDragonCode(
  imageUrl: string,
): Promise<RestoredImageDownload> {
  const config = getDragonCodeConfig();
  return fetchRestoredImage(imageUrl, config.requestTimeoutMs);
}
