"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { resolveEnrichmentRoles } from "../lib/enrichmentRoles";
import {
  buildStaticRolePatterns,
  mergeRolePatterns,
  mergeTitleMatchers,
  parseAiRoleExpansionResponse,
  ROLE_EXPANSION_SYSTEM_PROMPT,
} from "../lib/roleExpansion";

async function resolveOpenAiKeyForRoleExpansion(
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
    // Fall back to platform key for non-enterprise users.
  }

  const platformKey = process.env.OPENAI_API_KEY?.trim();
  return platformKey || null;
}

async function fetchAiRolePatterns(
  apiKey: string,
  userRoles: string[],
): Promise<{ findymailPatterns: string[]; titleSynonyms: string[] }> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: ROLE_EXPANSION_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            roles: userRoles,
            instruction:
              "For each role, return findymail_patterns and title_synonyms in the same functional lane.",
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `OpenAI role expansion failed: ${response.status} ${errorText.slice(0, 200)}`,
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content ?? "";
  return parseAiRoleExpansionResponse(content, userRoles);
}

export const expandSearchRolePatterns = internalAction({
  args: {
    searchId: v.id("searches"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const search = await ctx.runQuery(internal.search.internal.getSearchInternal, {
      searchId: args.searchId,
    });

    if (!search) {
      return { skipped: true, reason: "search_not_found" };
    }

    const userRoles = resolveEnrichmentRoles(undefined, search.parameters);
    if (userRoles.length === 0) {
      return { skipped: true, reason: "no_roles" };
    }

    const staticPatterns = buildStaticRolePatterns(userRoles);

    let findymailAiPatterns: string[] = [];
    let titleSynonyms: string[] = [];
    let source: "static" | "static+ai" = "static";

    const apiKey = await resolveOpenAiKeyForRoleExpansion(ctx, args.userId);
    if (apiKey) {
      try {
        const aiExpansion = await fetchAiRolePatterns(apiKey, userRoles);
        findymailAiPatterns = aiExpansion.findymailPatterns;
        titleSynonyms = aiExpansion.titleSynonyms;
        if (findymailAiPatterns.length > 0 || titleSynonyms.length > 0) {
          source = "static+ai";
        }
      } catch (error) {
        console.warn(
          "[roleExpansion] AI expansion failed, using static patterns only:",
          error,
        );
      }
    } else {
      console.warn(
        "[roleExpansion] No OpenAI key available; using static role patterns only",
      );
    }

    const expandedRolePatterns = mergeRolePatterns(
      userRoles,
      staticPatterns,
      findymailAiPatterns,
    );
    const expandedTitleMatchers = mergeTitleMatchers(userRoles, staticPatterns, [
      ...findymailAiPatterns,
      ...titleSynonyms,
    ]);

    await ctx.runMutation(internal.search.internal.updateSearchExpandedRolePatterns, {
      searchId: args.searchId,
      expandedRolePatterns,
      expandedTitleMatchers,
      roleExpansionSource: source,
    });

    return {
      skipped: false,
      patternCount: expandedRolePatterns.length,
      titleMatcherCount: expandedTitleMatchers.length,
      source,
    };
  },
});
