---
id: ui-005
scope: archive-storage
depends_on: [storage-002, ui-004]
status: done
---

# ui-005: Let the archive be emptied

## Objective

Give the user a place where the whole archive is visible and can be removed — one archive at a time or all at once.

## Context

Every read archives the document: the source file, the converted Markdown, and the structured JSON. The archive keeps every upload, because an upload is a fact worth keeping, and the document list folds the copies of one content into a single row. That is the right shape for the list, and it left the archive without a way out.

The consequence was practical: the local archive filled with copies nobody wanted, and the only way to remove one was to ask someone to remove it. The user asked for an archive entry point inside the settings, with the archived documents listed there and a way to delete them.

## Decision

### The settings tab holds the archive

`模型配置` became `设置`, and the page now has two blocks: `模型` and `归档存储`. The archive is storage, and storage is a setting; it did not belong under the document list, and it did not deserve a sixth tab.

### The block shows the archive, not the document list

The document list folds the copies of one content into one row. The archive block does not fold anything: archives that share content sit in one group under the document's name, and each archive is a row with its own time and the first twelve characters of its content hash. The point of the block is to show what is actually stored, so hiding copies there would defeat it.

### Removal is the index and the files together

`DELETE /api/library/:id` removes one archive's directory and its row. `DELETE /api/library` removes every archive and empties the index. A row without files would offer a document that cannot be opened; files without a row would sit on disk with nothing left to find them.

The id has to be a UUID, and the storage layer refuses an id that is not a plain name. Both removals ask for a confirmation in the UI.

### A removal is reversible

The user asked for a way back, and a delete that cannot be undone is a delete the user has to think twice about. So a removal moves the archive's files to `data/trash/<id>/` and writes a note beside them carrying the index fields the row had. The index row leaves the library, so the document list and the archive list stop showing it.

`回收站` lists what is waiting there. `恢复` puts the archive back with the moment it first arrived — a document that comes back is the same document, not a new upload — and its source file opens again. `彻底删除` and `清空回收站` are the only final steps.

## Scope

- `src/storage/database.ts`: `deleteDocument()`, `deleteAllDocuments()`, and `restoreDocument()`.
- `src/storage/library-store.ts`: `deleteLibraryDocument()`, `clearLibraryDocuments()`, `listTrashedDocuments()`, `restoreLibraryDocument()`, `purgeTrashedDocument()`, and `clearTrash()`.
- `src/server.ts`: `DELETE /api/library/:id`, `DELETE /api/library`, `GET /api/trash`, `POST /api/library/:id/restore`, `DELETE /api/trash/:id`, and `DELETE /api/trash`.
- `public/index.html` and `public/styles.css`: the settings page, the archive block, and the trash block.
- `scripts/verify-library-delete.mjs`: fifteen checks over the removal and the recovery.

## Outcome

- The settings page holds the models, the archive, and the trash.
- Every archive is listed with its time and content hash, grouped by content.
- One archive or the whole archive can be removed, and the index and the files always agree afterwards.
- A removed archive can be restored, with the moment it first arrived intact.

## Follow-up

- **The trash is permanent once it is emptied.** `彻底删除` and `清空回收站` are the end of the line.
- **The trash is never cleaned up on its own.** It stays until the user empties it.
- **Removing an archive does not remove the reviews that read it.** A stored review keeps its own body, so a review can still be opened after the documents behind it are gone.
