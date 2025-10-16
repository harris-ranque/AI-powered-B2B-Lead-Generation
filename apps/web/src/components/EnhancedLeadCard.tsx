import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Building,
  Globe,
  Phone,
  Mail,
  Users,
  MapPin,
  Sparkles,
  Brain,
  Search,
  Zap,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Bot,
  Microscope,
  TrendingUp,
} from "lucide-react";
import { BusinessContextDisplay } from "./BusinessContextDisplay";
import type { Lead } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface BusinessContext {
  company_overview: string;
  industry_focus: string;
  business_model: string;
  key_services: string[];
  target_customers: string;
  pain_points: string[];
  technology_stack: string[];
  competitive_landscape: string;
  growth_stage: string;
  recent_news: string[];
  confidence_score: number;
  data_sources: string[];
  research_metadata?: {
    research_time: number;
    website_data?: {
      title: string;
      description: string;
      url: string;
    };
  };
  // Enhanced research fields
  competitors?: Array<Record<string, unknown>>;
  industry_insights?: string;
  research_tier?: "tavily" | "exa" | "perplexity";
  escalation_reason?: string;
  sources_analyzed?: number;
  comprehensive_report?: string;
}

interface EnhancedLeadCardProps {
  lead: Lead;
  businessContext?: BusinessContext;
  onGenerateEmail?: (lead: Lead) => void;
  className?: string;
  showFullContext?: boolean;
}

export function EnhancedLeadCard({
  lead,
  businessContext,
  onGenerateEmail,
  className,
  showFullContext = false,
}: EnhancedLeadCardProps) {
  const [isExpanded, setIsExpanded] = useState(showFullContext);

  // Get research tier display info
  const getResearchTierInfo = (tier?: string) => {
    switch (tier) {
      case "tavily":
        return {
          label: "Standard Research",
          icon: Search,
          color: "text-blue-500",
          bg: "bg-blue-50",
          description: "Fast business context",
          variant: "secondary" as const,
        };
      case "exa":
        return {
          label: "Enhanced Research",
          icon: Microscope,
          color: "text-purple-500",
          bg: "bg-purple-50",
          description: "Deep competitor analysis",
          variant: "outline" as const,
        };
      case "perplexity":
        return {
          label: "Premium Research",
          icon: Zap,
          color: "text-amber-600",
          bg: "bg-amber-50",
          description: "Comprehensive report",
          variant: "default" as const,
        };
      default:
        return null;
    }
  };

  const researchTierInfo = getResearchTierInfo(businessContext?.research_tier);
  const ResearchTierIcon = researchTierInfo?.icon;

  return (
    <Card
      className={cn("hover:shadow-md transition-all duration-200", className)}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1 flex-1">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Building className="h-5 w-5 text-muted-foreground" />
              {lead.company_name}
              {businessContext && (
                <Badge
                  variant={researchTierInfo?.variant || "secondary"}
                  className={cn("ml-2", researchTierInfo?.bg)}
                >
                  {ResearchTierIcon && (
                    <ResearchTierIcon className="w-3 h-3 mr-1" />
                  )}
                  AI Research
                </Badge>
              )}
            </CardTitle>

            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              {lead.industry && (
                <span className="flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {lead.industry}
                </span>
              )}
              {lead.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {lead.location}
                </span>
              )}
            </div>
          </div>

          {businessContext?.confidence_score && (
            <div className="text-right">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="h-4 w-4 text-amber-500" />
                <span className="text-sm font-medium">
                  {Math.round(businessContext.confidence_score * 100)}%
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                Research Quality
              </div>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Contact Information */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {lead.website && (
            <div className="flex items-center gap-2 text-sm">
              <Globe className="h-4 w-4 text-muted-foreground" />
              <a
                href={lead.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline truncate"
              >
                {lead.website.replace(/^https?:\/\//, "")}
              </a>
              <ExternalLink className="h-3 w-3 text-muted-foreground" />
            </div>
          )}

          {lead.contact_info?.phone && (
            <div className="flex items-center gap-2 text-sm">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span>{lead.contact_info.phone}</span>
            </div>
          )}

          {lead.contact_info?.email && (
            <div className="flex items-center gap-2 text-sm">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span className="truncate">{lead.contact_info.email}</span>
            </div>
          )}
        </div>

        {/* Business Context Preview */}
        {businessContext && (
          <div className="space-y-3">
            <Separator />

            {/* Research Tier Info */}
            {researchTierInfo && (
              <div className={cn("p-3 rounded-lg", researchTierInfo.bg)}>
                <div className="flex items-center gap-2 mb-2">
                  <ResearchTierIcon
                    className={cn("h-4 w-4", researchTierInfo.color)}
                  />
                  <span className="font-medium text-sm">
                    {researchTierInfo.label}
                  </span>
                  {businessContext.sources_analyzed && (
                    <Badge variant="outline" className="text-xs ml-auto">
                      {businessContext.sources_analyzed} sources
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {researchTierInfo.description}
                  {businessContext.escalation_reason && (
                    <span className="ml-1 font-medium">
                      • Escalated: {businessContext.escalation_reason}
                    </span>
                  )}
                </p>
              </div>
            )}

            {/* Business Overview */}
            <div className="space-y-2">
              <h4 className="font-medium text-sm flex items-center gap-2">
                <Brain className="h-4 w-4 text-purple-500" />
                Business Intelligence
              </h4>
              <p className="text-sm text-muted-foreground line-clamp-2">
                {businessContext.company_overview}
              </p>
            </div>

            {/* Key Services */}
            {businessContext.key_services?.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {businessContext.key_services
                  .slice(0, 3)
                  .map((service, index) => (
                    <Badge key={index} variant="outline" className="text-xs">
                      {service}
                    </Badge>
                  ))}
                {businessContext.key_services.length > 3 && (
                  <Badge variant="outline" className="text-xs">
                    +{businessContext.key_services.length - 3} more
                  </Badge>
                )}
              </div>
            )}

            {/* Competitors Preview */}
            {businessContext.competitors &&
              businessContext.competitors.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-medium text-sm flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-orange-500" />
                    Discovered Competitors
                  </h4>
                  <div className="flex flex-wrap gap-1">
                    {businessContext.competitors
                      .slice(0, 3)
                      .map((competitor, index) => (
                        <Badge
                          key={index}
                          variant="outline"
                          className="text-xs"
                        >
                          {(competitor.name as string) ||
                            (competitor.title as string) ||
                            `Competitor ${index + 1}`}
                        </Badge>
                      ))}
                    {businessContext.competitors.length > 3 && (
                      <Badge variant="outline" className="text-xs">
                        +{businessContext.competitors.length - 3} more
                      </Badge>
                    )}
                  </div>
                </div>
              )}

            {/* Expand/Collapse Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="w-full"
            >
              {isExpanded ? (
                <>
                  Hide Details <ChevronUp className="ml-2 h-4 w-4" />
                </>
              ) : (
                <>
                  Show Full Analysis <ChevronDown className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        )}

        {/* Expanded Business Context */}
        {isExpanded && businessContext && (
          <div className="space-y-4 pt-4 border-t">
            <BusinessContextDisplay
              businessContext={businessContext}
              companyName={lead.company_name}
              website={lead.website}
              className="border-none p-0"
            />
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2 pt-4 border-t">
          {onGenerateEmail && (
            <Button onClick={() => onGenerateEmail(lead)} className="flex-1">
              <Bot className="h-4 w-4 mr-2" />
              Generate Email
            </Button>
          )}

          {lead.website && (
            <Button variant="outline" asChild>
              <a href={lead.website} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" />
                Visit Site
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
