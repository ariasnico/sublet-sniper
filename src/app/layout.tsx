import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "./primitives.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = { title: "Sublet Sniper", description: "Your personal rental agent: finds safe SF sublets, flags scams, negotiates and books viewings" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (<html lang="en" className={inter.variable}><body>{children}</body></html>);
}
