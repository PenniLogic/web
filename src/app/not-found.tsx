import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Page not found',
};

/**
 * Rendered inside the root layout's single main landmark for unmatched URLs
 * and for customer pages that call `notFound()`, so both paths share one
 * document structure.
 */
export default function NotFound() {
  return (
    <>
      <h1>Page not found</h1>
      <p>The address you followed does not exist.</p>
      <p>
        <Link href="/">Return to the home page</Link>
      </p>
    </>
  );
}
