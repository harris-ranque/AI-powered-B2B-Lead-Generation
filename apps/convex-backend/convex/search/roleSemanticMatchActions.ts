"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { normalizeRolePattern } from "../lib/roleExpansion";

const SEMANTIC_MATCH_SYSTEM_PROMPT = `You judge whether job titles match user-requested target roles for B2B lead enrichment.

Return JSON only:
{
  "matches": {
    "<exact provider title>": true | false
  }
}

Rules:
- true when the provider title is the same functional lane as a requested role (synonyms, seniority variants, practitioner/developer/engineer equivalents).
- true examples: "DevOps Engineer" matches "Senior DevOps Engineer", "DevOps practitioner", "DevOps Developer".
- false when the title is a different function (e.g. Accountant vs DevOps Engineer).
- Use the exact provider title strings as keys in matches.`;

async function resolveOpenAiKeyForSemanticMatch(
  ctx: { runAction: (action: any, args: any) => Promise<any> },
  userId: string,
): Promise<string | null> {
  try {
    const result = (await ctx.runAction(
      internal.userApiKeys.actions.getDecryptedApiKey,
      {
        userId,
        provider: "openai",
        purpose: "role_expansion",
      },
    )) as { apiKey?: string };
    if (result?.apiKey?.trim()) {
      return result.apiKey.trim();
    }
  } catch {
    // Fall back to platform key.
  }

  const platformKey = process.env.OPENAI_API_KEY?.trim();
  return platformKey || null;
}

function parseSemanticMatchResponse(
  content: string,
  titles: string[],
): Record<string, boolean> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {};
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  const record = parsed as Record<string, unknown>;
  const matches = record.matches;
  if (!matches || typeof matches !== "object" || Array.isArray(matches)) {
    return {};
  }

  const result: Record<string, boolean> = {};
  for (const title of titles) {
    const key = Object.keys(matches).find(
      (candidate) =>
        normalizeRolePattern(candidate) === normalizeRolePattern(title),
    );
    const value = key ? (matches as Record<string, unknown>)[key] : undefined;
    if (typeof value === "boolean") {
      result[normalizeRolePattern(title)] = value;
    }
  }

  return result;
}

export const batchEvaluateSemanticTitles = internalAction({
  args: {
    userId: v.id("users"),
    requestedRoles: v.array(v.string()),
    titles: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const uniqueTitles = Array.from(
      new Set(args.titles.map((title) => title.trim()).filter(Boolean)),
    );
    if (uniqueTitles.length === 0 || args.requestedRoles.length === 0) {
      return { acceptedTitles: [] as string[] };
    }

    const apiKey = await resolveOpenAiKeyForSemanticMatch(ctx, args.userId);
    if (!apiKey) {
      return { acceptedTitles: [] as string[] };
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SEMANTIC_MATCH_SYSTEM_PROMPT },
          {
            role: "user",
            content: JSON.stringify({
              requested_roles: args.requestedRoles,
              provider_titles: uniqueTitles,
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(
        "[roleSemanticMatch] OpenAI failed:",
        response.status,
        errorText.slice(0, 200),
      );
      return { acceptedTitles: [] as string[] };
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content ?? "";
    const decisions = parseSemanticMatchResponse(content, uniqueTitles);

    const acceptedTitles = uniqueTitles.filter(
      (title) => decisions[normalizeRolePattern(title)] === true,
    );

    return { acceptedTitles };
  },
});
