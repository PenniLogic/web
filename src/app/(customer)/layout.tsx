import type { ReactNode } from 'react';

/**
 * Layout for the customer route group. Every customer-facing route lives under
 * `src/app/(customer)`; this repository deliberately has no administrative
 * route group (administration is a separate repository). The main landmark
 * belongs to the root layout, so this renders content only and a page calling
 * `notFound()` never nests landmarks.
 */
export default function CustomerLayout({ children }: { readonly children: ReactNode }) {
  return <>{children}</>;
}
