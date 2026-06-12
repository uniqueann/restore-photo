import { NextResponse } from "next/server";

import { findAvailableCardKey } from "@/lib/card-key";
import { CARD_KEY_STYLES } from "@/lib/card-key-styles";
import { hasServerSupabaseEnv } from "@/lib/supabase";

function maskCardKeyError() {
  return NextResponse.json(
    { ok: false, error: "卡密不可用或不存在。" },
    { status: 404 },
  );
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { code?: string }
    | null;

  const code = body?.code?.trim();

  if (!hasServerSupabaseEnv()) {
    return NextResponse.json(
      { ok: false, error: "Supabase 环境变量未配置完整。" },
      { status: 500 },
    );
  }

  if (!code) {
    return NextResponse.json({ ok: false, error: "缺少卡密 code。" }, { status: 400 });
  }

  try {
    const result = await findAvailableCardKey(code);

    if (!result.ok) {
      return maskCardKeyError();
    }

    if (result.data.style !== CARD_KEY_STYLES.RESTORE) {
      return NextResponse.json(
        { ok: false, error: "该卡密不适用于老照片修复服务。" },
        { status: 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      data: {
        code: result.data.code,
        style: result.data.style,
        used: result.data.used,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "卡密校验失败，请稍后重试。";

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
