import type { StateObservation, SurfaceRegistration } from './index.ts';
import type { PinnedSource, TaxonomyState } from './source.ts';

const PLACEHOLDER = /\{([a-z][a-z0-9_]*)\}/g;

function unsafeText(value: string, forbiddenTerms: readonly string[]): boolean {
  if (
    value !== value.trim() ||
    /[\p{Cc}\p{Cf}{}<>]|\p{Sc}|\b[A-Z]{3}\s+\d|\b\d+[.,]\d{2}\b/u.test(value) ||
    /\b[a-z][a-z0-9+.-]*:\/\/|\b[\w.-]+@[\w.-]+\.\w+|\b[0-9a-f]{32,}\b/i.test(value)
  ) {
    return true;
  }
  return forbiddenTerms.some((term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const before = /^[a-z0-9_]/i.test(term) ? '(?<![a-z0-9_])' : '';
    const after = /[a-z0-9_]$/i.test(term) ? '(?![a-z0-9_])' : '';
    return new RegExp(`${before}${escaped}${after}`, 'i').test(value);
  });
}

function ownValue<T>(values: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  return values !== undefined && Object.hasOwn(values, key) ? values[key] : undefined;
}

function pluralSubject(value: string): boolean {
  const subject = value.split(/\s+(?:with|from|in|of|for|that)\s/i)[0] ?? '';
  if (/\band\b/i.test(subject)) {
    return true;
  }
  const head = subject.trim().split(/\s+/).at(-1)?.toLowerCase() ?? '';
  return (
    ['people', 'children', 'data'].includes(head) ||
    (head.endsWith('s') &&
      !['access', 'status', 'news', 'business', 'analysis', 'series'].includes(head))
  );
}

function registrationValues(surface: SurfaceRegistration): ReadonlyMap<string, string | undefined> {
  return new Map([
    ['item', surface.item],
    ['attempt', surface.attempt],
    ['primary_action', surface.primary_action],
    ['what_appears_here', surface.what_appears_here],
    ['still_available', surface.still_available],
    ['submit_label', surface.submit_label],
  ]);
}

