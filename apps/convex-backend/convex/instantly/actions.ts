"use node";

import { action, internalAction } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";
import { api, internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";

const INSTANTLY_BASE_URL = "https://api.instantly.ai/api/v2";

// Rate limit: 100 requests/10 seconds, 600 requests/minute
// Use ~150ms delay between batches to stay safe
const RATE_LIMIT_DELAY_MS = 150;
const BATCH_SIZE = 100;

// Helper: Parse name into first/last name
function parseName(fullName?: string): { firstName: string; lastName: string } {
  if (!fullName) return { firstName: "", lastName: "" };
  const parts = fullName.trim().split(/\s+/);
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" ") || "",
  };
}

// Helper: Build campaign payload
function buildCampaignPayload(
  name: string,
  senderEmail: string,
  leads: Doc<"leads">[]
) {
  // Find a lead with email content to use as template structure
  const templateLead = leads.find((l) => l.emailContent);

  // Build email steps
  const steps: Array<{
    type: string;
    delay: number;
    variants: Array<{ subject: string; body: string }>;
  }> = [];

  // Primary email - use merge tags for lead-specific content
  steps.push({
    type: "email",
    delay: 0,
    variants: [
      {
        // Use lead custom variables for personalized subject/body
        subject: "{{lt_email_subject}}",
        body: "{{lt_email_body}}",
      },
    ],
  });

  // Add follow-up emails if template lead has them
  if (templateLead?.followUpEmails && templateLead.followUpEmails.length > 0) {
    for (let i = 0; i < templateLead.followUpEmails.length; i++) {
      const followUp = templateLead.followUpEmails[i];
      if (!followUp) continue;
      steps.push({
        type: "automatic_email",
        delay: followUp.delay_days ?? (i + 1) * 3, // Default 3-day intervals
        variants: [
          {
            // Follow-ups also use merge tags
            subject: `{{lt_followup_${i + 1}_subject}}`,
            body: `{{lt_followup_${i + 1}_body}}`,
          },
        ],
      });
    }
  }

  return {
    name,
    email_list: [senderEmail],
    sequences: [{ steps }],
    // Campaign created as draft by default (not active)
  };
}

// Helper: Build leads payload for Instantly
function buildLeadsPayload(campaignId: string, leads: Doc<"leads">[]) {
  return {
    campaign_id: campaignId,
    leads: leads
      .map((lead) => {
        const primaryEmail = lead.contactInfo?.emails?.[0]?.email;
        if (!primaryEmail) return null;

        const primaryContact = lead.contactInfo?.contacts?.[0];
        const { firstName, lastName } = parseName(primaryContact?.name);

        // Build lead with custom variables for personalized emails
        const leadData: Record<string, string | undefined> = {
          email: primaryEmail,
          first_name: firstName,
          last_name: lastName,
          company_name: lead.businessName,
          website: lead.website || undefined,
          phone: lead.phone || undefined,
          // Primary email content as lead custom variables
          lt_email_subject: lead.emailContent?.subject || "",
          lt_email_body: lead.emailContent?.body || "",
        };

        // Add follow-up emails as custom variables
        if (lead.followUpEmails) {
          lead.followUpEmails.forEach((followUp, i) => {
            leadData[`lt_followup_${i + 1}_subject`] = followUp.subject || "";
            leadData[`lt_followup_${i + 1}_body`] = followUp.body || "";
          });
        }

        return leadData;
      })
      .filter(Boolean),
  };
}

// Types for Instantly accounts
type InstantlyAccount = {
  id: string;
  email: string;
  displayName?: string;
  status?: string;
};

