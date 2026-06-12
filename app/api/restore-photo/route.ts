import { NextResponse } from "next/server";

import {
  RestoreImageError,
  submitRestoreTaskWithDragonCode,
} from "@/lib/ai/restore-image";
import {
  acquireCardKeyGenerationLock,
  findAvailableCardKey,
  releaseCardKeyGenerationLock,
} from "@/lib/card-key";
import { CARD_KEY_STYLES } from "@/lib/card-key-styles";
import { readPhotoRestorePrompt } from "@/lib/prompts/photo-restore";
import { createRestoreJob, findActiveRestoreJobByCodeStyle } from "@/lib/restore-job";
import { hasServerSupabaseEnv } from "@/lib/supabase";
import { MAX_IMAGE_UPLOAD_FILE_SIZE, SUPPORTED_IMAGE_MIME_TYPES } from "@/lib/upload";

export const runtime = "nodejs";
export const maxDuration = 300;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);

  if (!formData) {
    return NextResponse.json(
      { ok: false, error: "请求体格式错误，必须使用 formData。" },
      { status: 400 },
    );
  }

  const code = formData.get("code");
  const style = formData.get("style");
  const file = formData.get("file");
  const normalizedCode = typeof code === "string" ? code.trim() : "";
  const normalizedStyle = typeof style === "string" ? style.trim() : "";

  if (!normalizedCode) {
    return NextResponse.json({ ok: false, error: "缺少有效的卡密 code。" }, { status: 400 });
  }

  if (normalizedStyle !== CARD_KEY_STYLES.RESTORE) {
    return NextResponse.json(
      { ok: false, error: "卡密不适用于老照片修复服务。" },
      { status: 400 },
    );
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "缺少上传图片 file。" }, { status: 400 });
  }

  if (!SUPPORTED_IMAGE_MIME_TYPES.includes(file.type as (typeof SUPPORTED_IMAGE_MIME_TYPES)[number])) {
    return NextResponse.json(
      { ok: false, error: "仅支持 JPG / PNG / WEBP 图片。" },
      { status: 400 },
    );
  }

  if (file.size > MAX_IMAGE_UPLOAD_FILE_SIZE) {
    return NextResponse.json(
      { ok: false, error: "图片过大，请上传 10 MB 以内文件。" },
      { status: 400 },
    );
  }

  try {
    if (!hasServerSupabaseEnv()) {
      return NextResponse.json(
        { ok: false, error: "Supabase 环境变量未配置完整。" },
        { status: 500 },
      );
    }

    const activeJob = await findActiveRestoreJobByCodeStyle(normalizedCode, normalizedStyle);

    if (activeJob) {
      return NextResponse.json({
        ok: true,
        data: {
          jobId: activeJob.job_id,
          code: activeJob.code,
          style: activeJob.style,
          status: activeJob.status,
          model: activeJob.model,
          taskId: activeJob.provider_task_id,
          createdAt: activeJob.created_at,
        },
      });
    }

    const verifyResult = await findAvailableCardKey(normalizedCode);

    if (!verifyResult.ok) {
      return NextResponse.json(
        { ok: false, error: verifyResult.error },
        { status: verifyResult.status },
      );
    }

    if (verifyResult.data.style !== CARD_KEY_STYLES.RESTORE) {
      return NextResponse.json(
        { ok: false, error: "卡密不适用于老照片修复服务。" },
        { status: 400 },
      );
    }

    const requestId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    let shouldReleaseLock = true;

    try {
      const lockResult = await acquireCardKeyGenerationLock(
        normalizedCode,
        normalizedStyle,
        requestId,
      );

      if (!lockResult.ok) {
        return NextResponse.json(
          { ok: false, error: lockResult.error },
          { status: lockResult.status },
        );
      }

      const prompt = await readPhotoRestorePrompt();
      const result = await submitRestoreTaskWithDragonCode({ image: file, prompt });
      const job = await createRestoreJob({
        jobId,
        code: normalizedCode,
        style: normalizedStyle,
        requestId,
        providerTaskId: result.taskId,
        model: result.model,
        originalFileName: file.name || null,
      });
      shouldReleaseLock = false;

      return NextResponse.json({
        ok: true,
        data: {
          jobId: job.job_id,
          code: job.code,
          style: job.style,
          status: job.status,
          model: job.model,
          taskId: result.taskId,
          createdAt: job.created_at,
        },
      });
    } finally {
      if (shouldReleaseLock) {
        await releaseCardKeyGenerationLock(normalizedCode, requestId).catch((releaseError) => {
          console.error("[restore-photo] 释放卡密锁失败", {
            code: normalizedCode,
            requestId,
            reason: getErrorMessage(releaseError),
          });
        });
      }
    }
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: getErrorMessage(error) || "老照片修复失败，请稍后重试。" },
      { status: error instanceof RestoreImageError ? error.status : 500 },
    );
  }
}
