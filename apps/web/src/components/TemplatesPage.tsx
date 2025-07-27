import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Users, Zap } from "lucide-react";

const templates = [
  {
    id: 1,
    name: "SaaS Partnership Outreach",
    description: "Perfect for reaching out to SaaS companies for potential partnerships and collaborations.",
    openRate: "24%",
    responseRate: "8%",
    category: "Partnership"
  },
  {
    id: 2,
    name: "Agency Service Proposal",
    description: "Tailored template for marketing agencies offering specialized services to prospects.",
    openRate: "31%",
    responseRate: "12%",
    category: "Services"
  },
  {
    id: 3,
    name: "Tech Startup Introduction",
    description: "Engaging introduction template specifically designed for tech startup outreach.",
    openRate: "28%",
    responseRate: "9%",
    category: "Introduction"
  },
  {
    id: 4,
    name: "Follow-up Sequence",
    description: "Professional follow-up template for nurturing leads that haven't responded yet.",
    openRate: "19%",
    responseRate: "6%",
    category: "Follow-up"
  }
];

export function TemplatesPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Email Templates</h1>
        <p className="text-muted-foreground text-lg">
          High-converting email templates for your outreach campaigns
        </p>
      </div>

      {/* Templates Grid */}
      <div className="space-y-4">
        {templates.map((template) => (
          <Card key={template.id} className="glass-card p-5 hover-scale transition-smooth cursor-pointer hover-accent">
            <div className="flex justify-between items-start mb-3">
              <div>
                <h3 className="font-semibold text-base mb-2">{template.name}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {template.description}
                </p>
              </div>
              <Badge variant="secondary" className="text-xs">
                {template.category}
              </Badge>
            </div>

            <div className="flex items-center gap-6 mb-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                <span>Open Rate: {template.openRate}</span>
              </div>
              <div className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                <span>Response: {template.responseRate}</span>
              </div>
              <div className="flex items-center gap-1">
                <Zap className="h-3 w-3" />
                <span>High Converting</span>
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="secondary" size="sm">
                Preview
              </Button>
              <Button variant="secondary" size="sm">
                Use Template
              </Button>
              <Button variant="secondary" size="sm">
                Edit
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {/* Create New Template */}
      <Card className="glass-card p-8 text-center border-dashed border-2 hover-accent transition-smooth cursor-pointer">
        <div className="space-y-4">
          <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mx-auto">
            <span className="text-2xl">+</span>
          </div>
          <div>
            <h3 className="font-semibold mb-2">Create New Template</h3>
            <p className="text-sm text-muted-foreground">
              Build a custom email template from scratch
            </p>
          </div>
          <Button className="gradient-primary">
            Get Started
          </Button>
        </div>
      </Card>
    </div>
  );
}