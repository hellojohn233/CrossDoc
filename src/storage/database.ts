import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

export type ModelRole = "main" | "vision";
export type ModelProtocol = "catalog" | "openai-completions" | "anthropic-messages" | "google-generative-ai";

export interface ModelProfile {
  role: ModelRole;
  provider: string;
  protocol?: ModelProtocol;
  modelId: string;
  baseUrl?: string;
  apiKey?: string;
  options?: Record<string, unknown>;
}

export interface StoredDocument {
  id: string;
  title: string;
  sourceName: string;
  format: string;
  pages: number;
  uploadedAt: string;
  fileSize: number;
  sha256: string;
  sourcePath: string;
  documentJsonPath: string | null;
  markdownPath: string | null;
}

export interface LegacyLibraryMetadata {
  id: string;
  title: string;
  sourceName: string;
  format: string;
  pages: number;
  uploadedAt: string;
}

const schemaVersion = 2;

function relativePath(dataDirectory: string, absolutePath: string): string {
  const path = relative(dataDirectory, absolutePath).split(sep).join("/");
  if (!path || path === ".." || path.startsWith("../") || path.startsWith("/")) {
    throw new Error("Stored file path must be inside the data directory.");
  }
  return path;
}

export function resolveDataPath(dataDirectory: string, path: string): string {
  const fullPath = resolve(dataDirectory, path);
  const prefix = `${resolve(dataDirectory)}${sep}`;
  if (!fullPath.startsWith(prefix)) throw new Error("Stored file path escapes the data directory.");
  return fullPath;
}

export class LocalDatabase {
  readonly dataDirectory: string;
  readonly db: Database.Database;

