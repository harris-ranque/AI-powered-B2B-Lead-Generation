import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Building,
  Target,
  Briefcase,
  TrendingUp,
  Users,
  AlertTriangle,
  Code,
  Trophy,
  Calendar,
  ExternalLink,
  CheckCircle,
  Search,
} from "lucide-react";

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
}

interface BusinessContextDisplayProps {
  businessContext: BusinessContext;
  companyName: string;
  website?: string;
  className?: string;
}

export function BusinessContextDisplay({
  businessContext,
  companyName,
  website,
  className = "",
}: BusinessContextDisplayProps) {
  const confidenceColor =
    businessContext.confidence_score >= 0.8
      ? "text-green-600"
      : businessContext.confidence_score >= 0.6
        ? "text-yellow-600"
        : "text-red-600";

  const confidenceLabel =
    businessContext.confidence_score >= 0.8
      ? "High"
      : businessContext.confidence_score >= 0.6
        ? "Medium"
        : "Low";

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header with Company Overview */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building className="h-5 w-5" />
            Business Intelligence: {companyName}
            <Badge variant="outline" className={`ml-auto ${confidenceColor}`}>
              <CheckCircle className="h-3 w-3 mr-1" />
              {confidenceLabel} Confidence (
              {(businessContext.confidence_score * 100).toFixed(0)}%)
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h4 className="font-semibold text-sm text-muted-foreground mb-2">
              Company Overview
            </h4>
            <p className="text-sm leading-relaxed">
              {businessContext.company_overview}
            </p>
          </div>

          {website && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ExternalLink className="h-3 w-3" />
              <a
                href={website}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary"
              >
                {website}
              </a>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Target className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold text-sm">Industry Focus</span>
              </div>
              <p className="text-sm">{businessContext.industry_focus}</p>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold text-sm">Growth Stage</span>
              </div>
              <p className="text-sm">{businessContext.growth_stage}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Business Model & Services */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Briefcase className="h-4 w-4" />
              Business Model
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{businessContext.business_model}</p>

            <Separator className="my-3" />

            <div>
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-3 w-3 text-muted-foreground" />
                <span className="font-semibold text-xs">Target Customers</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {businessContext.target_customers}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-base">Key Services</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {businessContext.key_services.map((service, index) => (
                <Badge key={index} variant="secondary" className="text-xs">
                  {service}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pain Points & Technology */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
              Potential Pain Points
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {businessContext.pain_points.map((pain, index) => (
                <div key={index} className="flex items-start gap-2">
                  <div className="w-1 h-1 rounded-full bg-yellow-600 mt-2 flex-shrink-0" />
                  <span className="text-sm">{pain}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Code className="h-4 w-4" />
              Technology Stack
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {businessContext.technology_stack.map((tech, index) => (
                <Badge key={index} variant="outline" className="text-xs">
                  {tech}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Competitive Landscape & Recent News */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Trophy className="h-4 w-4" />
              Competitive Landscape
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{businessContext.competitive_landscape}</p>
          </CardContent>
        </Card>

        {businessContext.recent_news.length > 0 && (
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Recent Developments
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {businessContext.recent_news.slice(0, 3).map((news, index) => (
                  <div key={index} className="flex items-start gap-2">
                    <div className="w-1 h-1 rounded-full bg-blue-600 mt-2 flex-shrink-0" />
                    <span className="text-sm">{news}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Research Metadata */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4" />
            Research Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-3 gap-4 text-sm">
            <div>
              <div className="font-semibold text-muted-foreground mb-1">
                Confidence Score
              </div>
              <div className="flex items-center gap-2">
                <Progress
                  value={businessContext.confidence_score * 100}
                  className="h-2 flex-1"
                />
                <span className={`text-sm ${confidenceColor}`}>
                  {(businessContext.confidence_score * 100).toFixed(0)}%
                </span>
              </div>
            </div>

            <div>
              <div className="font-semibold text-muted-foreground mb-1">
                Data Sources
              </div>
              <div className="text-xs">
                {businessContext.data_sources.length} sources analyzed
              </div>
            </div>

            {businessContext.research_metadata?.research_time && (
              <div>
                <div className="font-semibold text-muted-foreground mb-1">
                  Research Time
                </div>
                <div className="text-xs">
                  {businessContext.research_metadata.research_time.toFixed(1)}s
                </div>
              </div>
            )}
          </div>

          {businessContext.data_sources.length > 0 && (
            <div className="mt-3">
              <div className="font-semibold text-muted-foreground mb-2 text-xs">
                Sources
              </div>
              <div className="flex flex-wrap gap-1">
                {businessContext.data_sources
                  .slice(0, 3)
                  .map((source, index) => (
                    <Badge key={index} variant="outline" className="text-xs">
                      {source.includes("http")
                        ? new URL(source).hostname
                        : source}
                    </Badge>
                  ))}
                {businessContext.data_sources.length > 3 && (
                  <Badge variant="outline" className="text-xs">
                    +{businessContext.data_sources.length - 3} more
                  </Badge>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
