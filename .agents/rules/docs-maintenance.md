---
trigger: always_on
---

When modifying node types in `src/types/nodes.ts`, default values in `src/utils/default-nodes.ts`, or runtime files in `src/runtime/`, update the corresponding concept doc in `docs/concepts/`.

The mapping from node types to doc files is in `docs/concepts/_manifest.json`. For each affected concept:
1. Update the Configuration table if type fields or defaults changed
2. Update the Runtime Behavior section if runtime logic changed
3. Set the `<!-- last-verified: YYYY-MM-DD -->` comment to today's date

If adding a new NodeType, create a new concept doc using `docs/concepts/_template.md` and add it to the manifest.
