import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ComplianceMind — AI-Native Compliance Workspace | YC RFS #12",
  description:
    "Real-time multiplayer compliance workspace where officers and AI agents collaborate powered by Moss sub-10ms semantic retrieval.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="bg-gradient-animated min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
