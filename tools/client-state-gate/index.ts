import { z } from 'zod';

import { checkRendering } from './copy.ts';
import { freeze, loadPinnedSource, type SourceManifest } from './source.ts';

export interface SurfaceRegistration {
  readonly surface_id: string;
  readonly client: string;
  readonly applicable_states: readonly string[];
  readonly item: string;
  readonly attempt: string;
  readonly primary_action?: string;
  readonly what_appears_here?: string;
  readonly still_available?: string;
  readonly submit_label?: string;
  readonly capabilities?: readonly string[];
  readonly freshness_window_seconds?: number;
}

export interface ClientRegistry {
  readonly kind: 'production_registry' | 'synthetic_fixture';
  readonly client: string;
  readonly taxonomy_version: string;
  readonly state_ids: readonly string[];
  readonly surfaces: readonly SurfaceRegistration[];
}

const evidence = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('synthetic_fixture'),
    label: z.string().startsWith('SYNTHETIC'),
  }),
  z.strictObject({
    kind: z.literal('rendered_observation'),
    producer: z.literal('native_render_test'),
    run_id: z.string().min(1),
    source_commit: z.string().regex(/^[a-f0-9]{40}$/),
    artifact_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    artifact_path: z.string().min(1),
  }),
]);
const observationShape = z.strictObject({
  evidence,
  client: z.string(),
  taxonomy_version: z.string(),
  surface_id: z.string(),
  state_id: z.string(),
  scope: z.string(),
  cause: z.string().optional(),
  variant: z.string().optional(),
  placeholders: z.record(
    z.string(),
    z.strictObject({ value: z.string().min(1), source: z.string() }),
  ),
  context: z.strictObject({
    connectivity: z.enum(['online', 'offline']),
    displayable_data_present: z.boolean(),
    loading_phase: z.enum(['before_slow_threshold', 'after_slow_threshold']).optional(),
  }),
  rendered: z.strictObject({
    headline: z.string(),
    body: z.string(),
    recovery_actions: z.array(z.strictObject({ id: z.string(), label: z.string() })),
    data_display: z.string(),
    data_visible: z.boolean(),
    unaffected_surface_usable: z.boolean(),
    hidden_data_disclosed: z.boolean(),
    additional_state_text: z.array(z.string()),
    stale_marker_count: z.number().int().nonnegative(),
    offline_marker: z.string().nullable(),
    metered_controls_disabled: z.boolean(),
  }),
});

export type StateObservation = z.infer<typeof observationShape>;

export interface GateProblem {
  readonly code: string;
  readonly registration?: number;
  readonly observation?: number;
}

export interface GateResult {
  readonly assertion: 'taxonomy_first' | 'client_state_coverage';
  readonly status: 'passed' | 'failed' | 'not_exercised' | 'fixture_proof';
  readonly registered_surfaces: number;
  readonly applicable_states: number;
  readonly observed_states: number;
  readonly problems: readonly GateProblem[];
}

export interface ClientStateGate {
  readonly source: Readonly<SourceManifest>;
  readonly state_ids: readonly string[];
  taxonomy_first(registry: unknown): GateResult;
  client_state_coverage(registry: unknown, observations: unknown): GateResult;
  fixture_state_coverage(registry: unknown, observations: unknown): GateResult;
}

function realArtifact(path: string): boolean {
  const normalized = path.replaceAll('\\', '/');
  return (
    normalized === normalized.trim() &&
    !/[\p{Cc}\p{Cf}:]/u.test(normalized) &&
    !normalized.startsWith('/') &&
    !normalized.split('/').some((part) => part === '..' || part === '.' || part === '') &&
    !/(?:^|\/)tests?(?:\/|$)|(?:^|[/_.-])(?:fixtures?|examples?)(?=[/_.-]|$)|synthetic/i.test(
      normalized,
    )
  );
}

