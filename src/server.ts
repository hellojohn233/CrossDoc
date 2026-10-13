import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

import express from "express";
import multer from "multer";

import { reviewDocuments } from "./review.js";

const app = express();
const port = Number(process.env.PORT ?? 5177);
const uploadDir = resolve(".crossdoc/uploads");
const publicDir = resolve("public");

await mkdir(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
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

app.post("/api/review", upload.array("documents"), async (request, response) => {
  const files = Array.isArray(request.files) ? request.files : [];
  if (files.length === 0) {
    response.status(400).json({ error: "Please upload at least one PDF." });
    return;
  }

  try {
    const result = await reviewDocuments(files.map((file) => file.path));

    response.json({
      documents: result.documents.map((document) => ({
        id: document.id,
        title: document.title,
        pages: document.pages.length,
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
  } finally {
    await Promise.allSettled(files.map((file) => rm(file.path, { force: true })));
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
