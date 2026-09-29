import { defineConfig, globalIgnores } from 'eslint/config';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';

export default defineConfig([
  globalIgnores(['.next/**', 'node_modules/**', 'coverage/**', 'next-env.d.ts']),
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // Application code reads configuration only through the typed schema in
    // src/env, so every variable is declared, validated and covered by the
    // client-bundle check. The schema modules themselves are exempt below.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/env/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'MemberExpression[object.name="process"][property.name="env"]',
          message:
            'Read configuration through "@/env/client" or "@/env/server", not process.env, so it is declared, validated and scanned.',
        },
      ],
    },
  },
  prettier,
]);
