import { NextResponse } from "next/server";

import {
  downloadRestoreResult,
  ensureCardKeyJobAccess,
  findRestoreJobByJobId,
} from "@/lib/restore-job";
import { hasServerSupabaseEnv } from "@/lib/supabase";

export const runtime = "nodejs";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
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

    if (job.status !== "completed" || !job.result_storage_path || !job.result_mime_type) {
      return NextResponse.json(
        { ok: false, error: "修复结果尚未生成。" },
        { status: 409 },
      );
    }

    const imageBase64 = await downloadRestoreResult(job.result_storage_path);

    return NextResponse.json({
      ok: true,
      data: {
        jobId: job.job_id,
        code: job.code,
        model: job.model,
        mimeType: job.result_mime_type,
        imageBase64,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: getErrorMessage(error) || "读取修复结果失败，请稍后重试。" },
      { status: 500 },
    );
  }
}
