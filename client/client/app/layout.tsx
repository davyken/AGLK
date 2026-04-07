import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AGLK - Agricultural Listing & Knowledge",
  description: "Connect farmers and buyers, manage listings, and track users",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-gray-50" suppressHydrationWarning>{children}</body>
    </html>
  );
}
