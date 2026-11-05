---
name: consistency-review
description: Check whether the key data in a set of documents lines up, and report every disagreement with its source quote.
---

# Consistency review

Use this procedure when the user asks whether several documents agree, asks for a consistency check, or asks you to review a set of files against each other. The procedure is the point of this skill: follow it, and do not substitute a text diff or a search for similar sentences.

1. Call `inspect_document` for every selected document, then `parse_document` for each one.
2. For every page that comes back as a scan candidate, call `render_scan_page` for that page only. A page you skip is a page whose key data you never see, and an unread page looks exactly like an agreement. If the vision model cannot read a page, say so and keep that page in your report.
3. Load `key-data-alignment` and follow it to collect what key data each document states.
4. Load `conflict-adjudication` and follow it to decide which aligned values disagree and to report them.

The two skills in steps 3 and 4 are loaded by name. They are not listed among the available skills, because they are steps of this procedure rather than capabilities of their own. Load them in that order.

What the user gets is a conflict ledger: one entry per key that disagrees, each entry carrying both source quotes, the page each quote came from, and a one-sentence reason. Report what you can quote. A difference you cannot point at a sentence for is not a finding.
