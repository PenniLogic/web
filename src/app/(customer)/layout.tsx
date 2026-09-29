import type { ReactNode } from 'react';

/**
 * Layout for the customer route group. Every customer-facing route lives under
 * `src/app/(customer)`; this repository deliberately has no administrative
 * route group (administration is a separate repository).
 */
export default function CustomerLayout({ children }: { readonly children: ReactNode }) {
  return <main id="main">{children}</main>;
}
