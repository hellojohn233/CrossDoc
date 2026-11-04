import type { MutableModels } from "@earendil-works/pi-ai";

import { profileRequestOptions, resolveModelProfile } from "./agent.js";
import type { Adjudicator, CandidatePair, ConflictJudgment } from "./core/types.js";
import { adjudicateCandidates } from "./tools/adjudicate.js";
import { ruleAdjudicate } from "./tools/rule-adjudicate.js";
import type { ModelProfile } from "./storage/database.js";

function messageOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 200);
}

/**
 * Semantic adjudicator backed by the main model configured in Settings.
 *
 * When no model is configured, or the model call fails, the review still runs but
 * falls back to rule adjudication and says so in the warning field.
 */
export function createModelAdjudicator(models: MutableModels, profile: ModelProfile | undefined): Adjudicator {
  return async (candidates: CandidatePair[]): Promise<{ judgments: ConflictJudgment[]; source: "model" | "rule"; warning?: string }> => {
    if (candidates.length === 0) return { judgments: [], source: "model" };

    if (!profile?.modelId?.trim()) {
      return {
        judgments: ruleAdjudicate(candidates),
        source: "rule",
        warning: "No model is configured in Settings, so the conflicts were judged by rules only.",
      };
    }

    try {
      const resolved = await resolveModelProfile(models, profile, "main");
      const complete = async (prompt: string): Promise<string> => {
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
      const judgments = await adjudicateCandidates(candidates, { complete });
      return { judgments, source: "model" };
    } catch (error) {
      return {
        judgments: ruleAdjudicate(candidates),
        source: "rule",
        warning: `The language model could not judge the conflicts (${messageOf(error)}), so they were judged by rules instead.`,
      };
    }
  };
}
