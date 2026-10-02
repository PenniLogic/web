import { createHash } from 'node:crypto';

import { z } from 'zod';

const MANIFEST_SHA256 = 'd59c4fecb26b5d36d4629a406c582c5a47141915832f2621c41b5fbe81a0b1a2';
const text = z.string().min(1);
const strings = z.record(z.string(), text);
const artifact = z.strictObject({
  source_path: text,
  local_file: text,
  git_blob: z.string().regex(/^[a-f0-9]{40}$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().positive(),
});
const manifestShape = z.strictObject({
  manifest_version: z.literal(1),
  repository: z.literal('PenniLogic/docs'),
  repository_id: z.literal(1394134442),
  owner_id: z.literal(335295566),
  issue: z.literal('https://github.com/PenniLogic/docs/issues/1'),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  tree: z.string().regex(/^[a-f0-9]{40}$/),
  taxonomy_version: text,
  schema_version: z.literal(1),
  data: artifact,
  schema: artifact,
  document_reference: artifact.omit({ local_file: true }).extend({ vendored: z.literal(false) }),
});
const copy = z.object({
  headline: text,
  body: text,
  variants: z.record(z.string(), z.object({ headline: text, body: text })).optional(),
});
const state = z.object({
  id: text,
  scopes: z.array(text).min(1),
  data_display: text,
  recovery_action: z.object({
    id: text,
    label: text,
    label_by_cause: strings.optional(),
    label_by_variant: strings.optional(),
  }),
  copy,
  causes: z.array(z.object({ id: text })).optional(),
  guarantees: z
    .object({
      rest_of_surface_usable: z.boolean().optional(),
      discloses_hidden_data: z.boolean().optional(),
      states_what_remains_available: z.boolean().optional(),
    })
    .optional(),
});
const taxonomyShape = z.object({
  schema_version: z.literal(1),
  taxonomy_version: text,
  clients: z.array(text),
  placeholders: z.array(z.object({ id: text, source: text })),
  forbidden_terms: z.array(text),
  states: z.array(state).min(1),
  adoption: z.object({
    coverage_assertions: z.array(z.object({ id: text })),
  }),
});
const schemaShape = z.object({
  $schema: z.literal('http://json-schema.org/draft-07/schema#'),
  definitions: z.record(z.string(), z.unknown()),
});
const inputShape = z.strictObject({
  manifest: z.instanceof(Uint8Array),
  data: z.instanceof(Uint8Array),
  schema: z.instanceof(Uint8Array),
});

export type SourceManifest = z.infer<typeof manifestShape>;
export type TaxonomyState = z.infer<typeof state>;
export type PinnedSource = ReturnType<typeof loadPinnedSource>;

export function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      freeze(child);
    }
  }
  return value;
}

function json(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      throw new Error('client_state_gate: source_json');
    }
    throw error;
  }
}

function verifyArtifact(bytes: Uint8Array, pin: z.infer<typeof artifact>, name: string): void {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const gitBlob = createHash('sha1')
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest('hex');
  if (bytes.byteLength !== pin.bytes || sha256 !== pin.sha256 || gitBlob !== pin.git_blob) {
    throw new Error(`client_state_gate: ${name}_integrity`);
  }
}

export function loadPinnedSource(input: unknown) {
  const bytes = inputShape.safeParse(input);
  if (!bytes.success) {
    throw new Error('client_state_gate: source_input');
  }
  if (createHash('sha256').update(bytes.data.manifest).digest('hex') !== MANIFEST_SHA256) {
    throw new Error('client_state_gate: manifest_integrity');
  }
  const manifest = manifestShape.safeParse(json(bytes.data.manifest));
  if (!manifest.success) {
    throw new Error('client_state_gate: source_manifest');
  }
  verifyArtifact(bytes.data.data, manifest.data.data, 'data');
  verifyArtifact(bytes.data.schema, manifest.data.schema, 'schema');

  // The accepted bytes are the authority; this projection is not another taxonomy validator.
  const taxonomy = taxonomyShape.safeParse(json(bytes.data.data));
  const schema = schemaShape.safeParse(json(bytes.data.schema));
  if (!taxonomy.success || !schema.success) {
    throw new Error('client_state_gate: source_contract');
  }
  const schemaDocument = schema.data;
  const identifiers = taxonomy.data.states.map((entry) => entry.id);
  const assertions = taxonomy.data.adoption.coverage_assertions.map((entry) => entry.id);
  if (
    taxonomy.data.taxonomy_version !== manifest.data.taxonomy_version ||
    taxonomy.data.schema_version !== manifest.data.schema_version ||
    !taxonomy.data.clients.includes('web') ||
    new Set(identifiers).size !== identifiers.length ||
    !assertions.includes('taxonomy_first') ||
    !assertions.includes('client_state_coverage')
  ) {
    throw new Error('client_state_gate: source_contract');
  }
  function definition(name: string) {
    if (!Object.hasOwn(schemaDocument.definitions, name)) {
      throw new Error('client_state_gate: source_definition');
    }
    return z.fromJSONSchema(
      {
        $schema: schemaDocument.$schema,
        $ref: `#/definitions/${name}`,
        definitions: schemaDocument.definitions,
      },
      { registry: z.registry() },
    );
  }
  return {
    manifest: freeze(manifest.data),
    taxonomy: freeze(taxonomy.data),
    identifiers: freeze(identifiers),
    registration: definition('surface_registration'),
    identifier: definition('identifier'),
    scope: definition('scope'),
    dataDisplay: definition('data_display'),
  };
}