export function createClientStateGate(input: unknown): ClientStateGate {
  const source = loadPinnedSource(input);
  const registration = z.custom<SurfaceRegistration>(
    (value) => source.registration.safeParse(value).success,
  );
  const registryShape = z.strictObject({
    kind: z.enum(['production_registry', 'synthetic_fixture']),
    client: z.literal('web'),
    taxonomy_version: z.literal(source.manifest.taxonomy_version),
    state_ids: z.array(z.string()),
    surfaces: z.array(registration),
  });
  const observationsShape = z.array(
    observationShape.refine(
      (entry) =>
        entry.client === 'web' &&
        entry.taxonomy_version === source.manifest.taxonomy_version &&
        source.identifier.safeParse(entry.surface_id).success &&
        source.scope.safeParse(entry.scope).success &&
        source.dataDisplay.safeParse(entry.rendered.data_display).success,
    ),
  );

  function inspectRegistry(input: unknown): {
    registry?: ClientRegistry;
    problems: GateProblem[];
  } {
    const parsed = registryShape.safeParse(input);
    if (
      !parsed.success ||
      parsed.data.surfaces.some((surface) => surface.client !== parsed.data.client)
    ) {
      return { problems: [{ code: 'invalid_registry' }] };
    }
    const registry = parsed.data;
    const problems: GateProblem[] = [];
    const identifiers = new Set<string>();
    for (const id of registry.state_ids) {
      if (!source.identifiers.includes(id)) {
        problems.push({ code: 'unknown_state' });
      }
      if (identifiers.has(id)) {
        problems.push({ code: 'duplicate_state' });
      }
      identifiers.add(id);
    }
    const surfaces = new Set<string>();
    registry.surfaces.forEach((surface, index) => {
      if (surfaces.has(surface.surface_id)) {
        problems.push({ code: 'duplicate_surface', registration: index });
      }
      surfaces.add(surface.surface_id);
      for (const id of surface.applicable_states) {
        if (!source.identifiers.includes(id)) {
          problems.push({ code: 'unknown_state', registration: index });
        }
        if (!identifiers.has(id)) {
          problems.push({ code: 'state_not_enumerated', registration: index });
        }
      }
    });
    return { registry, problems };
  }

  function result(
    assertion: GateResult['assertion'],
    registry: ClientRegistry | undefined,
    problems: readonly GateProblem[],
    observed = 0,
    exercised = false,
  ): GateResult {
    return freeze({
      assertion,
      status:
        problems.length > 0
          ? 'failed'
          : !exercised
            ? 'not_exercised'
            : registry?.kind === 'synthetic_fixture'
              ? 'fixture_proof'
              : 'passed',
      registered_surfaces: registry?.surfaces.length ?? 0,
      applicable_states:
        registry?.surfaces.reduce(
          (total, surface) => total + surface.applicable_states.length,
          0,
        ) ?? 0,
      observed_states: observed,
      problems: [...problems],
    });
  }

  function coverage(
    registryInput: unknown,
    observationInput: unknown,
    mode: 'rendered_observation' | 'synthetic_fixture',
  ): GateResult {
    const { registry, problems } = inspectRegistry(registryInput);
    if (registry === undefined) {
      return result('client_state_coverage', registry, problems);
    }
    if (
      mode === 'rendered_observation' &&
      (registry.kind !== 'production_registry' ||
        registry.surfaces.some((surface) => /^(?:example|fixture)_/.test(surface.surface_id)))
    ) {
      problems.push({ code: 'fixture_registration_refused' });
    } else if (mode === 'synthetic_fixture' && registry.kind !== 'synthetic_fixture') {
      problems.push({ code: 'fixture_registration_required' });
    }
    const parsed = observationsShape.safeParse(observationInput);
    if (!parsed.success) {
      problems.push({ code: 'invalid_observation' });
      return result('client_state_coverage', registry, problems);
    }
    const covered = new Set<string>();
    const observed = new Set<string>();
    parsed.data.forEach((observation, index) => {
      if (observation.evidence.kind !== mode) {
        problems.push({ code: 'fixture_evidence_refused', observation: index });
        return;
      }
      if (
        observation.evidence.kind === 'rendered_observation' &&
        (!source.identifier.safeParse(observation.evidence.run_id).success ||
          !realArtifact(observation.evidence.artifact_path))
      ) {
        problems.push({ code: 'invalid_rendered_evidence', observation: index });
        return;
      }
      const surface = registry.surfaces.find(
        (entry) => entry.surface_id === observation.surface_id,
      );
      const state = source.taxonomy.states.find((entry) => entry.id === observation.state_id);
      if (surface === undefined) {
        problems.push({ code: 'unregistered_surface', observation: index });
        return;
      }
      if (state === undefined) {
        problems.push({ code: 'unknown_state', observation: index });
        return;
      }
      if (!surface.applicable_states.includes(state.id)) {
        problems.push({ code: 'state_not_applicable', observation: index });
        return;
      }
      if (!state.scopes.includes(observation.scope)) {
        problems.push({ code: 'invalid_scope', observation: index });
        return;
      }
      const key = JSON.stringify([
        surface.surface_id,
        state.id,
        observation.scope,
        observation.cause,
        observation.variant,
        observation.context.loading_phase,
        observation.context.connectivity,
      ]);
      if (observed.has(key)) {
        problems.push({ code: 'duplicate_observation', observation: index });
        return;
      }
      observed.add(key);
      const rendering = checkRendering(source, state, surface, observation);
      problems.push(...rendering.problems.map((code) => ({ code, observation: index })));
      if (rendering.countsForCoverage) {
        covered.add(JSON.stringify([surface.surface_id, state.id]));
      }
    });
    registry.surfaces.forEach((surface, index) => {
      for (const id of surface.applicable_states) {
        if (!covered.has(JSON.stringify([surface.surface_id, id]))) {
          problems.push({ code: 'missing_observation', registration: index });
        }
      }
    });
    return result(
      'client_state_coverage',
      registry,
      problems,
      covered.size,
      registry.surfaces.length > 0,
    );
  }

  return Object.freeze({
    source: source.manifest,
    state_ids: source.identifiers,
    taxonomy_first(input: unknown): GateResult {
      const { registry, problems } = inspectRegistry(input);
      return result('taxonomy_first', registry, problems, 0, (registry?.state_ids.length ?? 0) > 0);
    },
    client_state_coverage(registry: unknown, observations: unknown): GateResult {
      return coverage(registry, observations, 'rendered_observation');
    },
    fixture_state_coverage(registry: unknown, observations: unknown): GateResult {
      return coverage(registry, observations, 'synthetic_fixture');
    },
  });
}