// Fetch sender email accounts from Instantly
export const fetchSenderAccounts = action({
  args: {},
  handler: async (ctx): Promise<InstantlyAccount[]> => {
    const user = await requireAuth(ctx);

    // Get decrypted API key
    const keyResult = (await ctx.runAction(
      internal.userApiKeys.actions.getDecryptedApiKey,
      {
        userId: user._id,
        provider: "instantly",
        purpose: "fetch_sender_accounts",
      }
    )) as { apiKey: string };

    const response: Response = await fetch(`${INSTANTLY_BASE_URL}/accounts`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${keyResult.apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch Instantly accounts: ${errorText}`);
    }

    const data: unknown = await response.json();
    const accounts: unknown[] = Array.isArray(data)
      ? data
      : (data as { accounts?: unknown[] }).accounts || [];

    // Transform accounts to our format
    const formattedAccounts: InstantlyAccount[] = accounts.map((acc: unknown) => {
      const a = acc as Record<string, string | undefined>;
      return {
        id: a.id || a.email || "",
        email: a.email || "",
        displayName: a.display_name || a.first_name || undefined,
        status: a.status || a.warmup_status || undefined,
      };
    });

    // Cache accounts in user settings
    await ctx.runMutation(internal.instantly.internal.cacheAccounts, {
      userId: user._id,
      accounts: formattedAccounts,
    });

    return formattedAccounts;
  },
});

// Types for push result
type PushResult = {
  success: boolean;
  campaignId: string;
  campaignName: string;
  pushedCount: number;
  failedCount: number;
};

// Main action: Push search leads to Instantly campaign
export const pushToInstantly = action({
  args: {
    searchId: v.id("searches"),
    senderEmail: v.string(),
    senderAccountId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<PushResult> => {
    const user = await requireAuth(ctx);

    // Verify search belongs to user
    const search = await ctx.runQuery(api.search.queries.getSearch, {
      searchId: args.searchId,
    });

    if (!search) {
      throw new Error("Search not found");
    }

    if (search.userId !== user._id) {
      throw new Error("Not authorized to access this search");
    }

    if (search.status !== "completed") {
      throw new Error("Can only push completed searches to Instantly");
    }

    // Check for existing campaign (duplicate prevention)
    const existingCampaign = await ctx.runQuery(
      internal.instantly.queries.getCampaignBySearch,
      { searchId: args.searchId }
    );

    if (existingCampaign) {
      throw new Error("This search has already been pushed to Instantly");
    }

    // Get leads with email content
    const leads = await ctx.runQuery(
      internal.instantly.queries.getLeadsForPush,
      { searchId: args.searchId }
    );

    if (leads.length === 0) {
      throw new Error("No leads with email addresses found in this search");
    }

    // Get decrypted API key
    const keyResult = (await ctx.runAction(
      internal.userApiKeys.actions.getDecryptedApiKey,
      {
        userId: user._id,
        provider: "instantly",
        purpose: "create_campaign",
      }
    )) as { apiKey: string };

    const apiKey: string = keyResult.apiKey;
    const campaignName = search.name || `Genni Search - ${args.searchId}`;

    // Build and create campaign
    const campaignPayload = buildCampaignPayload(
      campaignName,
      args.senderEmail,
      leads
    );

    const campaignResponse = await fetch(`${INSTANTLY_BASE_URL}/campaigns`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(campaignPayload),
    });

    if (!campaignResponse.ok) {
      const errorText = await campaignResponse.text();
      throw new Error(`Failed to create Instantly campaign: ${errorText}`);
    }

    const campaign = (await campaignResponse.json()) as { id: string; name?: string };
    const campaignId: string = campaign.id;

    // Push leads in batches
    let pushedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < leads.length; i += BATCH_SIZE) {
      const batch = leads.slice(i, i + BATCH_SIZE);

      try {
        const leadsPayload = buildLeadsPayload(campaignId, batch);

        const leadsResponse = await fetch(`${INSTANTLY_BASE_URL}/leads`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(leadsPayload),
        });

        if (leadsResponse.ok) {
          pushedCount += batch.length;
        } else {
          failedCount += batch.length;
          console.error(
            `Instantly leads batch failed:`,
            await leadsResponse.text()
          );
        }
      } catch (error) {
        failedCount += batch.length;
        console.error(`Instantly leads batch error:`, error);
      }

      // Rate limit delay between batches
      if (i + BATCH_SIZE < leads.length) {
        await new Promise((resolve) =>
          setTimeout(resolve, RATE_LIMIT_DELAY_MS * BATCH_SIZE)
        );
      }
    }

    // Create campaign tracking record
    await ctx.runMutation(internal.instantly.internal.createCampaignRecord, {
      userId: user._id,
      searchId: args.searchId,
      instantlyCampaignId: campaignId,
      instantlyCampaignName: campaign.name || campaignName,
      senderEmail: args.senderEmail,
      leadsCount: pushedCount,
      autoPushed: false,
    });

    return {
      success: true,
      campaignId,
      campaignName: campaign.name || campaignName,
      pushedCount,
      failedCount,
    };
  },
});

// Types for auto-push result
type AutoPushSuccess = {
  success: true;
  campaignId: string;
  pushedCount: number;
  failedCount: number;
};

type AutoPushFailure = {
  success: false;
  reason: string;
  error?: string;
};

type AutoPushResult = AutoPushSuccess | AutoPushFailure;

// Internal action for auto-push (called by search orchestrator)
export const autoPushToInstantly = internalAction({
  args: {
    searchId: v.id("searches"),
    userId: v.id("users"),
    senderEmail: v.string(),
  },
  handler: async (ctx, args): Promise<AutoPushResult> => {
    try {
      // Check for existing campaign (duplicate prevention)
      const existingCampaign = await ctx.runQuery(
        internal.instantly.queries.getCampaignBySearch,
        { searchId: args.searchId }
      );

      if (existingCampaign) {
        console.log(
          `Auto-push skipped: Search ${args.searchId} already pushed to Instantly`
        );
        return { success: false, reason: "already_pushed" };
      }

      // Get search details
      const search = await ctx.runQuery(internal.search.internal.getSearchInternal, {
        searchId: args.searchId,
      });

      if (!search || search.status !== "completed") {
        console.log(
          `Auto-push skipped: Search ${args.searchId} not found or not completed`
        );
        return { success: false, reason: "search_not_ready" };
      }

      // Get leads
      const leads = await ctx.runQuery(
        internal.instantly.queries.getLeadsForPush,
        { searchId: args.searchId }
      );

      if (leads.length === 0) {
        console.log(`Auto-push skipped: No leads with emails in search`);
        return { success: false, reason: "no_leads" };
      }

      // Get decrypted API key
      const keyResult = (await ctx.runAction(
        internal.userApiKeys.actions.getDecryptedApiKey,
        {
          userId: args.userId,
          provider: "instantly",
          purpose: "auto_push_campaign",
        }
      )) as { apiKey: string };

      const apiKey: string = keyResult.apiKey;
      const campaignName = search.name || `Genni Search - ${args.searchId}`;

      // Build and create campaign
      const campaignPayload = buildCampaignPayload(
        campaignName,
        args.senderEmail,
        leads
      );

      const campaignResponse = await fetch(`${INSTANTLY_BASE_URL}/campaigns`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(campaignPayload),
      });

      if (!campaignResponse.ok) {
        const errorText = await campaignResponse.text();
        console.error(`Auto-push failed to create campaign:`, errorText);
        return { success: false, reason: "campaign_creation_failed" };
      }

      const campaign = (await campaignResponse.json()) as { id: string; name?: string };
      const campaignId: string = campaign.id;

      // Push leads in batches
      let pushedCount = 0;
      let failedCount = 0;

      for (let i = 0; i < leads.length; i += BATCH_SIZE) {
        const batch = leads.slice(i, i + BATCH_SIZE);

        try {
          const leadsPayload = buildLeadsPayload(campaignId, batch);

          const leadsResponse = await fetch(`${INSTANTLY_BASE_URL}/leads`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(leadsPayload),
          });

          if (leadsResponse.ok) {
            pushedCount += batch.length;
          } else {
            failedCount += batch.length;
          }
        } catch {
          failedCount += batch.length;
        }

        // Rate limit delay
        if (i + BATCH_SIZE < leads.length) {
          await new Promise((resolve) =>
            setTimeout(resolve, RATE_LIMIT_DELAY_MS * BATCH_SIZE)
          );
        }
      }

      // Create campaign tracking record
      await ctx.runMutation(internal.instantly.internal.createCampaignRecord, {
        userId: args.userId,
        searchId: args.searchId,
        instantlyCampaignId: campaignId,
        instantlyCampaignName: campaign.name || campaignName,
        senderEmail: args.senderEmail,
        leadsCount: pushedCount,
        autoPushed: true,
      });

      console.log(
        `Auto-push completed: ${pushedCount} leads pushed to Instantly campaign ${campaignId}`
      );

      return {
        success: true,
        campaignId,
        pushedCount,
        failedCount,
      };
    } catch (error) {
      console.error(`Auto-push error:`, error);
      return {
        success: false,
        reason: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
