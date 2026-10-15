import { randomUUID } from "node:crypto";
import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import express from "express";
import multer from "multer";

import { reviewDocuments } from "./review.js";
import { listLibraryDocuments, saveLibraryDocument } from "./storage/library-store.js";
import { writeReviewArtifacts } from "./storage/review-store.js";

const app = express();
const port = Number(process.env.PORT ?? 5177);
const uploadDir = resolve(".crossdoc/uploads");
const publicDir = resolve("public");
const pdfjsDir = resolve("node_modules/pdfjs-dist/build");
const documentIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

await mkdir(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_request, _file, callback) => callback(null, `${randomUUID()}.pdf`),
  }),
  limits: {
    files: 12,
    fileSize: 25 * 1024 * 1024,
  },
  fileFilter: (_request, file, callback) => {
    if (file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf")) {
      callback(null, true);
      return;
    }

    callback(new Error("Only PDF files are supported."));
  },
});

app.use(express.static(publicDir));
app.use("/vendor/pdfjs", express.static(pdfjsDir, { maxAge: "1y", immutable: true }));

app.get("/api/library", async (_request, response) => {
  try {
    const documents = await listLibraryDocuments();
    response.json({
      documents: documents.map((document) => ({
        ...document,
        sourceUrl: `/api/library/${document.id}/source`,
        markdownUrl: `/api/library/${document.id}/markdown`,
      })),
    });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Unable to read the library." });
  }
});

app.get("/api/library/:id/source", async (request, response) => {
  const { id } = request.params;
  if (!id || !documentIdPattern.test(id)) {
    response.status(404).json({ error: "Document not found." });
    return;
  }

  const filePath = resolve("data/library", id, "source.pdf");
  try {
    await access(filePath);
    response.type("application/pdf").sendFile(filePath, { headers: { "Cache-Control": "no-store" } });
  } catch {
    response.status(404).json({ error: "Document not found." });
  }
});

app.get("/api/library/:id/markdown", async (request, response) => {
  const { id } = request.params;
  if (!id || !documentIdPattern.test(id)) {
    response.status(404).json({ error: "Document not found." });
    return;
  }

  const filePath = resolve("data/library", id, "document.md");
  try {
    await access(filePath);
    response.type("text/markdown; charset=utf-8").sendFile(filePath, { headers: { "Cache-Control": "no-store" } });
  } catch {
    response.status(404).json({ error: "Document not found." });
  }
});

app.get("/api/documents/:id/file", async (request, response) => {
  const { id } = request.params;
  if (!id || !documentIdPattern.test(id)) {
    response.status(404).json({ error: "Document not found." });
    return;
  }

  const filePath = resolve(uploadDir, `${id}.pdf`);
  try {
    await access(filePath);
    response.type("application/pdf").sendFile(filePath, { headers: { "Cache-Control": "no-store" } });
  } catch {
    response.status(404).json({ error: "Document not found." });
  }
});

app.post("/api/review", upload.array("documents"), async (request, response) => {
  const files = Array.isArray(request.files) ? request.files : [];
  if (files.length === 0) {
    response.status(400).json({ error: "Please upload at least one PDF." });
    return;
  }

  try {
    const reviewId = randomUUID();
    const result = await reviewDocuments(files.map((file) => file.path), {
      documents: files.map((file) => ({
        id: file.filename.replace(/\.pdf$/i, ""),
        title: file.originalname,
      })),
    });
    await writeReviewArtifacts(result, resolve(".crossdoc/reviews", reviewId));

    await Promise.all(result.documents.map((document) => {
      const sourceFile = files.find((file) => file.filename === `${document.id}.pdf`);
      if (!sourceFile) throw new Error(`Uploaded source file missing for document ${document.id}.`);
      return saveLibraryDocument(document, sourceFile.path, sourceFile.originalname);
    }));

    response.json({
      reviewId,
      documents: result.documents.map((document) => ({
        id: document.id,
        title: document.title,
        pages: document.pages.length,
        format: document.format,
        markdown: document.markdown,
        warnings: document.warnings,
        sourceUrl: `/api/library/${document.id}/source`,
      })),
      claimCount: result.claims.length,
      conflictCount: result.conflicts.length,
      verifiedConflictCount: result.conflicts.filter((conflict) => conflict.status === "verified").length,
      conflicts: result.conflicts,
      reportMarkdown: result.reportMarkdown,
    });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Review failed.",
    });
  }
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  response.status(400).json({
    error: error instanceof Error ? error.message : "Request failed.",
  });
});

app.listen(port, () => {
  console.log(`CrossDoc Web UI: http://localhost:${port}`);
});
