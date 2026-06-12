import { NextResponse } from "next/server";

import {
  downloadRestoredImageWithDragonCode,
  getDragonCodeRestoreTimeoutMs,
  getRestoreTaskStatusWithDragonCode,
  RestoreImageError,
} from "@/lib/ai/restore-image";
import { consumeCardKey, releaseCardKeyGenerationLock } from "@/lib/card-key";
import {
  completeRestoreJob,
  ensureCardKeyJobAccess,
  findRestoreJobByJobId,
  isActiveRestoreJob,
  updateRestoreJobStatus,
  uploadRestoreResult,
} from "@/lib/restore-job";
import { hasServerSupabaseEnv, type RestoreJobRow } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}

function toRestoreJobResponse(job: RestoreJobRow) {
  return {
    jobId: job.job_id,
    code: job.code,
    style: job.style,
    status: job.status,
    model: job.model,
    taskId: job.provider_task_id,
    resultMimeType: job.result_mime_type,
    error: job.error_message,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    completedAt: job.completed_at,
  };
}

async function releaseJobLock(job: RestoreJobRow) {
  await releaseCardKeyGenerationLock(job.code, job.request_id).catch((releaseError) => {
    console.error("[restore-photo] 释放修复任务卡密锁失败", {
      jobId: job.job_id,
      code: job.code,
      requestId: job.request_id,
      reason: getErrorMessage(releaseError),
    });
  });
}

async function markFailedAndRelease(job: RestoreJobRow, message: string) {
  await releaseJobLock(job);
  return updateRestoreJobStatus(job.job_id, "failed", message);
}

async function markExpiredAndRelease(job: RestoreJobRow) {
  await releaseJobLock(job);
  return updateRestoreJobStatus(job.job_id, "expired", "修复任务已超时，请重新提交。");
}

async function processActiveJob(job: RestoreJobRow) {
  const createdAt = new Date(job.created_at).getTime();
  const isExpired =
    Number.isFinite(createdAt) &&
    Date.now() - createdAt >= getDragonCodeRestoreTimeoutMs();

  if (isExpired) {
    return markExpiredAndRelease(job);
  }

  const taskStatus = await getRestoreTaskStatusWithDragonCode(job.provider_task_id);

  if (taskStatus.status === "processing") {
    return updateRestoreJobStatus(job.job_id, "processing");
  }

  if (taskStatus.status === "failed") {
    return markFailedAndRelease(job, taskStatus.error);
  }

  try {
    const image = await downloadRestoredImageWithDragonCode(taskStatus.imageUrl);
    const storagePath = await uploadRestoreResult(job.job_id, image);
    const consumeResult = await consumeCardKey(job.code, job.style, job.request_id);

    if (!consumeResult.ok) {
      await new Promise((resolve) => setTimeout(resolve, 500));

      const latestJob = await findRestoreJobByJobId(job.job_id);

      if (latestJob?.status === "completed") {
        return latestJob;
      }

      return markFailedAndRelease(job, consumeResult.error);
    }

    return completeRestoreJob(job.job_id, {
      resultImageUrl: taskStatus.imageUrl,
      resultStoragePath: storagePath,
      resultMimeType: image.mimeType,
    });
  } catch (error) {
    return markFailedAndRelease(
      job,
      getErrorMessage(error) || "保存修复结果失败，请重新提交。",
    );
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId")?.trim();
  const code = searchParams.get("code")?.trim() ?? null;

  if (!jobId) {
    return NextResponse.json({ ok: false, error: "缺少有效的 jobId。" }, { status: 400 });
  }

  try {
    if (!hasServerSupabaseEnv()) {
      return NextResponse.json(
        { ok: false, error: "Supabase 环境变量未配置完整。" },
        { status: 500 },
      );
    }

    const job = await findRestoreJobByJobId(jobId);

    if (!job) {
      return NextResponse.json({ ok: false, error: "修复任务不存在。" }, { status: 404 });
    }

    const access = ensureCardKeyJobAccess(job, code);

    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
    }

    const latestJob = isActiveRestoreJob(job) ? await processActiveJob(job) : job;

    return NextResponse.json({
      ok: true,
      data: toRestoreJobResponse(latestJob),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: getErrorMessage(error) || "查询修复任务失败，请稍后重试。" },
      { status: error instanceof RestoreImageError ? error.status : 500 },
    );
  }
}
