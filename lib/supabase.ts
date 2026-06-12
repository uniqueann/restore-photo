import dns from "node:dns";

import { createClient } from "@supabase/supabase-js";

dns.setDefaultResultOrder("ipv4first");

export type CardKeyRow = {
  id: string;
  code: string;
  style: string;
  used: boolean;
  used_at: string | null;
  claimed: boolean;
  claimed_at: string | null;
  claimed_channel: string | null;
  claimed_request_id: string | null;
  generation_request_id: string | null;
  generation_started_at: string | null;
  created_at: string;
};

export type RestoreJobStatus = "queued" | "processing" | "completed" | "failed" | "expired";

export type RestoreJobRow = {
  id: string;
  job_id: string;
  code: string;
  style: string;
  request_id: string;
  provider_task_id: string;
  status: RestoreJobStatus;
  model: string;
  original_file_name: string | null;
  result_image_url: string | null;
  result_storage_path: string | null;
  result_mime_type: string | null;
  user_id: string | null;
  access_mode: "card-key" | "session";
  credit_reserved: boolean;
  credit_consumed: boolean;
  credit_released: boolean;
  credit_source: "monthly" | "credit_balance" | "card_key" | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

function getEnv(name: string) {
  return process.env[name]?.trim() ?? "";
}

export function getSupabaseConfig() {
  return {
    url: getEnv("NEXT_PUBLIC_SUPABASE_URL"),
    anonKey: getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    serviceRoleKey: getEnv("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

export function hasServerSupabaseEnv() {
  const { url, serviceRoleKey } = getSupabaseConfig();
  return Boolean(url && serviceRoleKey);
}

export function createServerSupabaseClient() {
  const { url, serviceRoleKey } = getSupabaseConfig();

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase 服务端环境变量未配置完整。");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
