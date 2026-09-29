import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Page not found',
};

export default function NotFound() {
  return (
    <main id="main">
      <h1>Page not found</h1>
      <p>The address you followed does not exist.</p>
      <p>
        <Link href="/">Return to the home page</Link>
      </p>
    </main>
  );
}
