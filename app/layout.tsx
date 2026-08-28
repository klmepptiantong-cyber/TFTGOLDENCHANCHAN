import "./globals.css";

export const metadata = {
  title: "TFT Golden Chanchan",
  description: "金铲铲实时阵容与对局决策助手",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
