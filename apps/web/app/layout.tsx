import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import { Providers } from "./providers";
import "./styles/ledger.css";

// The ledger theme's three faces. The CSS references them through --serif / --mono and the body font.
const grotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["600", "900"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

const title = "SealedRFQ — Sealed bids. AI scores. Arc awards.";
const description =
  "Sealed-bid B2B procurement on Arc. Suppliers commit sealed bids with a USDC deposit, an AI " +
  "evaluator scores them against a rubric published before bidding opened, and an on-chain policy " +
  "decides the award. Winners are paid milestone by milestone.";

/**
 * The canonical origin, used to turn relative metadata URLs into absolute ones.
 *
 * Without it Next.js resolves Open Graph and canonical URLs against localhost, which is invisible
 * in development and produces links nobody can open once a preview or a crawler reads them. Set
 * from the environment so a Vercel preview describes itself rather than claiming to be production.
 */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.sealedrfq.com";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  alternates: { canonical: "/" },
  openGraph: { title, description, type: "website", url: siteUrl, siteName: "SealedRFQ" },
  twitter: { card: "summary_large_image", title, description },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${grotesk.variable} ${mono.variable} ${fraunces.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
