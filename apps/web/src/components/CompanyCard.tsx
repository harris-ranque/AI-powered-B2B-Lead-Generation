import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CircularProgress } from "./CircularProgress";
import { Badge } from "@/components/ui/badge";
import { Send, Eye, Mail } from "lucide-react";

interface CompanyCardProps {
  company: {
    id: string;
    name: string;
    description: string;
    score: number;
    logo: string;
    tags: string[];
    quickScore?: string;
  };
}

export function CompanyCard({ company }: CompanyCardProps) {
  return (
    <Card className="bg-card border border-border p-6 hover:border-primary/30 transition-smooth">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center border border-primary/20">
            <span className="text-primary font-bold text-lg">
              {company.logo}
            </span>
          </div>
          <div>
            <h3 className="text-lg font-bold text-card-foreground mb-1">
              {company.name}
            </h3>
            <p className="text-sm text-muted-foreground">
              {company.description}
            </p>
          </div>
        </div>
        <CircularProgress value={company.score} size={50} />
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {company.tags.map((tag, index) => (
          <Badge
            key={index}
            variant="secondary"
            className="bg-secondary/50 text-secondary-foreground text-xs"
          >
            {tag}
          </Badge>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm">
          <span className="text-muted-foreground">Score: </span>
          <span className="text-card-foreground font-bold">
            {company.quickScore || `${company.score}%`}
          </span>
        </div>

        <div className="flex gap-2">
          {company.score > 70 && (
            <Button
              size="sm"
              className="bg-primary hover:bg-primary/90 text-primary-foreground gap-1"
            >
              <Mail className="h-3 w-3" />
              GENERATE EMAIL
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-1">
            <Eye className="h-3 w-3" />
            VIEW DETAILS
          </Button>
          {company.score > 50 && (
            <Button variant="outline" size="sm" className="gap-1">
              <Send className="h-3 w-3" />
              SEND
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
