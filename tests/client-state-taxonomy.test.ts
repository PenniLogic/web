import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createClientStateGate } from '../tools/client-state-gate/index.ts';
import type { ClientRegistry, StateObservation } from '../tools/client-state-gate/index.ts';
import { observations, registry } from './fixtures/client-state-taxonomy/synthetic.ts';

const directory = new URL('../quality/client-state-taxonomy/', import.meta.url);
const source = {
  manifest: readFileSync(new URL('source.json', directory)),
  data: readFileSync(new URL('client-state-taxonomy.json.bytes', directory)),
  schema: readFileSync(new URL('client-state-taxonomy.schema.json.bytes', directory)),
};
const gate = () => createClientStateGate(source);

function replaceObservation(
  id: string,
  replace: (observation: StateObservation) => unknown,
): readonly unknown[] {
  return observations.map((observation) =>
    observation.state_id === id ? replace(observation) : observation,
  );
}

function problem(
  result: ReturnType<ReturnType<typeof gate>['fixture_state_coverage']>,
  code: string,
) {
  expect(result.status).toBe('failed');
  expect(result.problems.map((entry) => entry.code)).toContain(code);
}

describe('immutable accepted source consumption', () => {
  it('pins actual source bytes, Git blobs, complete commit/tree and taxonomy version', () => {
    const clientGate = gate();
    expect(clientGate.source.commit).toBe('a700e639585c61a4610e7b99dbd02b2dab28bdcc');
    expect(clientGate.source.tree).toBe('3879d3893a3f289bd6b0d4474f09dbebf1fef195');
    expect(clientGate.source.taxonomy_version).toBe('1.1.0');
    expect(clientGate.source.repository_id).toBe(1394134442);
    expect(clientGate.source.owner_id).toBe(335295566);
    expect(createHash('sha256').update(source.data).digest('hex')).toBe(
      '040d2f0c27332ce3f6794a90139e714b3c50afb5b7340aa596d47b8866f2b3fb',
    );
    expect(createHash('sha256').update(source.schema).digest('hex')).toBe(
      '6bceee452e135835baa7733886d3aceae6322df5a6aefc0c9ea9f9d35ddebfc1',
    );
    expect(clientGate.state_ids).toEqual(registry.state_ids);
    expect(Object.isFrozen(clientGate.state_ids)).toBe(true);
  });

  it.each(['manifest', 'data', 'schema'] as const)('refuses a missing %s input', (name) => {
    const input = Object.fromEntries(Object.entries(source).filter(([key]) => key !== name));
    expect(() => createClientStateGate(input)).toThrow(/source_input/);
  });

  it.each(['manifest', 'data', 'schema'] as const)('refuses changed %s bytes', (name) => {
    expect(() =>
      createClientStateGate({ ...source, [name]: Buffer.concat([source[name], Buffer.from(' ')]) }),
    ).toThrow(/integrity/);
  });

  it.each([
    ['malformed', '{"taxonomy_version":'],
    ['duplicate pin', source.manifest.toString().replace('{\n', '{\n  "schema_version": 1,\n')],
    ['unknown pin', source.manifest.toString().replace('{\n', '{\n  "unknown_pin": true,\n')],
    ['wrong version', source.manifest.toString().replace('"1.1.0"', '"9.9.9"')],
    ['wrong commit', source.manifest.toString().replace('a700e639', 'b700e639')],
    ['missing hash', source.manifest.toString().replace(/"sha256": "[a-f0-9]+",\n/, '')],
  ])('refuses %s manifest without accepting a new self-declared pin', (_, manifest) => {
    expect(() => createClientStateGate({ ...source, manifest: Buffer.from(manifest) })).toThrow(
      /manifest_integrity/,
    );
  });

  it('refuses malformed or duplicated taxonomy bytes rather than reparsing a changed source', () => {
    for (const data of [
      '{"states":',
      source.data.toString().replace('"id": "empty"', '"id": "empty", "id": "empty"'),
    ]) {
      expect(() => createClientStateGate({ ...source, data: Buffer.from(data) })).toThrow(
        /data_integrity/,
      );
    }
  });

  it('reports the genuinely empty production registry as not_exercised, not coverage passed', () => {
    const production: unknown = JSON.parse(
      readFileSync(new URL('registry.json', directory), 'utf8'),
    );
    const clientGate = gate();
    expect(clientGate.taxonomy_first(production)).toMatchObject({
      assertion: 'taxonomy_first',
      status: 'not_exercised',
      registered_surfaces: 0,
      applicable_states: 0,
    });
    const result = clientGate.client_state_coverage(production, []);
    expect(result).toMatchObject({
      assertion: 'client_state_coverage',
      status: 'not_exercised',
      registered_surfaces: 0,
      applicable_states: 0,
      observed_states: 0,
      problems: [],
    });
    console.info('client_state_coverage: not_exercised; no registered web product surfaces');
  });
});

