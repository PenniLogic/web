import type { ClientRegistry, StateObservation } from '../../../tools/client-state-gate/index.ts';

export const registry: ClientRegistry = {
  kind: 'synthetic_fixture',
  client: 'web',
  taxonomy_version: '1.1.0',
  state_ids: [
    'empty',
    'loading',
    'error',
    'offline',
    'stale',
    'permission_denied',
    'quota_exceeded',
    'degraded',
  ],
  surfaces: [
    {
      surface_id: 'fixture_customer_surface',
      client: 'web',
      applicable_states: [
        'empty',
        'loading',
        'error',
        'offline',
        'stale',
        'permission_denied',
        'quota_exceeded',
        'degraded',
      ],
      item: 'transactions',
      attempt: 'load your transactions',
      primary_action: 'Add a transaction',
      what_appears_here: 'Transactions you record, capture or import will appear here.',
      still_available: 'Saved answers and everything outside AI',
      submit_label: 'Save',
      capabilities: ['AI explanations', 'Automatic capture'],
      freshness_window_seconds: 86400,
    },
  ],
};

const noData: StateObservation['rendered'] = {
  headline: '',
  body: '',
  recovery_actions: [],
  data_display: 'none',
  data_visible: false,
  unaffected_surface_usable: true,
  hidden_data_disclosed: false,
  additional_state_text: [],
  stale_marker_count: 0,
  offline_marker: null,
  metered_controls_disabled: false,
};

function observation(
  state_id: string,
  rendered: StateObservation['rendered'],
  options: Partial<Pick<StateObservation, 'cause' | 'variant' | 'placeholders' | 'context'>> = {},
): StateObservation {
  return {
    evidence: {
      kind: 'synthetic_fixture',
      label: 'SYNTHETIC contract fixture; not rendered UI or product coverage',
    },
    client: 'web',
    taxonomy_version: '1.1.0',
    surface_id: 'fixture_customer_surface',
    state_id,
    scope: state_id === 'degraded' ? 'surface' : 'region',
    placeholders: {},
    context: { connectivity: 'online', displayable_data_present: false },
    ...options,
    rendered,
  };
}

export const observations: readonly StateObservation[] = [
  observation(
    'empty',
    {
      ...noData,
      headline: 'Nothing here yet',
      body: 'Transactions you record, capture or import will appear here.',
      recovery_actions: [{ id: 'primary_action', label: 'Add a transaction' }],
    },
    {
      placeholders: {
        primary_action: { value: 'Add a transaction', source: 'surface_registration' },
        what_appears_here: {
          value: 'Transactions you record, capture or import will appear here.',
          source: 'surface_registration',
        },
      },
    },
  ),
  observation(
    'loading',
    {
      ...noData,
      headline: 'Still loading',
      body: 'This is taking longer than expected.',
      recovery_actions: [{ id: 'cancel', label: 'Cancel' }],
    },
    {
      context: {
        connectivity: 'online',
        displayable_data_present: false,
        loading_phase: 'after_slow_threshold',
      },
    },
  ),
  observation(
    'error',
    {
      ...noData,
      headline: "Couldn't load your transactions",
      body: 'Try again in a moment.',
      recovery_actions: [{ id: 'retry', label: 'Try again' }],
    },
    {
      placeholders: {
        attempt: { value: 'load your transactions', source: 'surface_registration' },
      },
    },
  ),
  observation(
    'offline',
    {
      ...noData,
      headline: "You're offline",
      body: "Try again when you're back online.",
      recovery_actions: [{ id: 'retry', label: 'Try again' }],
    },
    {
      context: { connectivity: 'offline', displayable_data_present: false },
    },
  ),
  observation(
    'stale',
    {
      ...noData,
      headline: 'Last updated 10:30',
      body: 'Showing what was last saved.',
      recovery_actions: [{ id: 'refresh', label: 'Refresh' }],
      data_display: 'shown_marked',
      data_visible: true,
      stale_marker_count: 1,
    },
    {
      context: { connectivity: 'online', displayable_data_present: true },
      placeholders: {
        last_updated: { value: '10:30', source: 'client_cache' },
      },
    },
  ),
  observation(
    'permission_denied',
    {
      ...noData,
      headline: "You don't have access to this right now",
      body: 'Everything else keeps working.',
      recovery_actions: [{ id: 'review_access', label: "See what's shared with you" }],
      data_display: 'hidden',
    },
    { cause: 'sharing' },
  ),
  observation(
    'quota_exceeded',
    {
      ...noData,
      headline: "You've reached this period's limit of 5 AI questions",
      body: 'Saved answers and everything outside AI still work.',
      recovery_actions: [{ id: 'view_usage', label: 'See usage and plans' }],
      data_display: 'shown',
      data_visible: true,
      metered_controls_disabled: true,
    },
    {
      context: { connectivity: 'online', displayable_data_present: true },
      placeholders: {
        limit: { value: '5 AI questions', source: 'service_response' },
        still_available: {
          value: 'Saved answers and everything outside AI',
          source: 'surface_registration',
        },
      },
    },
  ),
  observation(
    'degraded',
    {
      ...noData,
      headline: "AI explanations isn't available right now",
      body: "Everything else is working. We'll keep checking.",
      recovery_actions: [{ id: 'retry', label: 'Try again' }],
      data_display: 'shown',
      data_visible: true,
    },
    {
      context: { connectivity: 'online', displayable_data_present: true },
      placeholders: {
        capability: { value: 'AI explanations', source: 'surface_registration' },
      },
    },
  ),
];
