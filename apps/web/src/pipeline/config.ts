import type { StageConfig, PipelineStage } from "./types";

export const STAGE_CONFIGS: Record<PipelineStage, StageConfig> = {
  source_selection: {
    id: "source_selection",
    title: "Choose Data Source",
    description: "Select how you want to find leads",
    icon: "Database",
    estimatedTime: "1 min",
    requiresCredits: false,
  },
  lead_discovery: {
    id: "lead_discovery",
    title: "Find Businesses",
    description: "Discover local businesses matching your search",
    icon: "Search",
    estimatedTime: "2-5 min",
    requiresCredits: true,
    dependencies: ["source_selection"],
  },
  enrichment: {
    id: "enrichment",
    title: "Get Email Addresses",
    description: "Find decision-maker emails for each business",
    icon: "Mail",
    estimatedTime: "3-8 min",
    requiresCredits: true,
    dependencies: ["lead_discovery"],
  },
  ai_personalization: {
    id: "ai_personalization",
    title: "Write Emails",
    description: "AI writes personalized emails for each contact",
    icon: "Sparkles",
    estimatedTime: "5-10 min",
    requiresCredits: true,
    dependencies: ["enrichment"],
  },
  review_export: {
    id: "review_export",
    title: "Download Results",
    description: "Export your leads with personalized emails",
    icon: "Download",
    estimatedTime: "1 min",
    requiresCredits: false,
    dependencies: ["ai_personalization"],
  },
};

export const STAGE_ORDER: PipelineStage[] = [
  "source_selection",
  "lead_discovery",
  "enrichment",
  "ai_personalization",
  "review_export",
];
