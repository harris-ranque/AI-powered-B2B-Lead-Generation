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
    title: "Discover Leads",
    description: "Find potential customers and prospects",
    icon: "Search",
    estimatedTime: "2-5 min",
    requiresCredits: true,
    dependencies: ["source_selection"],
  },
  enrichment: {
    id: "enrichment",
    title: "Enrich Data",
    description: "Find contact emails and additional information",
    icon: "Mail",
    estimatedTime: "3-8 min",
    requiresCredits: true,
    dependencies: ["lead_discovery"],
  },
  ai_personalization: {
    id: "ai_personalization",
    title: "AI Personalization",
    description: "Analyze leads and generate personalized email sequences",
    icon: "Sparkles",
    estimatedTime: "5-10 min",
    requiresCredits: true,
    dependencies: ["enrichment"],
  },
  review_export: {
    id: "review_export",
    title: "Review & Export",
    description: "Review results and download your leads",
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
