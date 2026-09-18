import type { Metadata, Viewport } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import "antd/dist/reset.css";
import "./globals.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "健康记录",
  description: "对话式记录一日三餐",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "健康记录", statusBarStyle: "default" },
};

export const viewport: Viewport = { themeColor: "#16a34a" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-neutral-50 text-neutral-900">
        <AntdRegistry>
          <Providers>{children}</Providers>
        </AntdRegistry>
      </body>
    </html>
  );
}
