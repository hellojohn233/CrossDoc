---
name: conflict-adjudication
description: Decide whether aligned key values really disagree, and report each disagreement with its evidence.
disable-model-invocation: true
---

# Conflict adjudication

`align_key_data` hands you the pairs whose values differ. Your job is to decide whether the two values can both be right, not to restate the difference.

This skill is loaded by `consistency-review`, in that order. Load it when the review procedure says so.

Call `verify_conflicts` with one judgment per pair: `{candidateId, conflict, severity, confidence, summary, rationale}`. The pairs are the ones `align_key_data` returned, so you do not repeat them.

- `conflict: true` only when the two values cannot both be right for the same subject and scope. A different number, date, amount, duration, party, or jurisdiction is a conflict. A permission one document grants and the other forbids is a conflict.
- `conflict: true` when two documents in this review set describe the same kind of agreement but name different parties to it. Do not wave a different counterparty, client, or provider away on the ground that the documents are probably separate engagements. The review set is the set of documents the user asked to line up, and one of them naming a different party is exactly what they need to hear. Say that in the rationale.
- `conflict: false` when the two values are the same thing written differently, when one is more general or more specific but stays compatible with the other, or when the two values answer different questions inside one engagement — one document's termination notice against another document's payment term, so the key does not decide the same thing in both.
- `conflict: false` when a document does not state that key at all.
- `severity` is `high` when an amount, a deadline, or who is bound changes; `medium` when a material term changes; `low` when the difference is minor.
- `summary` is one short line naming what differs. `rationale` is one sentence saying why the two cannot both hold, written in the language of the quotes.
- `confidence` is how sure you are that the two values contradict, from 0 to 1.

Every judgment keeps its source sentence. A finding without a quote behind it is not a finding.

After the conflicts are verified, call `report_conflicts`. It takes no arguments: it reports the key data and the conflicts this run already produced. Call it once. A second call returns the same report.

Report one entry per key, not one entry per document pair. If three documents disagree on a key, that is one key with three values, not three separate findings.

For worked examples of each verdict, including the ones that look like conflicts but are not, read `references/examples.md`. It is optional: the rules above are the ones that decide the outcome.
