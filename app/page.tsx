import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[var(--page-bg)] px-6 py-8 text-[var(--text-main)]">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-[560px] flex-col">
        <header className="flex items-center justify-between">
          <div className="text-[22px] font-extrabold tracking-tight text-[var(--brand)]">
            content.up
          </div>
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
            <Link className="primary-button mt-9 block text-center" href="/restore">
              开始修复
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