  constructor(dataDirectory = resolve("data")) {
    this.dataDirectory = resolve(dataDirectory);
    mkdirSync(this.dataDirectory, { recursive: true });
    this.db = new Database(resolve(this.dataDirectory, "crossdoc.sqlite"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
    this.importLegacyMetadata();
  }

  private migrate() {
    const version = Number(this.db.pragma("user_version", { simple: true }));
    if (version > schemaVersion) throw new Error(`Database schema ${version} is newer than this CrossDoc version supports.`);
    if (version < 1) {
      this.db.exec(`
        CREATE TABLE documents (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          source_name TEXT NOT NULL,
          format TEXT NOT NULL,
          pages INTEGER NOT NULL CHECK (pages >= 0),
          uploaded_at TEXT NOT NULL,
          file_size INTEGER NOT NULL DEFAULT 0,
          sha256 TEXT NOT NULL DEFAULT '',
          source_path TEXT NOT NULL,
          document_json_path TEXT,
          markdown_path TEXT
        );
        CREATE INDEX documents_uploaded_at_idx ON documents(uploaded_at DESC);
        CREATE TABLE model_configs (
          role TEXT PRIMARY KEY CHECK (role IN ('main', 'vision')),
          provider TEXT NOT NULL,
          model_id TEXT NOT NULL,
          base_url TEXT,
          api_key TEXT,
          options_json TEXT NOT NULL DEFAULT '{}',
          updated_at TEXT NOT NULL
        );
        CREATE TABLE app_settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        PRAGMA user_version = 1;
      `);
    }
    const afterV1 = Number(this.db.pragma("user_version", { simple: true }));
    if (afterV1 < 2) {
      this.db.exec(`
        ALTER TABLE model_configs ADD COLUMN protocol TEXT NOT NULL DEFAULT 'catalog'
          CHECK (protocol IN ('catalog', 'openai-completions', 'anthropic-messages', 'google-generative-ai'));
        PRAGMA user_version = 2;
      `);
    }
  }

  private importLegacyMetadata() {
    const libraryDirectory = resolve(this.dataDirectory, "library");
    if (!existsSync(libraryDirectory)) return;
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO documents
        (id, title, source_name, format, pages, uploaded_at, file_size, sha256, source_path, document_json_path, markdown_path)
      VALUES (@id, @title, @sourceName, @format, @pages, @uploadedAt, @fileSize, @sha256, @sourcePath, @documentJsonPath, @markdownPath)
    `);
    const transaction = this.db.transaction(() => {
      for (const entry of readdirSync(libraryDirectory, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const entryDirectory = resolve(libraryDirectory, entry.name);
        const metadataPath = resolve(entryDirectory, "metadata.json");
        if (!existsSync(metadataPath)) continue;
        try {
          const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as Partial<LegacyLibraryMetadata>;
          if (typeof metadata.id !== "string" || typeof metadata.title !== "string" || typeof metadata.sourceName !== "string" || typeof metadata.format !== "string") continue;
          const sourcePath = resolve(entryDirectory, "source.pdf");
          const markdownPath = resolve(entryDirectory, "document.md");
          const jsonPath = resolve(entryDirectory, "document.json");
          const fileSize = existsSync(sourcePath) ? statSync(sourcePath).size : 0;
          const sha256 = fileSize ? createHash("sha256").update(readFileSync(sourcePath)).digest("hex") : "";
          insert.run({
            id: metadata.id,
            title: metadata.title,
            sourceName: metadata.sourceName,
            format: metadata.format,
            pages: Number.isInteger(metadata.pages) ? metadata.pages : 0,
            uploadedAt: typeof metadata.uploadedAt === "string" ? metadata.uploadedAt : new Date(0).toISOString(),
            fileSize,
            sha256,
            sourcePath: relativePath(this.dataDirectory, sourcePath),
            documentJsonPath: existsSync(jsonPath) ? relativePath(this.dataDirectory, jsonPath) : null,
            markdownPath: existsSync(markdownPath) ? relativePath(this.dataDirectory, markdownPath) : null,
          });
        } catch {
          // A malformed legacy metadata record should not prevent startup or other imports.
        }
      }
    });
    transaction();
  }

  saveDocument(input: Omit<StoredDocument, "fileSize" | "sha256" | "sourcePath" | "documentJsonPath" | "markdownPath">, sourceAbsolutePath: string, jsonAbsolutePath: string, markdownAbsolutePath: string) {
    const bytes = readFileSync(sourceAbsolutePath);
    const record: StoredDocument = {
      ...input,
      fileSize: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      sourcePath: relativePath(this.dataDirectory, sourceAbsolutePath),
      documentJsonPath: relativePath(this.dataDirectory, jsonAbsolutePath),
      markdownPath: relativePath(this.dataDirectory, markdownAbsolutePath),
    };
    this.db.prepare(`
      INSERT INTO documents
        (id, title, source_name, format, pages, uploaded_at, file_size, sha256, source_path, document_json_path, markdown_path)
      VALUES (@id, @title, @sourceName, @format, @pages, @uploadedAt, @fileSize, @sha256, @sourcePath, @documentJsonPath, @markdownPath)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, source_name=excluded.source_name, format=excluded.format,
        pages=excluded.pages, uploaded_at=excluded.uploaded_at, file_size=excluded.file_size, sha256=excluded.sha256,
        source_path=excluded.source_path, document_json_path=excluded.document_json_path, markdown_path=excluded.markdown_path
    `).run(record);
    return record;
  }

  listDocuments(): StoredDocument[] {
    return this.db.prepare(`SELECT id, title, source_name AS sourceName, format, pages, uploaded_at AS uploadedAt,
      file_size AS fileSize, sha256, source_path AS sourcePath, document_json_path AS documentJsonPath,
      markdown_path AS markdownPath FROM documents ORDER BY uploaded_at DESC`).all() as StoredDocument[];
  }

  getDocument(id: string): StoredDocument | undefined {
    return this.db.prepare(`SELECT id, title, source_name AS sourceName, format, pages, uploaded_at AS uploadedAt,
      file_size AS fileSize, sha256, source_path AS sourcePath, document_json_path AS documentJsonPath,
      markdown_path AS markdownPath FROM documents WHERE id = ?`).get(id) as StoredDocument | undefined;
  }

  getModelProfile(role: ModelRole): ModelProfile | undefined {
    const row = this.db.prepare(`SELECT role, provider, protocol, model_id AS modelId, base_url AS baseUrl, api_key AS apiKey,
      options_json AS optionsJson FROM model_configs WHERE role = ?`).get(role) as (ModelProfile & { optionsJson: string }) | undefined;
    if (!row) return undefined;
    const { optionsJson, ...profile } = row;
    return {
      role: profile.role,
      provider: profile.provider,
      protocol: profile.protocol ?? "catalog",
      modelId: profile.modelId,
      ...(profile.baseUrl ? { baseUrl: profile.baseUrl } : {}),
      ...(profile.apiKey ? { apiKey: profile.apiKey } : {}),
      options: JSON.parse(optionsJson) as Record<string, unknown>,
    };
  }

  saveModelProfile(profile: ModelProfile, clearApiKey = false): ModelProfile {
    const previous = this.getModelProfile(profile.role);
    const apiKey = clearApiKey ? undefined : profile.apiKey?.trim() || previous?.apiKey;
    const options = profile.options ?? previous?.options ?? {};
    this.db.prepare(`INSERT INTO model_configs(role, provider, protocol, model_id, base_url, api_key, options_json, updated_at)
      VALUES (@role, @provider, @protocol, @modelId, @baseUrl, @apiKey, @optionsJson, @updatedAt)
      ON CONFLICT(role) DO UPDATE SET provider=excluded.provider, model_id=excluded.model_id, base_url=excluded.base_url,
        protocol=excluded.protocol, api_key=excluded.api_key, options_json=excluded.options_json, updated_at=excluded.updated_at`).run({
      role: profile.role,
      provider: profile.provider.trim(),
      protocol: profile.protocol ?? "catalog",
      modelId: profile.modelId.trim(),
      baseUrl: profile.baseUrl?.trim() || null,
      apiKey: apiKey ?? null,
      optionsJson: JSON.stringify(options),
      updatedAt: new Date().toISOString(),
    });
    return { ...profile, protocol: profile.protocol ?? "catalog", ...(profile.baseUrl?.trim() ? { baseUrl: profile.baseUrl.trim() } : {}), ...(apiKey ? { apiKey } : {}), options };
  }

  close() { this.db.close(); }
}
