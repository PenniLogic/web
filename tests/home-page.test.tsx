import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import CustomerLayout from '@/app/(customer)/layout';
import HomePage from '@/app/(customer)/page';
import NotFound from '@/app/not-found';

describe('customer home page', () => {
  it('renders one main landmark with a single top-level heading', () => {
    const html = renderToStaticMarkup(
      <CustomerLayout>
        <HomePage />
      </CustomerLayout>,
    );
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html).toContain('<main id="main">');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('<h1>PenniLogic</h1>');
  });

  it('contains no scripts, forms or external references', () => {
    const html = renderToStaticMarkup(
      <CustomerLayout>
        <HomePage />
      </CustomerLayout>,
    );
    expect(html).not.toMatch(/<script|<form|<iframe|https?:\/\//);
  });
});

describe('not-found page', () => {
  it('explains the problem and links back to the home page', () => {
    const html = renderToStaticMarkup(<NotFound />);
    expect(html).toContain('<h1>Page not found</h1>');
    expect(html).toMatch(/<a [^>]*href="\/"[^>]*>Return to the home page<\/a>/);
    expect(html.match(/<main\b/g)).toHaveLength(1);
  });
});
