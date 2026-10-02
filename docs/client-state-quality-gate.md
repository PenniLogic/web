# Web client-state quality-gate foundation

The existing native `npm test` discovers `tests/client-state-taxonomy.test.ts`. It consumes the
accepted taxonomy for [PenniLogic/docs#1](https://github.com/PenniLogic/docs/issues/1) and exercises
the published `taxonomy_first` and `client_state_coverage` assertion contracts. No additional
script, dependency, workflow, network fetch, application state, route or UI is introduced.

**Current product coverage: `not_exercised`.** `quality/client-state-taxonomy/registry.json` is
genuinely empty: no web product surfaces or client state enumeration have been adopted. A green
Vitest run proves the pin and the finite assertion/refusal fixtures, not rendered application
coverage, accessibility, physical-device behavior, load acceptance or completion of T-QA-06.
Issue closure, independent reviews and acceptance remain with the coordinating session.

## Immutable source

`quality/client-state-taxonomy/source.json` records taxonomy version `1.1.0`, schema version `1`,
the public Docs repository/organization numerical IDs, immutable commit
`a700e639585c61a4610e7b99dbd02b2dab28bdcc`, complete tree
`3879d3893a3f289bd6b0d4474f09dbebf1fef195`, and each artifact's path, Git blob, byte length and
SHA-256. Acquisition verified the complete signed Git commit object, all 22 tree objects in the
non-truncated 209-entry tree, and the three complete source blobs. The document is a reference,
not a vendored executable or a runtime input.

| Source artifact                             | Git blob                                   | SHA-256                                                            |
| ------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| `product/client-state-taxonomy.json`        | `47c3b234fb3921cdd5057a77d95610d72da0805a` | `040d2f0c27332ce3f6794a90139e714b3c50afb5b7340aa596d47b8866f2b3fb` |
| `product/client-state-taxonomy.schema.json` | `703c67f535852d91cf06f6b585b083dbdb1901c9` | `6bceee452e135835baa7733886d3aceae6322df5a6aefc0c9ea9f9d35ddebfc1` |
| `product/client-state-taxonomy.md`          | `2a3b35572bfda0040e313e912f6ff6224c03469d` | `7d8fc9d415c18c90c715726c09f93dc7774527dd17ea42a5a4b0a3587f172717` |

The two vendored files end in `.json.bytes` because their accepted JSON whitespace must remain
unchanged. They are ordinary UTF-8 JSON bytes, read explicitly by the native test, not reformatted
by Prettier's directory discovery. The repository formatter configuration is untouched.

`createClientStateGate` receives three byte inputs: `manifest`, `data`, `schema`. It first checks
the manifest against the code-pinned SHA-256
`d59c4fecb26b5d36d4629a406c582c5a47141915832f2621c41b5fbe81a0b1a2`, then checks both vendored
lengths, SHA-256 values and Git blob hashes before parsing. Missing, changed, malformed, duplicate
or unknown pin content cannot establish a new self-declared authority. Source failures throw
static errors; input failures return explicit `failed` results without echoing copy or data.

The loader projects the accepted fields it consumes; it does not duplicate the Docs taxonomy
validator. Native registration, identifier, scope and data-display validation reuse the pinned
schema definitions through the existing lockfile-pinned Zod JSON Schema converter.

## Registration contract

The registry envelope has exactly `kind`, `client`, `taxonomy_version`, `state_ids`, `surfaces`.
Production uses `kind: "production_registry"`, `client: "web"` and the pinned version.
`state_ids` must eventually come from the real client's enumeration, not from a fabricated
registration or a copied provider example.

Each surface has exactly the shape of the source schema's `definitions.surface_registration`:
required `surface_id`, `client`, `applicable_states`, `item`, `attempt`; optional `primary_action`,
`what_appears_here`, `still_available`, `submit_label`, `capabilities`, `freshness_window_seconds`.
No new state vocabulary or API-code binding is defined here.

`taxonomy_first` refuses an unknown or duplicated client ID, an unknown applicable ID and an
applicable ID absent from the explicit enumeration. Coverage additionally refuses duplicate
surfaces, missing applicable observations and invalid scope/client/version/copy/action inputs.
Production coverage refuses `example_`/`fixture_` surface IDs and synthetic registrations.

## Rendered-observation contract

`StateObservation` in `tools/client-state-gate/index.ts` defines the strict input shape. A future
native render adapter must supply actual observed facts, not an expected-output object.

| Field                                                           | Meaning                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `client`, `taxonomy_version`, `surface_id`, `state_id`, `scope` | Bind the observation to this client, exact source version, explicit registration and a scope permitted by that state.                                                                                                                                                                                                                            |
| `cause`, `variant`                                              | Optional published selectors only. Denial copy/labels are selected by `cause`; error and quota use their published variants.                                                                                                                                                                                                                     |
| `placeholders`                                                  | Only placeholders used by the selected canonical copy/action, each with `value` and the source's exact `source` tag. Registered values must match the registration; capability must belong to its capabilities.                                                                                                                                  |
| `context`                                                       | Platform-reported `connectivity`, `displayable_data_present` for the affected data, and `loading_phase` for loading only. Unsaved form input or other regions are not that affected data.                                                                                                                                                        |
| `rendered`                                                      | Actual headline/body, recovery-control IDs/labels, data-display/visibility facts, unaffected-surface usability, hidden-data-disclosure result, additional state text, stale marker count, offline marker text/null, and whether metered controls remain disabled. No raw-record or hidden-count fields; adapters must never supply that content. |
| `evidence`                                                      | `kind: "rendered_observation"`, `producer: "native_render_test"`, identifier-shaped `run_id`, current capture `source_commit`, `artifact_sha256` and relative `artifact_path`. Test/fixture/example/synthetic and traversing/absolute artifact paths are refused.                                                                                |

Every applicable state needs a canonical observation with its single published recovery action.
Loading before the slow threshold is the published exception: no copy/action is shown, and that
observation alone cannot satisfy loading coverage; the post-threshold observation is also
required. No timing budget is invented.

Every loading observation must keep unaffected regions usable, including an early skeleton
followed by a valid later observation. All region/action states must coexist with unaffected
surface content; a whole-surface error may still make the surface's purpose unavailable.
An empty observation cannot declare affected displayable data, even when its rendering says
`none`; contradictory context fails with the static `empty_with_displayable_data` code.

Copy and action labels are instantiated from the pinned data, never paraphrased. The error
validation variant keeps the registered submit label at action scope. Denial binds to the
published cause's copy/action and requires hidden affected data, no extra state text or hidden
data disclosure, and usable unaffected content. Stale requires retained data, one marker and
the offline headline beside it only when the platform reports offline; offline has no affected
displayable data. Quota supports the published reset/rate-limited variants, omitting the reset
sentence only when permitted and the service supplied no reset time.

Placeholder checks reject undeclared, unused, missing, wrongly sourced or unregistered values,
the published forbidden terms, obvious monetary/internal-detail forms and unsafe control/markup
characters. The English `still_available` check conservatively rejects obvious singular
subjects; it is not a general natural-language grammar or semantic privacy proof.

**Evidence limits:** this pure assertion module does not open/hash referenced capture artifacts,
authenticate a producer, inspect a DOM or independently verify an adapter's boolean facts.
Metadata alone, including dishonestly relabelled fixtures, is never proof of actual rendering.
T-QA-06 must wire a real current-head renderer, verify artifact provenance and applicability,
and assess the source's behavioral, privacy and accessibility requirements. No adapter,
production observations or exhaustive prose/placeholder-semantic validator exists in this
foundation. No UI, visual, localization, accessibility or performance acceptance is claimed.

## Results and native execution

| Status          | Meaning                                                                                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `failed`        | At least one explicit refusal; no success-shaped fallback. Problems contain static codes and indices, never observed text.                                                  |
| `not_exercised` | No client enumeration for `taxonomy_first`, or no registered surfaces for coverage. This is the production result today, not a skip hidden as coverage passed.              |
| `fixture_proof` | Finite synthetic assertion proof only. `fixture_state_coverage` requires a synthetic registry and labelled synthetic observations; it never returns production `passed`.    |
| `passed`        | The supplied production enumeration or rendered-observation contract satisfied its finite checks. Not whole-product/T-QA acceptance or independent provenance verification. |

Run the focused native suite from the repository root:

```text
npm test -- tests\client-state-taxonomy.test.ts
```

The existing native `npm test` and `npm run verify` include these tests; no manual workflow is
needed. `tests/fixtures/client-state-taxonomy/synthetic.ts` is explicitly synthetic and contains
no authoritative observations. Planted omissions, unknown IDs, copy/action defects, denied-data
disclosure, stale/offline mistakes, changed pins and evidence refusals prove that the contracts
bite. The actual production registry result is printed as `not_exercised`.

Extensions follow sections 12/13 of the
[accepted taxonomy](https://github.com/PenniLogic/docs/blob/a700e639585c61a4610e7b99dbd02b2dab28bdcc/product/client-state-taxonomy.md):
publish identifiers/copy and bump their version in Docs first, obtain acceptance there, then
explicitly update verified bytes, manifest and code pin here. Rollback reverts this bounded
foundation; it does not alter client UI or the source taxonomy.
