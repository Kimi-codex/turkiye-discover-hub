## Problem

The 10-stage import pipeline is manual by design, but the UI hides that fact. On the **Imports list page** (`/admin/imports`) each batch card only shows the current stage/status pill and an **Open** button — there's no hint that the user must click through per-stage buttons inside the detail page. That's why `final.json` looks frozen at `detect_schema / uploaded`: the pipeline is waiting for you to click **Detect schema**, but nothing on the list surfaces that.

Inside the detail page the `NextAction` panel already exists, but it's below the stepper and easy to miss, and its label ("Detect schema", "Approve field mapping → analysis", etc.) doesn't read as "this is the button that moves the pipeline forward".

## Fix — make the manual next-step obvious (no auto-run)

### 1. Imports list card (`src/routes/$lang._authenticated.admin.imports.tsx`)

For each batch, compute the next manual action from `stage` (same mapping as detail page):

| Stage | Button label |
|---|---|
| `detect_schema` | Detect schema |
| `field_mapping` | Approve field mapping |
| `analyze` | Run analysis |
| `mapping` | Confirm category mappings |
| `validation` / `preview` | Compute preview |
| `execute` | Run next chunk |
| `translations` | Enqueue translations |
| `images` | Mark images done |
| `publish` | Publish |
| `completed` | — (no button) |

Render it as a primary `Next: <label>` button on the card, next to **Open / Cancel / Delete**. Clicking it navigates to the batch detail page with the correct tab pre-selected (via `?tab=…`) and triggers that mutation — reusing the existing server functions (`detectImportSchema`, `approveImportFieldMapping`, `analyzeImportBatch`, `confirmImportMappings`, `computeImportPreview`, `runImportChunk`, `enqueueBatchTranslations`, `markImagesStageDone`, `publishImportBatch`). No new server logic.

Also add a small "Waiting for you" chip next to the stage pill whenever `status ∈ {uploaded, ready, previewed, awaiting_approval}` or the stage is in the list above and not currently `analyzing/importing/publishing`, so it's visually clear the batch is idle-by-design.

### 2. Batch detail page (`src/routes/$lang._authenticated.admin.imports.$id.tsx`)

- Move the existing `NextAction` panel **above** `StageProgress` so it's the first thing you see when opening a batch.
- Restyle it as a full-width call-to-action card (larger button, "Next step" heading, one-line description of what will happen).
- Keep the current stepper, tabs, and all existing per-tab buttons — no behavior change, only ordering + emphasis.

### 3. Short hint on the Imports page header

Change the subtitle from the current stage list to:
> "10-stage workflow — each stage waits for you. Click **Next: …** on a card to advance one step."

## Out of scope

- No auto-run of stages (per your choice).
- No server-side changes, no migrations, no changes to `imports.functions.ts` or `preview.ts`.
- No changes to translation/image workers.

## Verification

- Upload `small_flat.json` fixture; card shows `Next: Detect schema`. Click it → stage advances to `field_mapping`, card now shows `Next: Approve field mapping`. Continue through to `completed`, confirming each label matches the current stage.
- Existing `final.json` batch (stuck at `detect_schema`) will immediately show `Next: Detect schema` on the list, resolving the reported confusion.
