import type { Metadata, Viewport } from "next";
import { Fraunces, Outfit } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Langform",
    template: "%s · Langform",
  },
  description: "Lange Videos auf diesem Gerät. Ohne Kurzvideos, ohne Konto.",
  applicationName: "Langform",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Langform",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#14110e",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="de" className={`dark ${outfit.variable} ${fraunces.variable} h-full antialiased`}>
      <body className="h-dvh overflow-hidden bg-background text-foreground">
        <a
          href="#inhalt"
          className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
        >
          Zum Inhalt
        </a>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
