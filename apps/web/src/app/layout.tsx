import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Votion — Workspace',
  description: 'Votion: an open-source Notion on Wasmer Edge',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="h-full bg-white">{children}</body>
    </html>
  );
}
