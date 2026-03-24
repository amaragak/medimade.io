import type { Metadata } from "next";
import { Caveat, DM_Sans, Fraunces } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
// import { SiteFooter } from "@/components/site-footer";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
});

const caveat = Caveat({
  subsets: ["latin"],
  variable: "--font-hand",
  weight: ["500"],
});

export const metadata: Metadata = {
  title: {
    default: "medimade — meditations made just for you",
    template: "%s · medimade",
  },
  description:
    "Create on-the-fly guided meditations with sound, voice, markers, and intentions. Pro tools for creators and schedulers for tomorrow’s practice.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${fraunces.variable} ${caveat.variable} h-full antialiased`}
    >
      <body className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground">
        <SiteHeader />
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain">
          {children}
        </main>
        {/* <SiteFooter /> */}
      </body>
    </html>
  );
}
