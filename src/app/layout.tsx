import type { Metadata, Viewport } from "next";
import "./globals.css";

/**
 * Root layout. Caprasimo (display) and Figtree (body) are the two families the design's inline
 * styles reference by name, so they are loaded from Google Fonts here where those literal
 * family names resolve for every screen.
 */

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

const title = "Cookie Bounties — Build something. Get paid on-chain.";
const description =
  "Community-powered tasks funded and settled on Cookie Chain. The reward is locked in escrow before anyone starts working.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: "Cookie Bounties",
  title,
  description,
  openGraph: {
    type: "website",
    siteName: "Cookie Bounties",
    title,
    description,
    url: siteUrl,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Matches the dark page ground so mobile browser chrome blends in.
  themeColor: "#141110",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        {/* React 19 hoists these to <head>; the design's inline styles reference these two
            families by their literal names, so loading them here makes those names resolve. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          precedence="high"
          href="https://fonts.googleapis.com/css2?family=Caprasimo&family=Figtree:wght@400;500;600;700;800&display=swap"
        />
        {children}
      </body>
    </html>
  );
}
