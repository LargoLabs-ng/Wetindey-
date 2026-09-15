import type { Metadata } from "next";
import localFont from "next/font/local";
import { Providers } from "./providers";
import "./globals.css";
import { appUrl } from "@/lib/app-url";

// Ticket Buddy brand typeface (see brand system: Manrope)
const manrope = localFont({
  src: "../fonts/Manrope-Variable.ttf",
  variable: "--font-manrope",
  weight: "200 800",
});

export const metadata: Metadata = {
  // Without this, every relative Open Graph / Twitter image URL resolves
  // against localhost, so shared event links render blank on WhatsApp.
  metadataBase: new URL(appUrl()),
  title: "Ticket Buddy",
  description:
    "Your event journey starts here. Discover events, book tickets securely, and experience more of what matters.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${manrope.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
