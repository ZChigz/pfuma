import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { SessionProvider } from '@/components/providers/SessionProvider';
import './globals.css';

const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  title: 'Pfuma — School Management',
  description: 'School Management System',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${jakarta.className} antialiased`}>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
