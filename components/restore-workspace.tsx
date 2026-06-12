"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import {
  formatFileSize,
  MAX_IMAGE_UPLOAD_FILE_SIZE,
  SUPPORTED_IMAGE_MIME_TYPES,
} from "@/lib/upload";

type VerifyKeyResponse =
  | {
      ok: true;
      data: {
        code: string;
        style: string;
        used: boolean;
      };
    }
  | {
      ok: false;
      error: string;
    };

type RestoreJobStatus = "queued" | "processing" | "completed" | "failed" | "expired";

type RestoreResponse =
  | {
      ok: true;
      data: {
        jobId: string;
        code: string;
        style: string;
        status: RestoreJobStatus;
        model: string;
        taskId: string;
        createdAt: string;
      };
    }
  | {
      ok: false;
      error: string;
    };

type RestoreStatusResponse =
  | {
      ok: true;
      data: {
        jobId: string;
        code: string;
        style: string;
        status: RestoreJobStatus;
        model: string;
        taskId: string;
        resultMimeType: string | null;
        error: string | null;
        createdAt: string;
        updatedAt: string;
        completedAt: string | null;
      };
    }
  | {
      ok: false;
      error: string;
    };

type RestoreResultResponse =
  | {
      ok: true;
      data: {
        jobId: string;
        code: string;
        model: string;
        mimeType: string;
        imageBase64: string;
      };
    }
  | {
      ok: false;
      error: string;
    };

type StoredRestoreJob = {
  jobId: string;
  code: string;
  style: string;
  fileName: string | null;
  downloadName: string;
  startedAt: number;
  progressCap: number;
};

const RESTORE_JOB_STORAGE_KEY = "restore-photo.active-job";

function getRestoreJobQuery(job: StoredRestoreJob) {
  return new URLSearchParams({
    jobId: job.jobId,
    code: job.code,
  }).toString();
}

function toPreviewUrl(file: File | null) {
  if (!file) return "";
  return URL.createObjectURL(file);
}

function getRandomRestoreProgressCap() {
  return 88 + Math.random() * 6;
}

function base64ToBlob(base64: string, mimeType: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

function getDownloadName(fileName: string | null) {
  if (!fileName) {
    return "restored-photo.png";
  }

  const name = fileName.replace(/\.[^.]+$/, "");
  return `${name}-restored.png`;
}

function readStoredRestoreJob() {
  const rawValue = window.localStorage.getItem(RESTORE_JOB_STORAGE_KEY);

  if (!rawValue) {
    return null;
  }

  try {
    const value = JSON.parse(rawValue) as Partial<StoredRestoreJob>;

    if (!value.jobId || !value.code || !value.style || !value.downloadName) {
      return null;
    }

    return {
      jobId: value.jobId,
      code: value.code,
      style: value.style,
      fileName: value.fileName ?? null,
      downloadName: value.downloadName,
      startedAt: typeof value.startedAt === "number" ? value.startedAt : Date.now(),
      progressCap: typeof value.progressCap === "number" ? value.progressCap : 92,
    } satisfies StoredRestoreJob;
  } catch {
    return null;
  }
}

function writeStoredRestoreJob(job: StoredRestoreJob) {
  window.localStorage.setItem(RESTORE_JOB_STORAGE_KEY, JSON.stringify(job));
}

function clearStoredRestoreJob() {
  window.localStorage.removeItem(RESTORE_JOB_STORAGE_KEY);
}

function getClientErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error) {
    return error;
  }

  return fallbackMessage;
}

async function readJsonResponse<T extends { ok: boolean; error?: string }>(
  response: Response,
  fallbackMessage: string,
) {
  const text = await response.text();
  const result = text
    ? (() => {
        try {
          return JSON.parse(text) as T;
        } catch {
          return null;
        }
      })()
    : null;

  if (!result) {
    throw new Error(`${fallbackMessage}，状态码 ${response.status}`);
  }

  return result;
}

function ImageIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-7 w-7"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    >
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="m8 14 2.4-2.4a1.2 1.2 0 0 1 1.7 0L17 16.5" />
      <path d="m14.5 14 1.2-1.2a1.1 1.1 0 0 1 1.6 0L21 16.5" />
      <circle cx="8.5" cy="8.5" r="1.4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="3"
    >
      <path d="m20 6-11 11-5-5" />
    </svg>
  );
}

