import type { RestoredImageDownload } from "@/lib/ai/restore-image";
import type { RestoreJobRow, RestoreJobStatus } from "@/lib/supabase";
import { createServerSupabaseClient } from "@/lib/supabase";

const RESTORE_RESULTS_BUCKET = "restore-results";
const ACTIVE_RESTORE_JOB_STATUSES: RestoreJobStatus[] = ["queued", "processing"];

function getRestoreJobSelectFields() {
  return [
    "id",
    "job_id",
    "code",
    "style",
    "request_id",
    "provider_task_id",
    "status",
    "model",
    "original_file_name",
    "result_image_url",
    "result_storage_path",
    "result_mime_type",
    "user_id",
    "access_mode",
    "credit_reserved",
    "credit_consumed",
    "credit_released",
    "credit_source",
    "error_message",
    "created_at",
    "updated_at",
    "completed_at",
  ].join(", ");
}

function getImageExtension(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

export function isActiveRestoreJob(job: Pick<RestoreJobRow, "status">) {
  return ACTIVE_RESTORE_JOB_STATUSES.includes(job.status);
}

export async function findActiveRestoreJobByCodeStyle(code: string, style: string) {
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("restore_jobs")
    .select(getRestoreJobSelectFields())
    .eq("code", code.trim())
    .eq("style", style.trim())
    .eq("access_mode", "card-key")
    .in("status", ACTIVE_RESTORE_JOB_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<RestoreJobRow>();

  if (error) {
    throw new Error(`查询修复任务失败：${error.message}`);
  }

  return data;
}

export async function createRestoreJob(input: {
  jobId: string;
  code: string;
  style: string;
  requestId: string;
  providerTaskId: string;
  model: string;
  originalFileName: string | null;
}) {
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("restore_jobs")
    .insert({
      job_id: input.jobId,
      code: input.code.trim(),
      style: input.style.trim(),
      request_id: input.requestId,
      provider_task_id: input.providerTaskId,
      status: "processing",
      model: input.model,
      original_file_name: input.originalFileName,
      access_mode: "card-key",
      credit_reserved: false,
      credit_consumed: false,
      credit_released: false,
      credit_source: "card_key",
    })
    .select(getRestoreJobSelectFields())
    .single<RestoreJobRow>();

  if (error) {
    throw new Error(`创建修复任务失败：${error.message}`);
  }

  return data;
}

export async function findRestoreJobByJobId(jobId: string) {
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("restore_jobs")
    .select(getRestoreJobSelectFields())
    .eq("job_id", jobId.trim())
    .maybeSingle<RestoreJobRow>();

  if (error) {
    throw new Error(`查询修复任务失败：${error.message}`);
  }

  return data;
}

export async function updateRestoreJobStatus(
  jobId: string,
  status: RestoreJobStatus,
  errorMessage: string | null = null,
) {
  const supabase = createServerSupabaseClient();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("restore_jobs")
    .update({
      status,
      error_message: errorMessage,
      updated_at: now,
      completed_at: ["completed", "failed", "expired"].includes(status) ? now : null,
    })
    .eq("job_id", jobId)
    .select(getRestoreJobSelectFields())
    .single<RestoreJobRow>();

  if (error) {
    throw new Error(`更新修复任务状态失败：${error.message}`);
  }

  return data;
}

export async function completeRestoreJob(
  jobId: string,
  input: {
    resultImageUrl: string;
    resultStoragePath: string;
    resultMimeType: string;
  },
) {
  const supabase = createServerSupabaseClient();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("restore_jobs")
    .update({
      status: "completed",
      result_image_url: input.resultImageUrl,
      result_storage_path: input.resultStoragePath,
      result_mime_type: input.resultMimeType,
      credit_consumed: false,
      credit_released: false,
      credit_source: "card_key",
      error_message: null,
      updated_at: now,
      completed_at: now,
    })
    .eq("job_id", jobId)
    .select(getRestoreJobSelectFields())
    .single<RestoreJobRow>();

  if (error) {
    throw new Error(`保存修复任务结果失败：${error.message}`);
  }

  return data;
}

export async function uploadRestoreResult(jobId: string, image: RestoredImageDownload) {
  const supabase = createServerSupabaseClient();
  const extension = getImageExtension(image.mimeType);
  const path = `${jobId}/restored.${extension}`;

  const { error } = await supabase.storage
    .from(RESTORE_RESULTS_BUCKET)
    .upload(path, image.bytes, {
      contentType: image.mimeType,
      upsert: true,
    });

  if (error) {
    throw new Error(`上传修复结果失败：${error.message}`);
  }

  return path;
}

export async function downloadRestoreResult(storagePath: string) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.storage
    .from(RESTORE_RESULTS_BUCKET)
    .download(storagePath);

  if (error) {
    throw new Error(`读取修复结果失败：${error.message}`);
  }

  const arrayBuffer = await data.arrayBuffer();

  return Buffer.from(arrayBuffer).toString("base64");
}

export function ensureCardKeyJobAccess(job: RestoreJobRow, code: string | null) {
  const normalizedCode = code?.trim();

  if (!normalizedCode || normalizedCode !== job.code) {
    return {
      ok: false as const,
      status: 403,
      error: "无权查看该修复任务。",
    };
  }

  return { ok: true as const };
}
