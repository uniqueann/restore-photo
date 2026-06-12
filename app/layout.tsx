import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "老照片修复",
  description: "使用 AI 修复老照片、模糊照片，提升画质和清晰度。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
