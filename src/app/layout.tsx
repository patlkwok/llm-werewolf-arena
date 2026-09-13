import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ThemeToggle, type ArenaTheme } from "@/ui/theme-toggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "LLM Werewolf Arena",
  description: "A local-first autonomous social deduction arena.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const selected = (await cookies()).get("arena-theme")?.value;
  const theme: ArenaTheme = selected === "light" ? "light" : "dark";
  return (
    <html lang="en" data-theme={theme}>
      <body>
        <ThemeToggle initialTheme={theme} />
        {children}
      </body>
    </html>
  );
}