export function checkRendering(
  source: PinnedSource,
  state: TaxonomyState,
  surface: SurfaceRegistration,
  observation: StateObservation,
): { problems: readonly string[]; countsForCoverage: boolean } {
  const problems: string[] = [];
  const rendered = observation.rendered;
  const context = observation.context;

  if (observation.cause !== undefined && state.id !== 'permission_denied') {
    problems.push('invalid_cause');
  }
  if (
    observation.cause !== undefined &&
    !state.causes?.some((cause) => cause.id === observation.cause)
  ) {
    problems.push('invalid_cause');
  }
  if (state.id === 'permission_denied' && observation.variant !== undefined) {
    problems.push('invalid_variant');
  }
  const variant = state.id === 'permission_denied' ? observation.cause : observation.variant;
  const canonical = variant === undefined ? state.copy : ownValue(state.copy.variants, variant);
  if (canonical === undefined) {
    problems.push('invalid_variant');
  }
  if (observation.variant === 'validation' && observation.scope !== 'action') {
    problems.push('invalid_scope');
  }
  if (state.id !== 'loading' && context.loading_phase !== undefined) {
    problems.push('invalid_observation');
  }
  if (state.id === 'loading' && context.loading_phase === undefined) {
    problems.push('invalid_observation');
  }

  if (state.id === 'permission_denied') {
    if (
      rendered.data_display !== state.data_display ||
      rendered.data_visible ||
      rendered.hidden_data_disclosed !== state.guarantees?.discloses_hidden_data ||
      rendered.unaffected_surface_usable !== state.guarantees?.rest_of_surface_usable ||
      rendered.additional_state_text.length !== 0
    ) {
      problems.push('denial_guarantee');
    }
  } else {
    const visible = state.data_display === 'shown' || state.data_display === 'shown_marked';
    if (rendered.data_display !== state.data_display || rendered.data_visible !== visible) {
      problems.push('data_display_mismatch');
    }
    if (rendered.hidden_data_disclosed || rendered.additional_state_text.length !== 0) {
      problems.push('unexpected_state_content');
    }
  }
  if (
    ['permission_denied', 'quota_exceeded', 'offline', 'degraded'].includes(state.id) &&
    !rendered.unaffected_surface_usable
  ) {
    problems.push('unaffected_content_blocked');
  }
  if (
    state.id === 'quota_exceeded' &&
    (!rendered.metered_controls_disabled || !rendered.unaffected_surface_usable)
  ) {
    problems.push('quota_guarantee');
  }
  if (['loading', 'error'].includes(state.id) && context.displayable_data_present) {
    problems.push('held_data_requires_stale');
  }
  if (
    state.id === 'error' &&
    observation.variant !== 'validation' &&
    context.connectivity === 'offline'
  ) {
    problems.push('known_offline_requires_offline');
  }
  const offlineHeadline = source.taxonomy.states.find((entry) => entry.id === 'offline')?.copy
    .headline;
  if (
    (state.id === 'offline' &&
      (context.connectivity !== 'offline' || context.displayable_data_present)) ||
    (state.id === 'stale' &&
      (!context.displayable_data_present ||
        rendered.data_display !== state.data_display ||
        !rendered.data_visible ||
        rendered.stale_marker_count !== 1 ||
        rendered.offline_marker !== (context.connectivity === 'offline' ? offlineHeadline : null)))
  ) {
    problems.push('offline_stale_distinction');
  }
  if (
    state.id !== 'stale' &&
    (rendered.stale_marker_count !== 0 || rendered.offline_marker !== null)
  ) {
    problems.push('unexpected_state_marker');
  }

  const earlyLoading = state.id === 'loading' && context.loading_phase === 'before_slow_threshold';
  if (earlyLoading) {
    if (
      rendered.headline !== '' ||
      rendered.body !== '' ||
      Object.keys(observation.placeholders).length
    ) {
      problems.push('copy_mismatch');
    }
    if (rendered.recovery_actions.length !== 0) {
      problems.push('recovery_mismatch');
    }
    return { problems, countsForCoverage: false };
  }
  if (canonical === undefined || problems.includes('invalid_cause')) {
    return { problems, countsForCoverage: false };
  }

  let label = state.recovery_action.label;
  if (observation.cause !== undefined) {
    const causeLabel = ownValue(state.recovery_action.label_by_cause, observation.cause);
    if (causeLabel === undefined) {
      problems.push('invalid_cause');
    } else {
      label = causeLabel;
    }
  } else if (observation.variant !== undefined) {
    label = ownValue(state.recovery_action.label_by_variant, observation.variant) ?? label;
  }
  let body = canonical.body;
  // Only the published optional reset sentence may be omitted, never arbitrary copy.
  if (
    state.id === 'quota_exceeded' &&
    observation.variant === 'rate_limited' &&
    observation.placeholders.resets_at === undefined
  ) {
    body = body.replace(/(?:^|(?<=[.!?]))\s*[^.!?]*\{resets_at\}[^.!?]*[.!?]?/g, '').trim();
  }
  const templates = [canonical.headline, body, label];
  const required = new Set(
    templates.flatMap((template) => [...template.matchAll(PLACEHOLDER)].map((match) => match[1])),
  );
  const registration = registrationValues(surface);
  for (const key of Object.keys(observation.placeholders)) {
    if (!required.has(key)) {
      problems.push('invalid_placeholder');
    }
  }
  for (const id of required) {
    if (id === undefined) {
      problems.push('invalid_placeholder');
      continue;
    }
    const definition = source.taxonomy.placeholders.find((entry) => entry.id === id);
    const value = observation.placeholders[id];
    if (definition === undefined || value === undefined || value.source !== definition.source) {
      problems.push('invalid_placeholder');
      continue;
    }
    if (
      definition.source === 'surface_registration' &&
      (id === 'capability'
        ? !surface.capabilities?.includes(value.value)
        : registration.get(id) !== value.value)
    ) {
      problems.push('invalid_placeholder');
    }
    if (unsafeText(value.value, source.taxonomy.forbidden_terms)) {
      problems.push('unsafe_placeholder');
    }
    if (id === 'permission' && /[_]|[a-z]+\.[a-z]+/i.test(value.value)) {
      problems.push('unsafe_placeholder');
    }
    if (id === 'still_available' && !pluralSubject(value.value)) {
      problems.push('invalid_plural_placeholder');
    }
  }
  if (problems.some((entry) => entry.includes('placeholder'))) {
    return { problems, countsForCoverage: false };
  }
  function instantiate(template: string): string {
    return template.replace(PLACEHOLDER, (_, id: string) => observation.placeholders[id]!.value);
  }
  if (
    rendered.headline !== instantiate(canonical.headline) ||
    rendered.body !== instantiate(body)
  ) {
    problems.push('copy_mismatch');
  }
  const action = rendered.recovery_actions[0];
  if (
    rendered.recovery_actions.length !== 1 ||
    action?.id !== state.recovery_action.id ||
    action.label !== instantiate(label)
  ) {
    problems.push('recovery_mismatch');
  }
  return { problems, countsForCoverage: problems.length === 0 };
}
