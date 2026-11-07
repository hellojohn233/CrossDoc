---
name: key-data-alignment
description: Collect the key data every document asserts and line the documents up so their values can be compared.
disable-model-invocation: true
---

# Key data alignment

A key is one thing a document states about itself. Two documents that state the same kind of thing carry the same key, whatever words they use.

This skill is loaded by `consistency-review`, in that order. Load it when the review procedure says so.

1. Decide which vocabulary to use. If a domain skill is loaded, use that skill's keys — they are the vocabulary for this review, so do not call `list_key_vocabulary`. If no domain skill is loaded, call `list_key_vocabulary` and use exactly those keys. When the document states something material that no key of the chosen vocabulary covers, use a short custom key in the same style rather than forcing a wrong key onto it.
2. For each parsed document, list the key data that document states. One item per key per document:
   - `value` is only the value. `90 days`, not `within 90 days of receipt`. `USD 150000`, not `USD 150000 including delivery and support`. `Northwind Analytics and Bright Harbor Ltd.`, not `Agreement between Northwind Analytics and Bright Harbor Ltd.`
   - `quote` is the exact sentence that states the value, copied verbatim from the document you parsed.
   - `documentId` and `page` say where that sentence came from.
3. If a document states two values for one key, keep the one the key names. If it really carries several, give them separate custom keys so they do not overwrite each other.
4. When the items of every document are collected, call `align_key_data` with all of them. The tool groups the items by key and returns the pairs whose values differ. Keys whose values agree never reach the comparison, and neither do keys only one document states.

Compare data, not sentences. Two documents that use completely different wording still carry the same key, and a shared clause that states no value is not key data at all.

For worked examples of a value and a quote that are written correctly, read `references/examples.md`. It is optional: the rules above are the ones that decide the outcome.
