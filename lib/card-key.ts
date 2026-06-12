import type { CardKeyRow } from "@/lib/supabase";
import { createServerSupabaseClient } from "@/lib/supabase";

const GENERATION_LOCK_TIMEOUT_MS = 10 * 60 * 1000;
const CARD_KEY_QUERY_RETRY_DELAYS_MS = [600, 1500];

type SupabaseErrorLike = {
  message?: string;
} | null;

type SupabaseQueryResult = {
  error: SupabaseErrorLike;
};

function isRetryableSupabaseError(error: SupabaseErrorLike) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("econnreset")
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCardKeyQuery<T extends SupabaseQueryResult>(
  operation: () => PromiseLike<T>,
) {
  let result = await operation();

  for (const delay of CARD_KEY_QUERY_RETRY_DELAYS_MS) {
    if (!isRetryableSupabaseError(result.error)) {
      return result;
    }

    await sleep(delay);
    result = await operation();
  }

  return result;
}

function getCardKeySelectFields() {
  return [
    "id",
    "code",
    "style",
    "used",
    "used_at",
    "claimed",
    "claimed_at",
    "claimed_channel",
    "claimed_request_id",
    "generation_request_id",
    "generation_started_at",
    "created_at",
  ].join(", ");
}

function hasExpiredGenerationLock(cardKey: Pick<CardKeyRow, "generation_started_at">) {
  if (!cardKey.generation_started_at) {
    return false;
  }

  const startedAt = new Date(cardKey.generation_started_at).getTime();

  if (Number.isNaN(startedAt)) {
    return false;
  }

  return Date.now() - startedAt >= GENERATION_LOCK_TIMEOUT_MS;
}

export async function findAvailableCardKey(code: string) {
  const supabase = createServerSupabaseClient();
  const normalizedCode = code.trim();

  const { data, error } = await runCardKeyQuery(() =>
    supabase
      .from("card_keys")
      .select(getCardKeySelectFields())
      .eq("code", normalizedCode)
      .maybeSingle<CardKeyRow>(),
  );

  if (error) {
    throw new Error(`查询卡密失败：${error.message}`);
  }

  if (!data) {
    return {
      ok: false as const,
      status: 404,
      error: "卡密不存在",
    };
  }

  if (data.used) {
    return {
      ok: false as const,
      status: 409,
      error: "卡密已使用",
    };
  }

  if (data.generation_started_at && !hasExpiredGenerationLock(data)) {
    return {
      ok: false as const,
      status: 409,
      error: "该卡密已有修复任务进行中，请稍后再试。",
    };
  }

  return {
    ok: true as const,
    status: 200,
    data,
  };
}

export async function acquireCardKeyGenerationLock(code: string, style: string, requestId: string) {
  const supabase = createServerSupabaseClient();
  const normalizedCode = code.trim();
  const now = new Date().toISOString();
  const lockExpiredBefore = new Date(Date.now() - GENERATION_LOCK_TIMEOUT_MS).toISOString();

  const { data, error } = await runCardKeyQuery(() =>
    supabase
      .from("card_keys")
      .update({
        generation_request_id: requestId,
        generation_started_at: now,
      })
      .eq("code", normalizedCode)
      .eq("style", style)
      .eq("used", false)
      .or(`generation_started_at.is.null,generation_started_at.lt.${lockExpiredBefore}`)
      .select(getCardKeySelectFields())
      .maybeSingle<CardKeyRow>(),
  );

  if (error) {
    throw new Error(`锁定卡密失败：${error.message}`);
  }

  if (!data) {
    const latestState = await findCardKeyByCode(normalizedCode);

    if (!latestState) {
      return {
        ok: false as const,
        status: 404,
        error: "卡密不存在",
      };
    }

    if (latestState.used) {
      return {
        ok: false as const,
        status: 409,
        error: "卡密已使用",
      };
    }

    return {
      ok: false as const,
      status: 409,
      error: "该卡密已有修复任务进行中，请稍后再试。",
    };
  }

  return {
    ok: true as const,
    status: 200,
    data,
  };
}

export async function releaseCardKeyGenerationLock(code: string, requestId: string) {
  const supabase = createServerSupabaseClient();
  const normalizedCode = code.trim();

  const { error } = await runCardKeyQuery(() =>
    supabase
      .from("card_keys")
      .update({
        generation_request_id: null,
        generation_started_at: null,
      })
      .eq("code", normalizedCode)
      .eq("generation_request_id", requestId),
  );

  if (error) {
    throw new Error(`释放卡密锁失败：${error.message}`);
  }
}

export async function consumeCardKey(code: string, style: string, requestId: string) {
  const supabase = createServerSupabaseClient();
  const normalizedCode = code.trim();

  const { data, error } = await runCardKeyQuery(() =>
    supabase
      .from("card_keys")
      .update({
        used: true,
        used_at: new Date().toISOString(),
        generation_request_id: null,
        generation_started_at: null,
      })
      .eq("code", normalizedCode)
      .eq("style", style)
      .eq("used", false)
      .eq("generation_request_id", requestId)
      .select(getCardKeySelectFields())
      .maybeSingle<CardKeyRow>(),
  );

  if (error) {
    throw new Error(`消费卡密失败：${error.message}`);
  }

  if (!data) {
    return {
      ok: false as const,
      status: 409,
      error: "卡密已使用或与服务不匹配",
    };
  }

  return {
    ok: true as const,
    status: 200,
    data,
  };
}

async function findCardKeyByCode(code: string) {
  const supabase = createServerSupabaseClient();

  const { data, error } = await runCardKeyQuery(() =>
    supabase
      .from("card_keys")
      .select(getCardKeySelectFields())
      .eq("code", code)
      .maybeSingle<CardKeyRow>(),
  );

  if (error) {
    throw new Error(`查询卡密失败：${error.message}`);
  }

  return data;
}
