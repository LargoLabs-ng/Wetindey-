import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";
import { appUrl } from "@/lib/app-url";
import { BRAND_NAME, BRAND_TAGLINE } from "@/lib/brand";

// Wetin Dey brand typeface. Loaded from Google rather than bundled locally
// so the full weight range is available — the design leans on 800 for
// display headlines and 600 for prices and dates, which the old single
// local file could not cover cleanly.
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  // Without this, every relative Open Graph / Twitter image URL resolves
  // against localhost, so shared event links render blank on WhatsApp.
  metadataBase: new URL(appUrl()),
  title: {
    default: `${BRAND_NAME} — ${BRAND_TAGLINE}`,
    template: `%s · ${BRAND_NAME}`,
  },
  description:
    "See what's happening around you. Campus events, parties, seminars and everything in between — find it, join it, don't miss it.",
  applicationName: BRAND_NAME,
  openGraph: {
    siteName: BRAND_NAME,
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${jakarta.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