describe('taxonomy_first contract (synthetic enumeration proof)', () => {
  it('accepts only the eight published IDs without inventing client vocabulary', () => {
    expect(gate().taxonomy_first(registry)).toMatchObject({
      assertion: 'taxonomy_first',
      status: 'fixture_proof',
      applicable_states: 8,
      problems: [],
    });
  });

  it.each(['permission-denied', 'quota-exceeded', 'new_state', 'erased_member_placeholder'])(
    'refuses unregistered client state %s',
    (id) => {
      problem(
        gate().taxonomy_first({ ...registry, state_ids: [...registry.state_ids, id] }),
        'unknown_state',
      );
    },
  );

  it('refuses a duplicated enumeration ID', () => {
    problem(
      gate().taxonomy_first({ ...registry, state_ids: [...registry.state_ids, 'empty'] }),
      'duplicate_state',
    );
  });

  it('refuses an applicable ID missing from the explicit client enumeration', () => {
    problem(
      gate().taxonomy_first({
        ...registry,
        state_ids: registry.state_ids.filter((id) => id !== 'stale'),
      }),
      'state_not_enumerated',
    );
  });
});

describe('client_state_coverage contract (SYNTHETIC fixtures, never actual UI coverage)', () => {
  it('proves the finite canonical examples without reporting production coverage passed', () => {
    expect(gate().fixture_state_coverage(registry, observations)).toMatchObject({
      assertion: 'client_state_coverage',
      status: 'fixture_proof',
      registered_surfaces: 1,
      applicable_states: 8,
      observed_states: 8,
      problems: [],
    });
  });

  describe('independent-review contract regressions (SYNTHETIC facts, not rendered UI)', () => {
    function stateObservation(id: string): StateObservation {
      const observation = observations.find((entry) => entry.state_id === id);
      if (observation === undefined) {
        throw new Error('SYNTHETIC state fixture missing');
      }
      return observation;
    }

    const loading = stateObservation('loading');
    const error = stateObservation('error');
    const validation: StateObservation = {
      ...error,
      scope: 'action',
      variant: 'validation',
      placeholders: {
        ...error.placeholders,
        field_guidance: { value: 'Add a description.', source: 'component_copy' },
        submit_label: { value: 'Save', source: 'surface_registration' },
      },
      rendered: {
        ...error.rendered,
        body: 'Add a description.',
        recovery_actions: [{ id: 'retry', label: 'Save' }],
      },
    };
    const loadingRegistry: ClientRegistry = {
      ...registry,
      state_ids: ['loading'],
      surfaces: registry.surfaces.map((surface) => ({
        ...surface,
        applicable_states: ['loading'],
      })),
    };

    function loadingObservation(
      phase: NonNullable<StateObservation['context']['loading_phase']>,
      scope: string,
      usable: boolean,
    ): StateObservation {
      return {
        ...loading,
        scope,
        context: { ...loading.context, loading_phase: phase },
        rendered: {
          ...loading.rendered,
          unaffected_surface_usable: usable,
          ...(phase === 'before_slow_threshold'
            ? { headline: '', body: '', recovery_actions: [] }
            : {}),
        },
      };
    }

    it.each([
      {
        name: 'source-rule-loading-unaffected-blocked',
        observation: loadingObservation('after_slow_threshold', 'region', false),
        code: 'unaffected_content_blocked',
      },
      {
        name: 'source-rule-action-error-unaffected-blocked',
        observation: {
          ...validation,
          rendered: { ...validation.rendered, unaffected_surface_usable: false },
        },
        code: 'unaffected_content_blocked',
      },
      {
        name: 'source-rule-empty-with-displayable-data',
        observation: {
          ...stateObservation('empty'),
          context: { connectivity: 'online', displayable_data_present: true },
        },
        code: 'empty_with_displayable_data',
      },
    ])('Core counterexample: $name', ({ observation, code }) => {
      const result = gate().fixture_state_coverage(
        registry,
        replaceObservation(observation.state_id, () => observation),
      );
      problem(result, code);
      expect(result.observed_states).toBe(7);
      expect(result.problems).toEqual([
        {
          code,
          observation: observations.findIndex((entry) => entry.state_id === observation.state_id),
        },
        { code: 'missing_observation', registration: 0 },
      ]);
      expect(JSON.stringify(result)).not.toContain(observation.rendered.headline);
      expect(JSON.stringify(result)).not.toContain(observation.rendered.body);
    });

    it.each([
      {
        name: 'Q103 post-threshold loading blocks unaffected content',
        inputs: [loadingObservation('after_slow_threshold', 'region', false)],
        observed_states: 0,
      },
      {
        name: 'Q104 blocked early loading followed by valid late loading',
        inputs: [
          loadingObservation('before_slow_threshold', 'region', false),
          loadingObservation('after_slow_threshold', 'region', true),
        ],
        observed_states: 1,
      },
    ])('QA counterexample: $name', ({ inputs, observed_states }) => {
      const result = gate().fixture_state_coverage(loadingRegistry, inputs);
      problem(result, 'unaffected_content_blocked');
      expect(result.observed_states).toBe(observed_states);
      expect(result.problems).toEqual([
        { code: 'unaffected_content_blocked', observation: 0 },
        ...(observed_states === 0 ? [{ code: 'missing_observation', registration: 0 }] : []),
      ]);
    });

    it.each([
      { scope: 'surface', phase: 'before_slow_threshold' },
      { scope: 'surface', phase: 'after_slow_threshold' },
      { scope: 'action', phase: 'before_slow_threshold' },
      { scope: 'action', phase: 'after_slow_threshold' },
    ] as const)('rejects blocked $scope loading at $phase', ({ scope, phase }) => {
      const result = gate().fixture_state_coverage(loadingRegistry, [
        loadingObservation(phase, scope, false),
        ...(phase === 'before_slow_threshold'
          ? [loadingObservation('after_slow_threshold', scope, true)]
          : []),
      ]);
      problem(result, 'unaffected_content_blocked');
      expect(result.problems).toContainEqual({
        code: 'unaffected_content_blocked',
        observation: 0,
      });
    });

    it.each(['region', 'action'])(
      'rejects generic %s error blocking unaffected content',
      (scope) => {
        const result = gate().fixture_state_coverage(
          registry,
          replaceObservation('error', () => ({
            ...error,
            scope,
            rendered: { ...error.rendered, unaffected_surface_usable: false },
          })),
        );
        problem(result, 'unaffected_content_blocked');
        expect(result.observed_states).toBe(7);
      },
    );

    it.each(['empty', 'stale'])('enforces region coexistence for %s', (state) => {
      const result = gate().fixture_state_coverage(
        registry,
        replaceObservation(state, (observation) => ({
          ...observation,
          rendered: { ...observation.rendered, unaffected_surface_usable: false },
        })),
      );
      problem(result, 'unaffected_content_blocked');
      expect(result.observed_states).toBe(7);
    });

    it('rejects whole-surface empty with affected displayable data even when none is rendered', () => {
      const result = gate().fixture_state_coverage(
        registry,
        replaceObservation('empty', (observation) => ({
          ...observation,
          scope: 'surface',
          context: { ...observation.context, displayable_data_present: true },
        })),
      );
      problem(result, 'empty_with_displayable_data');
      expect(result.observed_states).toBe(7);
    });

    it.each(
      ['surface', 'region', 'action'].flatMap((scope) =>
        (['before_slow_threshold', 'after_slow_threshold'] as const).map((phase) => ({
          scope,
          phase,
        })),
      ),
    )('preserves usable $scope loading at $phase', ({ scope, phase }) => {
      expect(
        gate().fixture_state_coverage(loadingRegistry, [
          loadingObservation(phase, scope, true),
          ...(phase === 'before_slow_threshold'
            ? [loadingObservation('after_slow_threshold', scope, true)]
            : []),
        ]),
      ).toMatchObject({
        status: 'fixture_proof',
        applicable_states: 1,
        observed_states: 1,
        problems: [],
      });
    });

    it.each(['surface', 'region'])('preserves genuine no-data empty at %s scope', (scope) => {
      expect(
        gate().fixture_state_coverage(
          registry,
          replaceObservation('empty', (observation) => ({ ...observation, scope })),
        ),
      ).toMatchObject({ status: 'fixture_proof', observed_states: 8, problems: [] });
    });

    it.each([
      { scope: 'surface', usable: false },
      { scope: 'region', usable: true },
      { scope: 'action', usable: true },
    ])(
      'preserves legitimate $scope error with unaffected usability $usable',
      ({ scope, usable }) => {
        expect(
          gate().fixture_state_coverage(
            registry,
            replaceObservation('error', () => ({
              ...error,
              scope,
              rendered: { ...error.rendered, unaffected_surface_usable: usable },
            })),
          ),
        ).toMatchObject({ status: 'fixture_proof', observed_states: 8, problems: [] });
      },
    );

    it('preserves usable validation error and its registered submit label', () => {
      expect(
        gate().fixture_state_coverage(
          registry,
          replaceObservation('error', () => validation),
        ),
      ).toMatchObject({ status: 'fixture_proof', observed_states: 8, problems: [] });
    });

    it('still requires late loading proof when an early usable skeleton is the only observation', () => {
      const result = gate().fixture_state_coverage(loadingRegistry, [
        loadingObservation('before_slow_threshold', 'region', true),
      ]);
      expect(result).toMatchObject({
        status: 'failed',
        observed_states: 0,
        problems: [{ code: 'missing_observation', registration: 0 }],
      });
    });
  });

  it('refuses fixture registrations in the production coverage assertion', () => {
    problem(gate().client_state_coverage(registry, observations), 'fixture_registration_refused');
  });

  it('refuses synthetic evidence even when the registry is labelled production', () => {
    const production = {
      ...registry,
      kind: 'production_registry',
      surfaces: registry.surfaces.map((surface) => ({
        ...surface,
        surface_id: 'customer_surface',
      })),
    };
    const synthetic = observations.map((observation) => ({
      ...observation,
      surface_id: 'customer_surface',
    }));
    problem(gate().client_state_coverage(production, synthetic), 'fixture_evidence_refused');
  });

  it('never promotes the provider illustrative registration to a real web surface', () => {
    problem(
      gate().client_state_coverage(
        {
          ...registry,
          kind: 'production_registry',
          surfaces: registry.surfaces.map((surface) => ({
            ...surface,
            surface_id: 'example_transactions_home',
          })),
        },
        [],
      ),
      'fixture_registration_refused',
    );
  });

  it('fails the planted omission of an applicable stale state', () => {
    problem(
      gate().fixture_state_coverage(
        registry,
        observations.filter((observation) => observation.state_id !== 'stale'),
      ),
      'missing_observation',
    );
  });

  it('fails populated production registrations without real rendered observations', () => {
    const production = {
      ...registry,
      kind: 'production_registry',
      surfaces: registry.surfaces.map((surface) => ({
        ...surface,
        surface_id: 'customer_surface',
      })),
    };
    const result = gate().client_state_coverage(production, []);
    problem(result, 'missing_observation');
    expect(result.observed_states).toBe(0);
    expect(result.problems.filter((entry) => entry.code === 'missing_observation')).toHaveLength(8);
  });

  it.each([
    'tests/fixtures/client-state-taxonomy/synthetic.ts',
    'quality/client-state-taxonomy/evidence/fixture.json',
    'quality/client-state-taxonomy/evidence/example_capture.json',
    'quality/client-state-taxonomy/evidence/synthetic.json',
    '../outside.json',
    'C:\\outside.json',
  ])('refuses fabricated rendered metadata pointing at %s', (artifact_path) => {
    const production = {
      ...registry,
      kind: 'production_registry',
      surfaces: registry.surfaces.map((surface) => ({
        ...surface,
        surface_id: 'customer_surface',
      })),
    };
    const claimed = observations.map((observation) => ({
      ...observation,
      surface_id: 'customer_surface',
      evidence: {
        kind: 'rendered_observation',
        producer: 'native_render_test',
        run_id: 'fixture_refusal_case',
        source_commit: 'a'.repeat(40),
        artifact_sha256: 'b'.repeat(64),
        artifact_path,
      },
    }));
    problem(gate().client_state_coverage(production, claimed), 'invalid_rendered_evidence');
  });

  it('requires complete rendered capture metadata instead of a success-shaped evidence label', () => {
    const production = {
      ...registry,
      kind: 'production_registry',
      surfaces: registry.surfaces.map((surface) => ({
        ...surface,
        surface_id: 'customer_surface',
      })),
    };
    const incomplete = observations.map((observation) => ({
      ...observation,
      surface_id: 'customer_surface',
      evidence: { kind: 'rendered_observation' },
    }));
    problem(gate().client_state_coverage(production, incomplete), 'invalid_observation');
  });

  it.each([
    ['wrong client', { client: 'admin' }],
    ['wrong source version', { taxonomy_version: '1.0.0' }],
    ['unknown envelope field', { ignored_surface: 'not_allowed' }],
    ['malformed surface list', { surfaces: null }],
  ])('refuses %s', (_, patch) => {
    problem(
      gate().fixture_state_coverage({ ...registry, ...patch }, observations),
      'invalid_registry',
    );
  });

  it('validates required, duplicate and unknown fields using the published registration definition', () => {
    const surface = registry.surfaces[0]!;
    for (const invalid of [
      { ...surface, attempt: undefined },
      { ...surface, made_up_property: true },
      { ...surface, applicable_states: ['empty', 'empty'] },
      { ...surface, client: 'android' },
      { ...surface, surface_id: 'not-a-published-identifier' },
      { ...surface, freshness_window_seconds: 0.5 },
    ]) {
      problem(
        gate().fixture_state_coverage({ ...registry, surfaces: [invalid] }, observations),
        'invalid_registry',
      );
    }
  });

  it('refuses a duplicate surface registration', () => {
    problem(
      gate().fixture_state_coverage(
        { ...registry, surfaces: [...registry.surfaces, ...registry.surfaces] },
        observations,
      ),
      'duplicate_surface',
    );
  });

  it('refuses an unknown applicable state', () => {
    problem(
      gate().fixture_state_coverage(
        {
          ...registry,
          surfaces: registry.surfaces.map((surface) => ({
            ...surface,
            applicable_states: [...surface.applicable_states, 'invented'],
          })),
        },
        observations,
      ),
      'unknown_state',
    );
  });

  it.each([
    ['unknown state', { state_id: 'invented' }, 'unknown_state'],
    ['unregistered surface', { surface_id: 'unregistered' }, 'unregistered_surface'],
    ['wrong client', { client: 'android' }, 'invalid_observation'],
    ['wrong version', { taxonomy_version: '1.0.0' }, 'invalid_observation'],
    ['unknown scope', { scope: 'modal' }, 'invalid_observation'],
    ['wrong state scope', { scope: 'action' }, 'invalid_scope'],
    ['unknown variant', { variant: 'invented' }, 'invalid_variant'],
  ])('refuses observation with %s', (_, patch, code) => {
    problem(
      gate().fixture_state_coverage(
        registry,
        replaceObservation('stale', (observation) => ({ ...observation, ...patch })),
      ),
      code,
    );
  });

  it('refuses an observation for a state not marked applicable', () => {
    problem(
      gate().fixture_state_coverage(
        {
          ...registry,
          surfaces: registry.surfaces.map((surface) => ({
            ...surface,
            applicable_states: surface.applicable_states.filter((id) => id !== 'stale'),
          })),
        },
        observations,
      ),
      'state_not_applicable',
    );
  });

  it('refuses duplicate observations', () => {
    problem(
      gate().fixture_state_coverage(registry, [...observations, observations[0]]),
      'duplicate_observation',
    );
  });

  it.each(['headline', 'body'] as const)('refuses paraphrased %s', (field) => {
    problem(
      gate().fixture_state_coverage(
        registry,
        replaceObservation('error', (observation) => ({
          ...observation,
          rendered: { ...observation.rendered, [field]: 'A different explanation.' },
        })),
      ),
      'copy_mismatch',
    );
  });

  it.each([
    { recovery_actions: [] },
    {
      recovery_actions: [
        { id: 'retry', label: 'Try again' },
        { id: 'retry', label: 'Try again' },
      ],
    },
    { recovery_actions: [{ id: 'new_action', label: 'Try again' }] },
    { recovery_actions: [{ id: 'retry', label: 'Contact someone' }] },
  ])('refuses absent, duplicate or unpublished recovery action %#', ({ recovery_actions }) => {
    problem(
      gate().fixture_state_coverage(
        registry,
        replaceObservation('error', (observation) => ({
          ...observation,
          rendered: { ...observation.rendered, recovery_actions },
        })),
      ),
      'recovery_mismatch',
    );
  });

  it.each([
    {},
    { attempt: { value: 'load your transactions', source: 'service_response' } },
    { attempt: { value: 'load other records', source: 'surface_registration' } },
    {
      attempt: { value: 'load your transactions', source: 'surface_registration' },
      undeclared: { value: 'anything', source: 'surface_registration' },
    },
  ])('refuses missing, wrongly sourced, unregistered or extra placeholders %#', (placeholders) => {
    problem(
      gate().fixture_state_coverage(
        registry,
        replaceObservation('error', (observation) => ({ ...observation, placeholders })),
      ),
      'invalid_placeholder',
    );
  });

  it.each([
    { data_visible: true },
    { hidden_data_disclosed: true },
    { unaffected_surface_usable: false },
    { additional_state_text: ['SYNTHETIC: 3 hidden items'] },
    { data_display: 'shown' },
  ])('refuses denial hidden-data disclosure or blocked unaffected content %#', (patch) => {
    problem(
      gate().fixture_state_coverage(
        registry,
        replaceObservation('permission_denied', (observation) => ({
          ...observation,
          rendered: { ...observation.rendered, ...patch },
        })),
      ),
      'denial_guarantee',
    );
  });

  it('binds device denial to its own copy and one published action', () => {
    const device = replaceObservation('permission_denied', (observation) => ({
      ...observation,
      cause: 'device',
      placeholders: {
        capability: { value: 'Automatic capture', source: 'surface_registration' },
        permission: { value: 'camera access', source: 'client_platform' },
      },
      rendered: {
        ...observation.rendered,
        headline: 'Automatic capture needs camera access',
        body: 'You can keep using everything else without it.',
        recovery_actions: [{ id: 'review_access', label: 'Allow camera access' }],
      },
    }));
    expect(gate().fixture_state_coverage(registry, device).status).toBe('fixture_proof');
  });

  it.each(['plan', 'role'])(
    'accepts published %s denial copy, with no invented bindings',
    (cause) => {
      const variant = replaceObservation('permission_denied', (observation) => ({
        ...observation,
        cause,
        rendered: {
          ...observation.rendered,
          headline:
            cause === 'plan' ? 'Not included in your plan' : 'Not part of your current access',
          body:
            cause === 'plan'
              ? 'Everything in your current plan keeps working.'
              : 'Everything else keeps working.',
          recovery_actions: [
            { id: 'review_access', label: cause === 'plan' ? 'See plans' : 'Request access' },
          ],
        },
      }));
      expect(gate().fixture_state_coverage(registry, variant).status).toBe('fixture_proof');
    },
  );

  it('refuses another cause copy and an unpublished denial cause', () => {
    for (const cause of ['device', 'invented']) {
      problem(
        gate().fixture_state_coverage(
          registry,
          replaceObservation('permission_denied', (observation) => ({ ...observation, cause })),
        ),
        cause === 'device' ? 'invalid_placeholder' : 'invalid_cause',
      );
    }
  });

  it.each(['toString', 'constructor', '__proto__'])(
    'refuses inherited-property names as variants or causes (%s)',
    (name) => {
      problem(
        gate().fixture_state_coverage(
          registry,
          replaceObservation('error', (observation) => ({ ...observation, variant: name })),
        ),
        'invalid_variant',
      );
      problem(
        gate().fixture_state_coverage(
          registry,
          replaceObservation('permission_denied', (observation) => ({
            ...observation,
            cause: name,
          })),
        ),
        'invalid_cause',
      );
    },
  );

  it('keeps validation error at action scope with its registered submit label', () => {
    const validation = replaceObservation('error', (observation) => ({
      ...observation,
      scope: 'action',
      variant: 'validation',
      placeholders: {
        ...observation.placeholders,
        field_guidance: { value: 'Add a description.', source: 'component_copy' },
        submit_label: { value: 'Save', source: 'surface_registration' },
      },
      rendered: {
        ...observation.rendered,
        body: 'Add a description.',
        recovery_actions: [{ id: 'retry', label: 'Save' }],
      },
    }));
    expect(gate().fixture_state_coverage(registry, validation).status).toBe('fixture_proof');
  });

  it('rejects blaming and monetary placeholder values without echoing their content', () => {
    for (const value of [
      'You denied access.',
      'USD 42.00',
      'SYNTHETIC internal exception',
      '10:30!',
      '10:30\nSYNTHETIC extra line',
    ]) {
      const result = gate().fixture_state_coverage(
        registry,
        replaceObservation('stale', (observation) => ({
          ...observation,
          placeholders: { last_updated: { value, source: 'client_cache' } },
          rendered: { ...observation.rendered, headline: `Last updated ${value}` },
        })),
      );
      problem(result, 'unsafe_placeholder');
      expect(JSON.stringify(result)).not.toContain(value);
    }
  });

  it('distinguishes held stale data plus offline marker from offline with no data', () => {
    const staleOffline = replaceObservation('stale', (observation) => ({
      ...observation,
      context: { connectivity: 'offline', displayable_data_present: true },
      rendered: { ...observation.rendered, offline_marker: "You're offline" },
    }));
    expect(gate().fixture_state_coverage(registry, staleOffline).status).toBe('fixture_proof');
    problem(
      gate().fixture_state_coverage(
        registry,
        replaceObservation('offline', (observation) => ({
          ...observation,
          context: { ...observation.context, displayable_data_present: true },
        })),
      ),
      'offline_stale_distinction',
    );
  });

  it.each([
    { stale_marker_count: 0 },
    { stale_marker_count: 2 },
    { data_visible: false },
    { data_display: 'none' },
    { offline_marker: "You're offline" },
  ])('refuses an inconsistent stale observation %#', (patch) => {
    problem(
      gate().fixture_state_coverage(
        registry,
        replaceObservation('stale', (observation) => ({
          ...observation,
          rendered: { ...observation.rendered, ...patch },
        })),
      ),
      'offline_stale_distinction',
    );
  });

  it('refuses an offline claim while the platform reports connectivity', () => {
    problem(
      gate().fixture_state_coverage(
        registry,
        replaceObservation('offline', (observation) => ({
          ...observation,
          context: { ...observation.context, connectivity: 'online' },
        })),
      ),
      'offline_stale_distinction',
    );
  });

  it('refuses a generic error where the platform already knows the device is offline', () => {
    problem(
      gate().fixture_state_coverage(
        registry,
        replaceObservation('error', (observation) => ({
          ...observation,
          context: { ...observation.context, connectivity: 'offline' },
        })),
      ),
      'known_offline_requires_offline',
    );
  });

  it('distinguishes degraded useful content from an error with no displayable data', () => {
    problem(
      gate().fixture_state_coverage(
        registry,
        replaceObservation('degraded', (observation) => ({
          ...observation,
          rendered: { ...observation.rendered, data_visible: false },
        })),
      ),
      'data_display_mismatch',
    );
    problem(
      gate().fixture_state_coverage(
        registry,
        replaceObservation('error', (observation) => ({
          ...observation,
          context: { ...observation.context, displayable_data_present: true },
        })),
      ),
      'held_data_requires_stale',
    );
  });

  it('accepts the published quota reset variant only with service-sourced reset copy', () => {
    const withReset = replaceObservation('quota_exceeded', (observation) => ({
      ...observation,
      variant: 'with_reset',
      placeholders: {
        ...observation.placeholders,
        resets_at: { value: 'tomorrow', source: 'service_response' },
      },
      rendered: {
        ...observation.rendered,
        body: `${observation.rendered.body} Resets tomorrow.`,
      },
    }));
    expect(gate().fixture_state_coverage(registry, withReset).status).toBe('fixture_proof');
    problem(
      gate().fixture_state_coverage(
        registry,
        replaceObservation('quota_exceeded', (observation) => ({
          ...observation,
          variant: 'with_reset',
        })),
      ),
      'invalid_placeholder',
    );
  });

  it('omits the rate-limited reset sentence when the service supplied no reset time', () => {
    const limited = replaceObservation('quota_exceeded', (observation) => ({
      ...observation,
      variant: 'rate_limited',
      rendered: {
        ...observation.rendered,
        headline: "You've reached the limit of 5 AI questions for now",
      },
    }));
    expect(gate().fixture_state_coverage(registry, limited).status).toBe('fixture_proof');
  });

  it('refuses singular still-available copy and enabled metered controls', () => {
    problem(
      gate().fixture_state_coverage(
        {
          ...registry,
          surfaces: registry.surfaces.map((surface) => ({
            ...surface,
            still_available: 'Your saved answer',
          })),
        },
        replaceObservation('quota_exceeded', (observation) => ({
          ...observation,
          placeholders: {
            ...observation.placeholders,
            still_available: { value: 'Your saved answer', source: 'surface_registration' },
          },
          rendered: { ...observation.rendered, body: 'Your saved answer still work.' },
        })),
      ),
      'invalid_plural_placeholder',
    );
    problem(
      gate().fixture_state_coverage(
        registry,
        replaceObservation('quota_exceeded', (observation) => ({
          ...observation,
          rendered: { ...observation.rendered, metered_controls_disabled: false },
        })),
      ),
      'quota_guarantee',
    );
  });

  it('allows the pre-slow-threshold loading skeleton but requires the later copy/action observation', () => {
    const early = replaceObservation('loading', (observation) => ({
      ...observation,
      context: { ...observation.context, loading_phase: 'before_slow_threshold' },
      rendered: { ...observation.rendered, headline: '', body: '', recovery_actions: [] },
    }));
    problem(gate().fixture_state_coverage(registry, early), 'missing_observation');
    expect(
      gate().fixture_state_coverage(registry, [
        ...early,
        observations.find((observation) => observation.state_id === 'loading'),
      ]).status,
    ).toBe('fixture_proof');
  });

  it('returns explicit errors for malformed input, never success-shaped defaults', () => {
    problem(gate().fixture_state_coverage(registry, null), 'invalid_observation');
    problem(gate().fixture_state_coverage(registry, [null]), 'invalid_observation');
    problem(gate().fixture_state_coverage({}, observations), 'invalid_registry');
  });
});
