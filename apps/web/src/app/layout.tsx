import type { Metadata } from "next";
import { BRAND } from "@vertik12/shared";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: `${BRAND.appName} — School Management`, template: `%s · ${BRAND.appName}` },
  description: `${BRAND.tagline}. Powered by ${BRAND.poweredBy}.`,
};

/**
 * Applies the saved theme BEFORE React hydrates so a dark-mode user never
 * sees a white flash. Must stay in sync with the key in src/lib/theme.ts.
 */
const themeInitScript = `try{if(localStorage.getItem("vertik12.theme")==="dark")document.documentElement.classList.add("dark")}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
