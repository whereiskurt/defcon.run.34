import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "GPX Studio - DEF CON",
  description: "GPX editor for DEF CON runners",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
