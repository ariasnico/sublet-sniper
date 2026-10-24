import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Sublet Sniper", description: "Voice agent that finds safe SF sublets and flags scams" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (<html lang="en"><body>{children}</body></html>);
}
