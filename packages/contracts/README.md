# @aeos/contracts

The dependency root and **stability core** of AEOS: Zod schemas, with JSON
Schema exports, for

- the event envelope and the canonical event taxonomy;
- domain objects: Workspace, Agent, CredentialProfile, Session, Objective,
  PlanTask, Checkpoint and Policy;
- the plugin manifest and `PLUGIN_ABI_VERSION`.

`contracts` is also the **plugin ABI**. Third-party plugins build against
these shapes.

```ts
import { AeosEventSchema, AgentConfigSchema, PLUGIN_ABI_VERSION } from '@aeos/contracts';
```

JSON Schemas for non-TypeScript consumers are in `schemas/*.json`.

## Guarantees

The full policy is in
[`docs/compatibility.md`](../../docs/compatibility.md). This package
promises:

- **Additive within a major version.** New fields are optional and new
  event types extend the taxonomy. Removing or renaming a field or event
  type, or tightening validation of existing input, happens only in a major
  release, backed by an ADR.
- **The JSON Schemas are the contract.** `schemas/*.json` are generated
  from the Zod sources, and CI fails if the two ever disagree
  (`test/schema-drift.test.ts`). Any change to the published shape is
  therefore visible in review.
- **Tolerant readers.** Consumers must ignore unknown fields and unknown
  event types. AEOS itself does, so older daemons and UIs keep working
  alongside newer producers within a major version.
- **Versioned wire protocol.** `PROTOCOL_VERSION` (the envelope's `v`) only
  changes in a major release, and the runner protocol negotiates the highest
  version both sides support.
- **Plugin ABI gate.** A plugin declares the `PLUGIN_ABI_VERSION` range it
  supports. AEOS refuses plugins outside that range with a typed
  `contract_mismatch` error rather than loading them half-compatible.
- **No dependencies on the rest of AEOS.** Enforced by dependency-cruiser.
  Importing contracts never pulls in the kernel, providers or UI.
