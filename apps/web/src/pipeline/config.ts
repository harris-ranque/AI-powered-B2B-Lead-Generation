import type { StageConfig, PipelineStage } from './types';

export const STAGE_CONFIGS: Record<PipelineStage, StageConfig> = {
  source_selection: {
    id: 'source_selection',
    title: 'Choose Data Source',
    description: 'Select how you want to find leads',
    icon: 'Database',
    estimatedTime: '1 min',
    requiresCredits: false,
  },
  lead_discovery: {
    id: 'lead_discovery',
    title: 'Discover Leads',
    description: 'Find potential customers and prospects',
    icon: 'Search',
    estimatedTime: '2-5 min',
    requiresCredits: true,
    dependencies: ['source_selection'],
  },
  enrichment: {
    id: 'enrichment',
    title: 'Enrich Data',
    description: 'Find contact emails and additional information',
    icon: 'Mail',
    estimatedTime: '3-8 min',
    requiresCredits: true,
    dependencies: ['lead_discovery'],
  },
  ai_analysis: {
    id: 'ai_analysis',
    title: 'AI Analysis',
    description: 'Analyze leads for relevance and pain points',
    icon: 'Bot',
    estimatedTime: '5-10 min',
    requiresCredits: true,
    dependencies: ['enrichment'],
  },
  email_generation: {
    id: 'email_generation',
    title: 'Generate Emails',
    description: 'Create personalized email sequences',
    icon: 'PenTool',
    estimatedTime: '2-5 min',
    requiresCredits: true,
    dependencies: ['ai_analysis'],
  },
  review_export: {
    id: 'review_export',
    title: 'Review & Export',
    description: 'Review results and download your leads',
    icon: 'Download',
    estimatedTime: '1 min',
    requiresCredits: false,
    dependencies: ['email_generation'],
  },
};

export const STAGE_ORDER: PipelineStage[] = [
  'source_selection',
  'lead_discovery',
  'enrichment',
  'ai_analysis', 
  'email_generation',
  'review_export',
];