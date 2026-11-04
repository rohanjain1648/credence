import type { Metadata } from "next";
import { Schibsted_Grotesk } from "next/font/google";
import { Suspense } from "react";
import { KeyBanner } from "@/components/KeyBanner";
import { Nav } from "@/components/Nav";
import "./globals.css";

const grotesk = Schibsted_Grotesk({ variable: "--font-grotesk", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Credence",
  description: "Prediction markets, weighted by the traders who are usually right. Memory on Walrus, data from Tatum.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${grotesk.variable} antialiased`}>
      <body className="min-h-screen">
        <Nav />
        <Suspense>
          <KeyBanner />
        </Suspense>
        <main className="mx-auto w-full max-w-5xl px-4 pb-24 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
