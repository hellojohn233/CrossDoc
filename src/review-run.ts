import type { Agent } from "@earendil-works/pi-agent-core";
import type { MutableModels } from "@earendil-works/pi-ai";

import { toolDetails, toolStructured } from "./agent-events.js";
import { createCrossDocAgent, type CrossDocAgentOptions, type ScopedDocument } from "./agent.js";
import type { Claim, ParsedDocument } from "./core/claims.js";
import type { RenderedPdfPage } from "./loaders/render-pdf-page.js";
import type { ParseDocumentOptions } from "./loaders/types.js";
import type { AlignedPair, KeyDataItem } from "./core/key-data.js";
import type { Conflict, ConflictJudgment, ReviewResult } from "./core/types.js";
import type { ModelProfile } from "./storage/database.js";
import { claimForItem } from "./tools/align.js";
import { reportConflicts } from "./tools/report.js";
import { verifyConflicts } from "./tools/verify.js";

/** How long one review run may take before it is cut short and reported anyway. */
export const DEFAULT_REVIEW_TIMEOUT_MS = 10 * 60 * 1000;

export interface ReviewRunOptions {
  documents: ScopedDocument[];
  agentFactory?: (options: CrossDocAgentOptions) => Promise<Agent>;
  models?: MutableModels;
  mainProfile?: ModelProfile;
  visionProfile?: ModelProfile;
  onDocumentUpdated?: (document: ParsedDocument, source: ScopedDocument) => Promise<void> | void;
  onDocumentRejected?: (documentId: string, source: ScopedDocument, reason: string) => Promise<void> | void;
  /** Called when the agent starts a tool, so a caller can report real progress. */
  onStage?: (toolName: string) => void;
  /** Injected parser and page renderer, intended for deterministic integration tests. */
  parseDocument?: (path: string, options?: ParseDocumentOptions) => Promise<ParsedDocument>;
  renderScanPage?: (path: string, page: number) => Promise<RenderedPdfPage>;
  /** How long the agent may run before the run is cut short and the result is reported anyway. */
  timeoutMs?: number;
}

export interface ReviewRunResult extends ReviewResult {
  /** The tools the agent actually called, in order. */
  stages: string[];
}

/**
 * Run a consistency review the way the product intends it: the agent reads the
 * `consistency-review` skill and drives the tools itself.
 *
 * This module does not decide anything. It scopes the documents, collects what
 * the tools returned, and re-verifies the verdicts against the parsed source so
 * a finding that cannot be quoted is dropped.
 */
export async function runConsistencyReview(options: ReviewRunOptions): Promise<ReviewRunResult> {
  const parsed = new Map<string, ParsedDocument>();
  const rejected: { id: string; reason: string }[] = [];
  const notes: string[] = [];
  const items: KeyDataItem[] = [];
  const pairs: AlignedPair[] = [];
  const judgments: ConflictJudgment[] = [];
  const stages: string[] = [];

  const agent = await (options.agentFactory ?? createCrossDocAgent)({
    documents: options.documents,
    ...(options.models ? { models: options.models } : {}),
    ...(options.mainProfile ? { mainProfile: options.mainProfile } : {}),
    ...(options.visionProfile ? { visionProfile: options.visionProfile } : {}),
    ...(options.parseDocument ? { parseDocument: options.parseDocument } : {}),
    ...(options.renderScanPage ? { renderScanPage: options.renderScanPage } : {}),
    onDocumentUpdated: async (document, source) => {
      parsed.set(document.id, document);
      await options.onDocumentUpdated?.(document, source);
    },
    onDocumentRejected: async (documentId, source, reason) => {
      await options.onDocumentRejected?.(documentId, source, reason);
      parsed.delete(documentId);
      rejected.push({ id: documentId, reason });
    },
  });

  agent.subscribe((event) => {
    if (event.type === "tool_execution_start") {
      const args = event.args as Record<string, unknown> | undefined;
      if (event.toolName === "align_key_data" && Array.isArray(args?.items)) {
        items.length = 0;
        items.push(...(args.items as KeyDataItem[]));
      }
      if (event.toolName === "verify_conflicts" && Array.isArray(args?.judgments)) {
        judgments.length = 0;
        judgments.push(...(args.judgments as ConflictJudgment[]));
      }
      if (!stages.includes(event.toolName)) stages.push(event.toolName);
      options.onStage?.(event.toolName);
      return;
    }
    if (event.type === "tool_execution_end") {
      const details = toolDetails(event);
      if (event.toolName === "parse_document" && typeof details.documentId === "string" && details.status === "error") {
        rejected.push({ id: details.documentId, reason: String(details.error ?? "Document parsing failed.") });
      }
      // The aligned pairs come from what align_key_data returned, not from what
      // the model typed into the next call.
      if (event.toolName === "align_key_data") {
        const structured = toolStructured(event);
        const aligned = structured && typeof structured === "object" ? (structured as { pairs?: unknown }).pairs : undefined;
        if (Array.isArray(aligned)) {
          pairs.length = 0;
          pairs.push(...(aligned as AlignedPair[]));
        }
      }
    }
  });

  const scope = options.documents.map((document) => `${document.title} (${document.id})`).join(", ");
  const timeoutMs = options.timeoutMs ?? DEFAULT_REVIEW_TIMEOUT_MS;
  const timer = setTimeout(() => {
    agent.abort();
    notes.push(`The review agent was stopped after ${Math.round(timeoutMs / 1000)} seconds. The report covers what it had already found.`);
  }, timeoutMs);
  try {
    await agent.prompt([
      "Run a consistency review over the documents selected in this request.",
      `Available document IDs: ${scope}`,
      "Load the consistency-review skill and follow it. Read every scan-candidate page with render_scan_page before you compare anything.",
    ].join("\n\n"));
  } catch (error) {
    notes.push(error instanceof Error ? error.message : "The review agent stopped early.");
  } finally {
    clearTimeout(timer);
  }

  const documents = [...parsed.values()];
  const claims = items.map((item) => claimForItem(item, parsed.get(item.documentId)));
  const conflicts = verifyConflicts(pairs, judgments, { judgeSource: "model", documents: parsed });
  const reportMarkdown = renderReport({ documents, claims, conflicts }, notes);

  const warning = [
    ...rejected.map((item) => `${item.id} could not be read: ${item.reason}`),
    ...notes,
  ].join("; ");

  return {
    documents,
    claims,
    conflicts,
    reportMarkdown,
    judgeSource: "model",
    stages,
    ...(warning ? { warning } : {}),
  };
}

/**
 * Renders the Markdown report, keeping the findings if the report cannot be
 * rendered. A report that fails to format is a worse outcome than a plain
 * one, and never a reason to drop the conflicts that were already found.
 */
function renderReport(
  result: { documents: ParsedDocument[]; claims: Claim[]; conflicts: Conflict[] },
  notes: string[],
): string {
  try {
    return reportConflicts(result);
  } catch (error) {
    notes.push(`The Markdown report could not be rendered: ${error instanceof Error ? error.message : String(error)}`);
    const verified = result.conflicts.filter((conflict) => conflict.status === "verified");
    return [
      "# CrossDoc Consistency Review",
      "",
      `Documents reviewed: ${result.documents.length}`,
      `Claims extracted: ${result.claims.length}`,
      `Verified conflicts: ${verified.length}`,
      "",
      "## Findings",
      "",
      ...verified.map((conflict) => `- ${conflict.severity}: ${conflict.summary}\n  - ${conflict.rationale}`),
    ].join("\n");
  }
}
