import type { Metadata } from "next";
import "./globals.css";
import { MerchantProvider } from "@/lib/merchant-context";

export const metadata: Metadata = {
  title: "Agentic Commerce Gateway — sell to AI buyers",
  description:
    "Merchant control plane for agentic commerce: onboard your catalog, set guardrails, and go live to any MCP-connected AI agent.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
        />
      </head>
      <body className="font-sans antialiased">
        <MerchantProvider>{children}</MerchantProvider>
      </body>
    </html>
  );
}
