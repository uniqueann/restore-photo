import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[var(--page-bg)] px-6 py-8 text-[var(--text-main)]">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-[560px] flex-col">
        <header className="flex items-center justify-between">
          <Link
            aria-label="首页"
            className="inline-flex size-11 items-center justify-center rounded-full bg-white/80 text-[var(--brand)] shadow-[0_10px_26px_rgba(74,144,226,0.14)] ring-1 ring-[var(--panel-border)] transition hover:text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-300"
            href="/"
          >
            <svg
              aria-hidden="true"
              className="size-5"
              fill="none"
              viewBox="0 0 24 24"
            >
              <path
                d="m4 10 8-6 8 6v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.2"
              />
            </svg>
          </Link>
          <Link className="pill-button" href="/restore">
            Photo Restore
          </Link>
        </header>

        <section className="flex flex-1 flex-col justify-center pb-16 pt-14">
          <div className="soft-panel px-7 py-9 sm:px-9 sm:py-11">
            <h1 className="text-[40px] font-black leading-tight tracking-[-0.02em] sm:text-[48px]">
              老照片修复
            </h1>
            <p className="mt-5 max-w-[420px] text-[17px] font-semibold leading-8 text-[var(--text-muted)]">
              校验卡密，上传照片，等待 AI 完成高清修复。
            </p>
            <Link
              className="primary-button mt-9 flex items-center justify-center text-center"
              href="/restore"
            >
              开始修复
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
