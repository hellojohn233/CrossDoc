import type { MutableModels } from "@earendil-works/pi-ai";

import { profileRequestOptions, resolveModelProfile } from "./agent.js";
import type { ParsedDocument } from "./core/claims.js";
import type { AdjudicationResult, JudgeSource, KeyDataExtraction, ReviewModel } from "./core/types.js";
import { adjudicatePairs } from "./tools/adjudicate.js";
import { extractKeyData } from "./tools/key-data.js";
import { ruleAdjudicatePairs } from "./tools/rule-adjudicate.js";
import { extractKeyDataByRules } from "./tools/rule-key-data.js";
import type { ModelProfile } from "./storage/database.js";

function messageOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 200);
}

/**
 * The model-backed stages of the review, backed by the main model configured in Settings.
 *
 * When no model is configured, or a model call fails, the stage falls back to a
 * rule pass and says so. The review still completes, and the response reports
 * which stage produced the result.
 */
export function createReviewModel(models: MutableModels, profile: ModelProfile | undefined): ReviewModel {
  let resolved: Awaited<ReturnType<typeof resolveModelProfile>> | undefined;

  const complete = async (prompt: string): Promise<string> => {
    if (!resolved) {
      if (!profile?.modelId?.trim()) throw new Error("No model is configured in Settings.");
      resolved = await resolveModelProfile(models, profile, "main");
    }
    const response = await models.completeSimple(
      resolved.model,
      {
        messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }],
      },
      {
        ...profileRequestOptions(resolved.profile),
        ...(resolved.profile.apiKey ? { apiKey: resolved.profile.apiKey } : {}),
      },
    );
    return response.content
      .filter((item) => item.type === "text")
      .map((item) => item.text ?? "")
      .join("\n");
  };

  const hasModel = Boolean(profile?.modelId?.trim());

  return {
    extractKeyData: async (document: ParsedDocument): Promise<KeyDataExtraction> => {
      if (!hasModel) {
        return {
          items: extractKeyDataByRules(document),
          source: "rule",
          warning: "No model is configured in Settings, so the key data was extracted by rules only.",
        };
      }
      try {
        return { items: await extractKeyData(document, { complete }), source: "model" };
      } catch (error) {
        return {
          items: extractKeyDataByRules(document),
          source: "rule",
          warning: `The language model could not read the key data of ${document.title} (${messageOf(error)}), so rules were used instead.`,
        };
      }
    },

    adjudicate: async (pairs): Promise<AdjudicationResult> => {
      if (pairs.length === 0) return { judgments: [], source: "model" };
      if (!hasModel) {
        return {
          judgments: ruleAdjudicatePairs(pairs),
          source: "rule",
          warning: "No model is configured in Settings, so the conflicts were judged by rules only.",
        };
      }
      try {
        return { judgments: await adjudicatePairs(pairs, { complete }), source: "model" };
      } catch (error) {
        return {
          judgments: ruleAdjudicatePairs(pairs),
          source: "rule",
          warning: `The language model could not judge the conflicts (${messageOf(error)}), so they were judged by rules instead.`,
        };
      }
    },
  };
}
