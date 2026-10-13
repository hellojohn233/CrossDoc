import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { createModels, type JsonValue } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";

import type { Claim, ParsedDocument } from "./core/claims.js";
import type { Conflict } from "./core/types.js";
import { compareClaims } from "./tools/compare.js";
import { extractClaims } from "./tools/extract.js";
import { parseDoc } from "./tools/parse.js";
import { reportConflicts } from "./tools/report.js";
import { verifyConflicts } from "./tools/verify.js";

const parseDocParameters = Type.Object({
  path: Type.String({ description: "Local PDF path to parse." }),
});

const extractClaimsParameters = Type.Object({
  document: Type.Any({ description: "ParsedDocument returned by parse_doc." }),
});

const compareClaimsParameters = Type.Object({
  claims: Type.Array(Type.Any()),
});

const verifyConflictsParameters = Type.Object({
  conflicts: Type.Array(Type.Any()),
});

const reportConflictsParameters = Type.Object({
  documents: Type.Array(Type.Any()),
  claims: Type.Array(Type.Any()),
  conflicts: Type.Array(Type.Any()),
});

function toJsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

type ParseDocInput = Static<typeof parseDocParameters>;
type ExtractClaimsInput = Static<typeof extractClaimsParameters>;
type CompareClaimsInput = Static<typeof compareClaimsParameters>;
type VerifyConflictsInput = Static<typeof verifyConflictsParameters>;
type ReportConflictsInput = Static<typeof reportConflictsParameters>;

export function createCrossDocTools(): AgentTool[] {
  return [
    {
      name: "parse_doc",
      label: "Parse document",
      description: "Parse a local PDF into page-grounded text.",
      parameters: parseDocParameters,
      execute: async (_toolCallId, params) => {
        const input = params as ParseDocInput;
        const document = await parseDoc(input.path);
        return {
          content: [{ type: "text", text: `Parsed ${document.title} with ${document.pages.length} pages.` }],
          structuredContent: toJsonValue(document),
          details: { documentId: document.id },
        };
      },
    },
    {
      name: "extract_claims",
      label: "Extract claims",
      description: "Extract conservative, evidence-grounded claims from a parsed document.",
      parameters: extractClaimsParameters,
      execute: async (_toolCallId, params) => {
        const input = params as ExtractClaimsInput;
        const claims = extractClaims(input.document as ParsedDocument);
        return {
          content: [{ type: "text", text: `Extracted ${claims.length} claims.` }],
          structuredContent: toJsonValue(claims),
          details: { count: claims.length },
        };
      },
    },
    {
      name: "compare_claims",
      label: "Compare claims",
      description: "Compare claims across documents and return candidate conflicts.",
      parameters: compareClaimsParameters,
      execute: async (_toolCallId, params) => {
        const input = params as CompareClaimsInput;
        const conflicts = compareClaims(input.claims as Claim[]);
        return {
          content: [{ type: "text", text: `Found ${conflicts.length} candidate conflicts.` }],
          structuredContent: toJsonValue(conflicts),
          details: { count: conflicts.length },
        };
      },
    },
    {
      name: "verify_conflicts",
      label: "Verify conflicts",
      description: "Verify candidate conflicts and demote weak matches to control false positives.",
      parameters: verifyConflictsParameters,
      execute: async (_toolCallId, params) => {
        const input = params as VerifyConflictsInput;
        const conflicts = verifyConflicts(input.conflicts as Conflict[]);
        return {
          content: [{ type: "text", text: `Verified ${conflicts.filter((item) => item.status === "verified").length} conflicts.` }],
          structuredContent: toJsonValue(conflicts),
          details: { count: conflicts.length },
        };
      },
    },
    {
      name: "report_conflicts",
      label: "Report conflicts",
      description: "Render a traceable Markdown report from documents, claims, and conflicts.",
      parameters: reportConflictsParameters,
      execute: async (_toolCallId, params) => {
        const input = params as ReportConflictsInput;
        const report = reportConflicts({
          documents: input.documents as ParsedDocument[],
          claims: input.claims as Claim[],
          conflicts: input.conflicts as Conflict[],
        });
        return {
          content: [{ type: "text", text: report }],
          structuredContent: { report },
          details: { length: report.length },
        };
      },
    },
  ];
}

export function createCrossDocAgent() {
  const models = createModels();

  return new Agent({
    initialState: {
      systemPrompt: [
        "You are CrossDoc, an evidence-grounded document consistency review agent.",
        "Your priority is false-positive control: every finding must cite exact evidence.",
        "Use parse_doc, extract_claims, compare_claims, verify_conflicts, and report_conflicts in that order unless the user asks otherwise.",
      ].join("\n"),
      tools: createCrossDocTools(),
    },
    streamFn: models.streamSimple.bind(models),
  });
}
