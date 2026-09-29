import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { clientEnv } from '@/env/client';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'PenniLogic',
    template: '%s | PenniLogic',
  },
  description: 'PenniLogic customer web application.',
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en" data-app-env={clientEnv.NEXT_PUBLIC_APP_ENV}>
      <body>
        {/* The only <main> landmark; route groups and error boundaries render content only. */}
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
