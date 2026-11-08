---
id: ui-004
scope: review-history-page
depends_on: [ui-003, storage-002]
status: done
---

# ui-004: Give the review history its own page

## Objective

Move the review history out of the Library and onto a page of its own, so that the Library keeps the inputs and the history keeps the results.

## Context

The Library page had two blocks: the archived documents, and under them the reviews that had been run before. The second block was the odd one out. The Library is a document archive — it holds the files, and a checkbox on a row picks the files a review reads. The review history holds the output of running the agent: the conflicts, the report, the count of what was confirmed.

Putting them on one page said they were the same kind of thing, and made the review history look like a section of document management. But the review result is this product's main output. A review that was run is not a document in a folder; it is a finding the user wants to look at again.

Three placements were considered:

- **A separate header tab.** The Library becomes a pure document list, the history becomes its own page.
- **A column inside the review console.** The console is already heavy — the pipeline, the ledger, the filters — and reaching it from the Library would be a detour through the upload flow.
- **A per-document history.** The truest model, because a review does belong to the documents it read, but it needs a schema change and it does not answer "what did I run last week" across documents.

The user picked A.

## Decision

### The history is a header tab of its own

`审查记录` sits between `资料库` and `模型配置`. The Library keeps the documents and the selection bar; the history keeps one row per review: the document titles, the counts, the time, and `打开`.

### Opening a stored review keeps the tab marked

`打开` loads the stored review body into the console, which is the same console a live run ends in. The console is reached from two directions, and the header has to say which one: `setView()` takes an optional tab override, and a review opened from the history leaves `审查记录` marked as the current tab.

The same moment fixed a defect that the old placement had: `返回阅读` returned to the running read, but a stored review has no running read behind it. It is hidden when the console was opened from the history.

### The rows carry a hierarchy, not columns

One review is one row: the titles are the heading, the counts and the time are the line under it, and `打开` sits to the right. The same shape the skill list uses.

## Scope

- `public/index.html`: the `审查记录` tab, the `reviews` screen, the rewritten history list, the tab override in `setView()`.
- `public/styles.css`: the review history screen and its rows.
- `docs/modules/web-reading.md` and `docs/modules/conflict-ledger.md`: where the history lives and what `打开` does.

## Outcome

- The Library shows documents only.
- The history shows every stored review, newest first, and opens it in the console.
- A reopened review keeps `审查记录` marked and hides `返回阅读`.

## Follow-up

- **The history is a flat list.** It has no filter and no search. With many reviews the list is long, and the user has to read the titles to find one. A search over the titles would be the next step.
- **The stored review is opened, not continued.** There is no way to re-run a stored review with the current skills; the skills are read at the start of a run.
