---
id: ui-002
scope: conflict-ledger-redesign
depends_on: [ui-001]
status: done
---

# ui-002: Conflict Ledger redesign

## Objective

Make the conflict list the product's primary surface. Every entry must show what actually differs between the two source claims — in the source words, with the difference highlighted — instead of a generated sentence that only names the two files.

## Context

The existing ledger card renders `conflict.summary` ("Potential fact inconsistency between contract-a.pdf-ea36423aac and contract-b.pdf-f785245824"), `conflict.rationale`, a raw `score` percentage, and a status badge. The summary contains a content hash and is unreadable; the rationale is a fixed template; `score` is a token-overlap similarity, so a higher number means "more alike", which reads backwards next to a "verified" badge. The right inspector splits the same conflict into three stacked panels (Claim Pair / Evidence / Markdown Report), so the two halves of one comparison are never on screen together.

## Visual rules

Two earlier passes were rejected as ugly. The third one was rebuilt against the design language in `awesome-design-md`, which holds a `DESIGN.md` extracted from 73 real products. The rules below are the ones actually applied, with their source.

- **Warm cream canvas, never pure white.** Claude's spec is explicit: "Pure white reads as any other AI tool; the warm tint is the brand differentiator." CrossDoc already runs on `#f2eee5` with a 30px grid, so the ledger keeps it. (`claude`)
- **No boxes.** Every container, card and nested panel is gone. The page is the surface; structure is carried by 1px hairlines and type. Wired: "The brand uses no drop-shadows. Surface contrast and hairline borders carry all visual hierarchy." (`wired`)
- **No drop shadows anywhere in the ledger.** Five of the six systems studied forbid them; elevation comes from a surface ladder instead. (`linear.app`, `raycast`, `clickhouse`, `posthog`, `figma`)
- **Radius 0 for structure, 2px for inputs and tags.** Wired's signature is square geometry; The Verge calls 2px "a typewriter tag". (`wired`, `theverge`)
- **Type split.** Serif for the quoted contract language and the conflict headline (Copernicus / FK Roman pattern); humanist sans for UI structure; monospace strictly for taxonomy — eyebrows, column heads, ids, page numbers. Monospace is uppercase with positive tracking and never carries a paragraph. (`claude`, `theverge`, `figma`, `v4 recipe 11`)
- **Eyebrow above the title.** A monospace uppercase kicker with 0.18em tracking above the serif headline, the way The Verge and Figma signpost sections. (`theverge`, `figma`)
- **One column, no split.** A list beside a detail pane was tried and rejected: the comparison had no room and the two panes fought each other. Each conflict is now one self-contained entry that carries its own A/B comparison and evidence, stacked down a single column.
- **The ledger is a register, not a card grid.** A numbered index column hanging off a continuous vertical rail, a hairline rule per row, mono column heads. Data-table recipe: mono-caps header, 1px row rule. (`v4 recipe 8`, `theverge` StoryStream rail)
- **Selected row = one surface notch lighter plus a 2px ink left bar.** Never a coloured fill, never a border. (`v4 recipe 9`, `vercel` sidebar row)
- **Print redline for the diff.** The A side marks the wording as removed (strikethrough, red), the B side marks it as added (underline, blue) — the contract-redlining convention, not a generic diff theme. Both also carry a 12%-alpha tint of their foreground, the "pale background + saturated foreground" semantic recipe. (`v4 recipe 6`)
- **One accent colour.** Blue for anything interactive; red and amber mean severity only. No decorative colour. (`v4 recipe 1`)
- **Focus is a 50%-alpha accent outline, never a fill change.** (`linear.app`, `posthog`)
- **Numbers, page numbers and ids in a monospace face with tabular numerals.** (`linear.app`, `vercel`)

The preview page ships four interchangeable colourways over one data layer: `?v=base|a|b|c` (default / paper / dark / minimal). The `base` one is the target.

## Scope

- Split the Web UI stylesheet out of `public/index.html` into `public/styles.css` so more than one page can use the same visual system.
- Add `public/js/conflict-ledger.js`, split into two layers:
  - Pure functions, no DOM: `splitTokens`, `diffTokens`, `extractValues`, `detectPolarity`, `describeConflict`, `buildLedgerModel`.
  - Rendering, data in / DOM out: `renderConflictCard`, `renderConflictDetail`, `mountLedger`.
- Add `public/ledger-preview.html`: a design preview with mock data, so the layout can be reviewed before the backend is wired up. Its data seam is a single `fetchReview()` call.
- New card anatomy: severity colour bar, human-readable title, difference signals, side-by-side A/B quotes with the differing tokens highlighted, and one "open source" action per side.
- Split the list into `待处理` (verified) and `已排除` (dismissed) groups. Dismissed entries stay reviewable but are visually demoted (dashed bar, muted background).
- Do not display `score` in this iteration. The field is a similarity measure, not a confidence measure; it only comes back once the backend semantics are fixed.
- Leave the existing review console in place for now. The preview page is a parallel surface, not a replacement.

## Interface seam

The component consumes exactly the `POST /api/review` response body:

```
{ documents: [{ id, title, sourceUrl? }], claimCount, conflictCount, reportMarkdown, conflicts: Conflict[] }
Conflict = { id, status, severity, summary, rationale, score, claims: [Claim, Claim], evidence: EvidenceSpan[] }
```

`claim.evidence[0].id` matches an entry in `conflict.evidence`, which is what the "open source" action needs for page-accurate rendering.

## Verification

- `npm run verify:conflict-diff` — 11 assertions over the pure functions (identical text, numeric difference, Chinese negation, date normalisation, grouping and severity ordering).
- `npm run verify:web-read` — unchanged and still green after the stylesheet extraction.
- `npm run typecheck`, `npm run build`.
- Headless Chrome screenshots of both groups in `public/ledger-preview.html`.

## Out of scope

- Backend conflict semantics (`src/tools/compare.ts`, `src/tools/verify.ts`). The preview deliberately uses mock data because the current pipeline reports 26 verified conflicts of which 21 have byte-identical quotes on both sides.
- Replacing the review console layout, moving the Markdown Report panel, and deleting the Review Map.