export function RestoreWorkspace() {
  const [code, setCode] = useState("");
  const [verifiedCode, setVerifiedCode] = useState("");
  const [verifiedStyle, setVerifiedStyle] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [beforeUrl, setBeforeUrl] = useState("");
  const [afterDataUrl, setAfterDataUrl] = useState("");
  const [restoredImageFile, setRestoredImageFile] = useState<File | null>(null);
  const [status, setStatus] = useState("输入卡密并校验后，即可上传老照片。");
  const [statusType, setStatusType] = useState<"idle" | "success" | "error">("idle");
  const [resultMessage, setResultMessage] = useState("等待开始修复。");
  const [resultType, setResultType] = useState<"idle" | "success" | "error">("idle");
  const [restoreProgress, setRestoreProgress] = useState(0);
  const [activeRestoreJob, setActiveRestoreJob] = useState<StoredRestoreJob | null>(null);
  const [resultDownloadName, setResultDownloadName] = useState("");
  const [isVerifying, startVerify] = useTransition();
  const [isRestoring, setIsRestoring] = useState(false);
  const restoreInFlightRef = useRef(false);
  const restoreStartedAtRef = useRef(0);
  const restoreProgressCapRef = useRef(0);

  const uploadDisabled = !verifiedStyle || isRestoring;
  const restoreDisabled = !verifiedStyle || !selectedImage || isRestoring;

  const downloadName = useMemo(() => {
    if (resultDownloadName) {
      return resultDownloadName;
    }

    return getDownloadName(selectedImage?.name ?? null);
  }, [resultDownloadName, selectedImage]);

  useEffect(() => {
    return () => {
      if (beforeUrl) {
        URL.revokeObjectURL(beforeUrl);
      }

      if (afterDataUrl.startsWith("blob:")) {
        URL.revokeObjectURL(afterDataUrl);
      }
    };
  }, [afterDataUrl, beforeUrl]);

  useEffect(() => {
    const storedJob = readStoredRestoreJob();

    if (!storedJob) {
      return;
    }

    const restoreTimer = window.setTimeout(() => {
      setCode(storedJob.code);
      setVerifiedCode(storedJob.code);
      setVerifiedStyle(storedJob.style);
      setStatusType("success");
      setStatus("已恢复进行中的修复任务。");
      setResultType("idle");
      setResultMessage("已恢复修复任务，正在继续查询结果...");
      setResultDownloadName(storedJob.downloadName);
      setRestoreProgress(3);
      setActiveRestoreJob(storedJob);
      restoreInFlightRef.current = true;
      restoreStartedAtRef.current = storedJob.startedAt;
      restoreProgressCapRef.current = storedJob.progressCap;
      setIsRestoring(true);
    }, 0);

    return () => window.clearTimeout(restoreTimer);
  }, []);

  useEffect(() => {
    if (!isRestoring) {
      return;
    }

    const progressTimer = window.setInterval(() => {
      const startedAt = restoreStartedAtRef.current;
      const cap = restoreProgressCapRef.current || 92;

      if (!startedAt) {
        return;
      }

      const elapsedRatio = Math.min(1, (Date.now() - startedAt) / 120_000);
      const easedProgress = 1 - Math.pow(1 - elapsedRatio, 2.2);
      const nextProgress = 3 + (cap - 3) * easedProgress;

      setRestoreProgress(Math.min(cap, Math.round(nextProgress * 10) / 10));
    }, 1_200);

    return () => window.clearInterval(progressTimer);
  }, [isRestoring]);

  useEffect(() => {
    if (!activeRestoreJob) {
      return;
    }

    const pollingJob = activeRestoreJob;
    let isCancelled = false;

    async function loadRestoreResult(job: StoredRestoreJob, model: string, codeValue: string) {
      const response = await fetch(`/api/restore-photo/result?${getRestoreJobQuery(job)}`);
      const result = await readJsonResponse<RestoreResultResponse>(
        response,
        "读取修复结果失败",
      );

      if (!response.ok || !result.ok) {
        throw new Error(result.ok ? "读取修复结果失败。" : result.error);
      }

      const restoredBlob = base64ToBlob(
        result.data.imageBase64,
        result.data.mimeType || "image/png",
      );
      const restoredFile = new File([restoredBlob], job.downloadName, {
        type: restoredBlob.type || "image/png",
      });
      const restoredUrl = URL.createObjectURL(restoredBlob);

      if (afterDataUrl.startsWith("blob:")) {
        URL.revokeObjectURL(afterDataUrl);
      }

      clearStoredRestoreJob();
      setRestoredImageFile(restoredFile);
      setAfterDataUrl(restoredUrl);
      setResultDownloadName(job.downloadName);
      setRestoreProgress(100);
      setResultType("success");
      setResultMessage(`修复成功，卡密 ${codeValue} 已消费，模型：${model}`);
      restoreInFlightRef.current = false;
      restoreStartedAtRef.current = 0;
      restoreProgressCapRef.current = 0;
      setActiveRestoreJob(null);
      setIsRestoring(false);
    }

    async function pollRestoreJob() {
      try {
        const response = await fetch(
          `/api/restore-photo/status?${getRestoreJobQuery(pollingJob)}`,
        );
        const result = await readJsonResponse<RestoreStatusResponse>(
          response,
          "查询修复任务失败",
        );

        if (isCancelled) {
          return;
        }

        if (!response.ok || !result.ok) {
          throw new Error(result.ok ? "查询修复任务失败。" : result.error);
        }

        if (result.data.status === "completed") {
          await loadRestoreResult(pollingJob, result.data.model, result.data.code);
          return;
        }

        if (result.data.status === "failed" || result.data.status === "expired") {
          clearStoredRestoreJob();
          restoreInFlightRef.current = false;
          restoreStartedAtRef.current = 0;
          restoreProgressCapRef.current = 0;
          setRestoreProgress(0);
          setResultType("error");
          setResultMessage(result.data.error || "修复任务失败，请重新提交。");
          setActiveRestoreJob(null);
          setIsRestoring(false);
          return;
        }

        setResultType("idle");
        setResultMessage("修复任务正在处理中，刷新页面后也会自动继续查询。");
      } catch (error) {
        if (isCancelled) {
          return;
        }

        setResultType("error");
        setResultMessage(getClientErrorMessage(error, "查询修复任务失败，请稍后重试。"));
      }
    }

    void pollRestoreJob();
    const pollTimer = window.setInterval(() => {
      void pollRestoreJob();
    }, 5_000);

    return () => {
      isCancelled = true;
      window.clearInterval(pollTimer);
    };
  }, [activeRestoreJob, afterDataUrl]);

  function validateImage(file: File) {
    if (!SUPPORTED_IMAGE_MIME_TYPES.includes(file.type as (typeof SUPPORTED_IMAGE_MIME_TYPES)[number])) {
      return "仅支持 JPG / PNG / WEBP 图片。";
    }

    if (file.size > MAX_IMAGE_UPLOAD_FILE_SIZE) {
      return `图片过大（${formatFileSize(file.size)}），请上传 10 MB 以内图片。`;
    }

    return null;
  }

  function resetResult() {
    if (afterDataUrl.startsWith("blob:")) {
      URL.revokeObjectURL(afterDataUrl);
    }

    setAfterDataUrl("");
    setRestoredImageFile(null);
    setResultDownloadName("");
    setResultType("idle");
    setResultMessage("等待开始修复。");

    if (!restoreInFlightRef.current) {
      clearStoredRestoreJob();
      setActiveRestoreJob(null);
      setRestoreProgress(0);
      restoreStartedAtRef.current = 0;
      restoreProgressCapRef.current = 0;
    }
  }

  function resetCardKeyState() {
    setVerifiedStyle(null);
    setVerifiedCode("");
    setSelectedImage(null);

    if (beforeUrl) {
      URL.revokeObjectURL(beforeUrl);
    }

    setBeforeUrl("");
    setStatusType("idle");
    setStatus("输入卡密并校验后，即可上传老照片。");
    resetResult();
  }

  function handleCodeChange(nextCode: string) {
    setCode(nextCode);

    if (nextCode.trim() !== verifiedCode) {
      resetCardKeyState();
    }
  }

  function handleSelectFile(file: File | null) {
    if (!file) {
      setSelectedImage(null);
      setBeforeUrl("");
      resetResult();
      return;
    }

    const error = validateImage(file);

    if (error) {
      setResultType("error");
      setResultMessage(error);
      return;
    }

    if (beforeUrl) {
      URL.revokeObjectURL(beforeUrl);
    }

    setSelectedImage(file);
    setBeforeUrl(toPreviewUrl(file));
    resetResult();
  }

  function handleVerify() {
    const normalizedCode = code.trim();

    if (!normalizedCode) {
      setStatusType("error");
      setStatus("请先输入卡密。");
      return;
    }

    startVerify(async () => {
      setStatusType("idle");
      setStatus("正在校验卡密...");

      try {
        const response = await fetch("/api/verify-key", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: normalizedCode }),
        });

        const result = await readJsonResponse<VerifyKeyResponse>(
          response,
          "卡密校验请求失败",
        );

        if (!response.ok || !result.ok) {
          setStatusType("error");
          setStatus(result.ok ? "卡密校验失败。" : result.error);
          setVerifiedCode("");
          setVerifiedStyle(null);
          setSelectedImage(null);
          setBeforeUrl("");
          resetResult();
          return;
        }

        setVerifiedCode(result.data.code);
        setVerifiedStyle(result.data.style);
        setStatusType("success");
        setStatus("卡密有效，可以上传照片。");
      } catch {
        setStatusType("error");
        setStatus("网络错误，请稍后重试。");
      }
    });
  }

  function handleRestore() {
    if (restoreInFlightRef.current) {
      return;
    }

    if (!selectedImage || !verifiedStyle) {
      setResultType("error");
      setResultMessage("请先完成卡密校验并上传图片。");
      return;
    }

    const imageForRestore = selectedImage;
    const styleForRestore = verifiedStyle;
    restoreInFlightRef.current = true;
    setIsRestoring(true);

    async function submitRestoreRequest() {
      const startedAt = Date.now();
      const progressCap = getRandomRestoreProgressCap();
      const pendingDownloadName = getDownloadName(imageForRestore.name);

      if (afterDataUrl.startsWith("blob:")) {
        URL.revokeObjectURL(afterDataUrl);
      }

      setAfterDataUrl("");
      setRestoredImageFile(null);
      setResultDownloadName(pendingDownloadName);
      setRestoreProgress(3);
      restoreStartedAtRef.current = startedAt;
      restoreProgressCapRef.current = progressCap;
      setResultType("idle");
      setResultMessage("正在提交修复任务，请稍候...");

      try {
        const formData = new FormData();
        formData.append("code", verifiedCode);
        formData.append("style", styleForRestore);
        formData.append("file", imageForRestore);

        const response = await fetch("/api/restore-photo", {
          method: "POST",
          body: formData,
        });

        const result = await readJsonResponse<RestoreResponse>(
          response,
          "修复请求失败",
        );

        if (!response.ok || !result.ok) {
          setRestoreProgress(0);
          restoreInFlightRef.current = false;
          restoreStartedAtRef.current = 0;
          restoreProgressCapRef.current = 0;
          setResultType("error");
          setResultMessage(result.ok ? "修复失败。" : result.error);
          setIsRestoring(false);
          return;
        }

        const activeJob = {
          jobId: result.data.jobId,
          code: result.data.code,
          style: result.data.style,
          fileName: imageForRestore.name || null,
          downloadName: pendingDownloadName,
          startedAt,
          progressCap,
        } satisfies StoredRestoreJob;

        writeStoredRestoreJob(activeJob);
        setActiveRestoreJob(activeJob);
        setResultType("idle");
        setResultMessage("修复任务已提交，正在等待模型返回结果。");
      } catch (error) {
        setRestoreProgress(0);
        restoreInFlightRef.current = false;
        restoreStartedAtRef.current = 0;
        restoreProgressCapRef.current = 0;
        setResultType("error");
        setResultMessage(getClientErrorMessage(error, "修复请求失败，请稍后重试。"));
        setIsRestoring(false);
      }
    }

    void submitRestoreRequest();
  }

  function handleDownload() {
    if (!afterDataUrl) return;

    const a = document.createElement("a");
    a.href = afterDataUrl;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function handleShare() {
    if (!restoredImageFile) {
      handleDownload();
      return;
    }

    const shareData = {
      files: [restoredImageFile],
      title: "修复后的老照片",
      text: "保存修复后的老照片",
    };

    if (navigator.canShare?.(shareData) && navigator.share) {
      await navigator.share(shareData).catch(() => undefined);
      return;
    }

    handleDownload();
  }

  const step1Done = !!verifiedStyle;
  const step2Done = (!!selectedImage || !!activeRestoreJob) && step1Done;
  const step3Done = resultType === "success";
  const restoreProgressLabel = `${Math.round(restoreProgress)}%`;
  const restoreProgressMessage =
    restoreProgress < 32
      ? "正在分析照片损伤、曝光与主体结构"
      : restoreProgress < 68
        ? "正在重建面部细节、材质层次与画面微反差"
        : "正在统一色彩、锐度与真实摄影质感";

  return (
    <main
      className="min-h-screen bg-[var(--page-bg)] px-5 py-7 text-[var(--text-main)]"
    >
      <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-[540px] flex-col">
        <header className="flex items-center justify-between">
          <Link href="/" className="text-[22px] font-extrabold tracking-tight text-[var(--brand)]">
            content.up
          </Link>
          <div className="pill-button">Photo Restore</div>
        </header>

        <nav className="mt-8 flex items-center gap-4" aria-label="修复步骤">
          <StepDot done={step1Done} active={!step1Done} label="1" />
          <StepLine done={step1Done} />
          <StepDot done={step2Done} active={step1Done && !step2Done} label="2" />
          <StepLine done={step2Done} />
          <StepDot done={step3Done} active={step2Done && !step3Done} label="3" />
        </nav>

        <section className="soft-panel mt-5 flex-1 px-5 py-6 sm:px-6 sm:py-7">
          <div className="mb-5">
            <h1 className="text-[30px] font-black leading-tight tracking-[-0.01em] sm:text-[34px]">
              老照片修复
            </h1>
            <p className="mt-2 text-[15px] font-semibold leading-6 text-[var(--text-muted)]">
              校验卡密 → 上传老照片 → 点击开始修复。
            </p>
          </div>

          <div className="inner-panel p-4 sm:p-5">
            <SectionTitle number="1" title="输入卡密" />
            <input
              className="field-input mt-4"
              disabled={isRestoring}
              value={code}
              onChange={(event) => handleCodeChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !isVerifying && !isRestoring) {
                  handleVerify();
                }
              }}
              placeholder="请输入卡密"
            />
            <button
              type="button"
              className="primary-button mt-4 w-full"
              onClick={handleVerify}
              disabled={isVerifying || isRestoring}
            >
              {isVerifying ? "校验中..." : "校验卡密"}
            </button>
            <StatusLine type={statusType} text={status} />
          </div>

          <div className="inner-panel mt-4 p-4 sm:p-5">
            <SectionTitle number="2" title="上传老照片" />
            <label
              className={`upload-frame mt-4 flex items-center justify-center px-5 text-center ${
                uploadDisabled ? "cursor-not-allowed" : "cursor-pointer"
              }`}
            >
              <input
                type="file"
                accept={SUPPORTED_IMAGE_MIME_TYPES.join(",")}
                disabled={uploadDisabled}
                className="hidden"
                onChange={(event) => {
                  handleSelectFile(event.target.files?.[0] ?? null);
                  event.target.value = "";
                }}
              />
              {selectedImage ? (
                <span>
                  <span className="block text-[15px] font-extrabold text-[var(--text-main)]">
                    {selectedImage.name}
                  </span>
                  <span className="mt-1 block text-[13px] font-bold text-[var(--text-muted)]">
                    {formatFileSize(selectedImage.size)}
                  </span>
                </span>
              ) : (
                <span className="flex flex-col items-center text-[var(--text-muted)]">
                  <ImageIcon />
                  <span className="mt-3 text-[15px] font-extrabold">
                    {isRestoring
                      ? "修复任务进行中"
                      : uploadDisabled
                        ? "请先完成卡密校验"
                        : "点击上传照片"}
                  </span>
                  <span className="mt-1 text-[13px] font-bold">
                    最大 {formatFileSize(MAX_IMAGE_UPLOAD_FILE_SIZE)}
                  </span>
                </span>
              )}
            </label>
            <button
              type="button"
              className="primary-button mt-4 w-full"
              onClick={handleRestore}
              disabled={restoreDisabled}
            >
              {isRestoring ? "修复中..." : "开始修复"}
            </button>
            <StatusLine type={resultType} text={resultMessage} />
          </div>

          <div className="inner-panel mt-4 p-4 sm:p-5">
            <h2 className="text-[18px] font-black">修复预览</h2>
            <PreviewBlock label="修复前" imageUrl={beforeUrl} emptyText={activeRestoreJob ? "已恢复任务" : "等待上传"} />
            <PreviewBlock
              label="修复后"
              imageUrl={afterDataUrl}
              emptyText="等待结果"
              isRestoring={isRestoring}
              progressLabel={restoreProgressLabel}
              progress={restoreProgress}
              progressMessage={restoreProgressMessage}
            />
            <button
              type="button"
              className="secondary-button mt-4 w-full"
              onClick={handleDownload}
              disabled={!afterDataUrl}
            >
              下载修复图片
            </button>
            <button
              type="button"
              className="secondary-button mt-3 w-full"
              onClick={handleShare}
              disabled={!afterDataUrl}
            >
              保存/分享图片
            </button>
          </div>
        </section>

      </div>
    </main>
  );
}

