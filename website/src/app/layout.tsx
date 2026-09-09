import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kairo",
  description: "Scripture and lyrics automation for ProPresenter.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <html lang="en">
      <body>
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
