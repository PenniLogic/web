import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import CustomerLayout from '@/app/(customer)/layout';
import HomePage from '@/app/(customer)/page';
import RootLayout from '@/app/layout';
import NotFound from '@/app/not-found';

/** Renders exactly what the framework composes for a customer route. */
function renderCustomerRoute(page: ReactNode): string {
  return renderToStaticMarkup(
    <RootLayout>
      <CustomerLayout>{page}</CustomerLayout>
    </RootLayout>,
  );
}

function count(html: string, pattern: RegExp): number {
  return html.match(new RegExp(pattern.source, 'g'))?.length ?? 0;
}

describe('document structure', () => {
  it('declares the language and the application environment on the root element', () => {
    const html = renderCustomerRoute(<HomePage />);
    expect(html).toMatch(/<html lang="en" data-app-env="(local|preview|production)">/);
  });

  it('has exactly one main landmark, owned by the root layout', () => {
    const html = renderCustomerRoute(<HomePage />);
    expect(count(html, /<main\b/)).toBe(1);
    expect(count(html, /id="main"/)).toBe(1);
    expect(html).toContain('<body><main id="main">');
  });
});

describe('customer home page', () => {
  it('renders a single top-level heading with honest placeholder copy', () => {
    const html = renderCustomerRoute(<HomePage />);
    expect(count(html, /<h1\b/)).toBe(1);
    expect(html).toContain('<h1>PenniLogic</h1>');
    expect(html).toContain('There is nothing to use here yet.');
  });

  it('contains no scripts, forms or external references', () => {
    const html = renderCustomerRoute(<HomePage />);
    expect(html).not.toMatch(/<script|<form|<iframe|https?:\/\//);
  });
});

describe('not-found page', () => {
  it('explains the problem and links back to the home page', () => {
    const html = renderToStaticMarkup(<NotFound />);
    expect(html).toContain('<h1>Page not found</h1>');
    expect(html).toMatch(/<a [^>]*href="\/"[^>]*>Return to the home page<\/a>/);
  });

  it('renders inside the single landmark for unmatched URLs', () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <NotFound />
      </RootLayout>,
    );
    expect(count(html, /<main\b/)).toBe(1);
    expect(count(html, /<h1\b/)).toBe(1);
  });

  it('renders inside the single landmark when a customer page calls notFound()', () => {
    const html = renderCustomerRoute(<NotFound />);
    expect(count(html, /<main\b/)).toBe(1);
    expect(count(html, /id="main"/)).toBe(1);
    expect(count(html, /<h1\b/)).toBe(1);
  });
});