function StepDot({
  done,
  active,
  label,
}: {
  done: boolean;
  active: boolean;
  label: string;
}) {
  return (
    <div
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[15px] font-black ${
        done || active
          ? "bg-[#d9edff] text-[var(--brand)] shadow-[0_8px_18px_rgba(34,132,232,0.18)]"
          : "border border-[var(--line)] bg-[var(--surface)] text-[var(--text-muted)]"
      }`}
    >
      {done ? <CheckIcon /> : label}
    </div>
  );
}

function StepLine({ done }: { done: boolean }) {
  return (
    <div
      className={`h-px w-14 ${
        done ? "bg-[var(--brand)] opacity-45" : "bg-[var(--line-strong)]"
      }`}
    />
  );
}

function SectionTitle({ number, title }: { number: string; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--brand)] text-[16px] font-black text-white">
        {number}
      </span>
      <h2 className="text-[20px] font-black">{title}</h2>
    </div>
  );
}

function StatusLine({ type, text }: { type: "idle" | "success" | "error"; text: string }) {
  const color =
    type === "error"
      ? "text-red-500"
      : type === "success"
        ? "text-emerald-600"
        : "text-[var(--text-muted)]";

  return (
    <p className={`mt-4 flex items-start gap-3 text-[13px] font-bold leading-6 ${color}`}>
      <span className="mt-[9px] h-[7px] w-[7px] shrink-0 rounded-full bg-current" />
      <span>{text}</span>
    </p>
  );
}

function PreviewBlock({
  label,
  imageUrl,
  emptyText,
  isRestoring = false,
  progressLabel = "0%",
  progress = 0,
  progressMessage = "",
}: {
  label: string;
  imageUrl: string;
  emptyText: string;
  isRestoring?: boolean;
  progressLabel?: string;
  progress?: number;
  progressMessage?: string;
}) {
  return (
    <div className="mt-4">
      <p className="mb-2 text-[14px] font-extrabold text-[var(--text-muted)]">{label}</p>
      <div className="empty-frame relative flex min-h-[104px] items-center justify-center overflow-hidden text-[var(--text-muted)]">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={label} className="h-full max-h-[320px] w-full object-contain" />
        ) : (
          <span className="flex flex-col items-center text-[14px] font-extrabold">
            <ImageIcon />
            <span className="mt-2">{emptyText}</span>
          </span>
        )}
        {isRestoring ? (
          <div className="absolute inset-0 flex flex-col justify-end overflow-hidden bg-[rgba(15,91,171,0.18)] p-4">
            <div className="restore-scan absolute inset-y-0 -left-1/2 w-1/2" />
            <div className="relative rounded-xl border border-white/40 bg-white/72 p-3 shadow-lg backdrop-blur-md dark:bg-slate-950/60">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] font-black text-[var(--text-main)]">正在重建照片细节</p>
                  <p className="mt-1 text-[11px] font-bold leading-4 text-[var(--text-muted)]">
                    {progressMessage}
                  </p>
                </div>
                <span className="text-[20px] font-black tabular-nums text-[var(--brand)]">
                  {progressLabel}
                </span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/70">
                <div className="restore-progress-fill h-full rounded-full" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
