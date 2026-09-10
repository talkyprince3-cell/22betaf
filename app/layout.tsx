import type { Metadata, Viewport } from "next";
import { Roboto } from "next/font/google";
import "./globals.css";

// The reference build ships Roboto at these four weights; matching them keeps
// the type colour of the board identical.
const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
  variable: "--font-roboto",
  display: "swap",
});

export const metadata: Metadata = {
  title: "3btafric Ghana | Online Sports Betting, Mobile Money Deposits",
  description:
    "Bet on football with mobile money. Fast deposits, fast payouts, booking codes and daily boosted odds.",
  manifest: "/manifest.json",
  icons: { icon: "/logo-mark.svg", apple: "/logo-mark.svg" },
};

export const viewport: Viewport = {
  themeColor: "#08575E",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={roboto.variable}>
      <body>{children}</body>
    </html>
  );
}
