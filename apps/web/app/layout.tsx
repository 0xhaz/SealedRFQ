import type { Metadata } from "next";
import localFont from "next/font/local";
import { Providers } from "./providers";
import "./styles/ledger.css";

/*
 * The ledger theme's three faces, served from this repository rather than fetched from Google.
 *
 * `next/font/google` downloads every face at build time, so a build needs fonts.googleapis.com to
 * answer. When it did not, Vercel failed with 27 module-not-found errors pointing at a generated
 * font CSS module, which reads like a broken import and has nothing to do with the code. The files
 * are the same latin-subset woff2 Google serves; they are checked in so the build has no network
 * dependency at all.
 *
 * The CSS references these through --serif / --mono and the body font, so the variable names here
 * have to stay as they are.
 */
const grotesk = localFont({
  src: [{ path: "./fonts/SpaceGrotesk-normal.woff2", weight: "400 700", style: "normal" }],
  variable: "--font-sans",
  display: "swap",
});
const mono = localFont({
  src: [
    { path: "./fonts/IBMPlexMono-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/IBMPlexMono-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/IBMPlexMono-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-mono",
  display: "swap",
});
const fraunces = localFont({
  // Variable across both weight and optical size, so one file covers 600 and 900.
  src: [
    { path: "./fonts/Fraunces-normal.woff2", weight: "600 900", style: "normal" },
    { path: "./fonts/Fraunces-italic.woff2", weight: "600 900", style: "italic" },
  ],
  variable: "--font-serif",
  display: "swap",
});

const title = "SealedRFQ: Sealed bids. AI scores. Arc awards.";
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
