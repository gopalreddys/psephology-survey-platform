import type { Metadata } from "next";

import AmplifyProvider from "@/components/AmplifyProvider";

import "./globals.css";

export const metadata: Metadata = {
  title: "Psephology AI Survey Platform",
  description:
    "AI-powered voice survey and psephology research platform"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AmplifyProvider>
          {children}
        </AmplifyProvider>
      </body>
    </html>
  );
}
