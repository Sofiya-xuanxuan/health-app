"use client";

import type { ReactNode } from "react";
import { App, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: "#10b981",
          borderRadius: 8,
          fontFamily: "var(--font-sans)",
        },
      }}
    >
      <App>{children}</App>
    </ConfigProvider>
  );
}
