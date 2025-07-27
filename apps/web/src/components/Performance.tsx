import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Mail, Users, Target, DollarSign, Calendar, BarChart3 } from "lucide-react";

export function Performance() {
  const metrics = [
    {
      title: "Lead Generation Rate",
      value: "156",
      change: "+23%",
      trend: "up",
      period: "leads/week",
      icon: Users
    },
    {
      title: "Email Open Rate",
      value: "34.2%",
      change: "+5.1%",
      trend: "up",
      period: "last 30 days",
      icon: Mail
    },
    {
      title: "Response Rate",
      value: "12.8%",
      change: "-2.3%",
      trend: "down",
      period: "last 30 days",
      icon: Target
    },
    {
      title: "Conversion Rate",
      value: "2.9%",
      change: "+0.8%",
      trend: "up",
      period: "last 30 days",
      icon: TrendingUp
    },
    {
      title: "Revenue Generated",
      value: "$45,230",
      change: "+18.5%",
      trend: "up",
      period: "this month",
      icon: DollarSign
    },
    {
      title: "Cost Per Lead",
      value: "$12.40",
      change: "-15.2%",
      trend: "up",
      period: "this month",
      icon: BarChart3
    }
  ];

  const recentPerformance = [
    { date: "2024-01-15", leads: 23, emails: 45, responses: 8, conversions: 2 },
    { date: "2024-01-14", leads: 31, emails: 52, responses: 12, conversions: 1 },
    { date: "2024-01-13", leads: 19, emails: 38, responses: 6, conversions: 3 },
    { date: "2024-01-12", leads: 27, emails: 41, responses: 9, conversions: 2 },
    { date: "2024-01-11", leads: 35, emails: 58, responses: 15, conversions: 4 },
  ];

  const topPerformingTemplates = [
    { name: "Partnership Outreach", sent: 234, opens: 89, responses: 23, rate: "9.8%" },
    { name: "SaaS Introduction", sent: 187, opens: 76, responses: 18, rate: "9.6%" },
    { name: "Follow Up", sent: 156, opens: 71, responses: 12, rate: "7.7%" },
  ];

  return (
    <div className="flex h-screen">
      <div className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-6xl">
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-foreground mb-2">Performance</h1>
            <p className="text-muted-foreground">Track your lead generation and email campaign performance.</p>
          </div>

          {/* Key Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
            {metrics.map((metric) => {
              const Icon = metric.icon;
              const isPositive = metric.trend === "up";
              const TrendIcon = isPositive ? TrendingUp : TrendingDown;
              
              return (
                <Card key={metric.title} className="p-6 bg-card border-border">
                  <div className="flex items-center justify-between mb-4">
                    <div className="bg-primary/10 p-3 rounded-lg">
                      <Icon className="h-6 w-6 text-primary" />
                    </div>
                    <div className={`flex items-center gap-1 text-sm ${
                      isPositive ? 'text-green-500' : 'text-red-500'
                    }`}>
                      <TrendIcon className="h-4 w-4" />
                      <span>{metric.change}</span>
                    </div>
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-1">{metric.title}</h3>
                  <div className="text-3xl font-bold text-foreground mb-1">{metric.value}</div>
                  <p className="text-sm text-muted-foreground">{metric.period}</p>
                </Card>
              );
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Daily Performance */}
            <Card className="p-6 bg-card border-border">
              <h3 className="text-lg font-semibold text-foreground mb-4">Daily Performance (Last 5 Days)</h3>
              <div className="space-y-3">
                {recentPerformance.map((day, index) => (
                  <div key={day.date} className="flex items-center justify-between p-3 bg-muted/20 rounded-lg">
                    <div className="flex items-center gap-3">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">
                        {new Date(day.date).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex gap-4 text-sm">
                      <span className="text-muted-foreground">{day.leads} leads</span>
                      <span className="text-muted-foreground">{day.emails} emails</span>
                      <span className="text-muted-foreground">{day.responses} responses</span>
                      <Badge variant="secondary" className="bg-primary/10 text-primary">
                        {day.conversions} conversions
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Top Performing Templates */}
            <Card className="p-6 bg-card border-border">
              <h3 className="text-lg font-semibold text-foreground mb-4">Top Performing Email Templates</h3>
              <div className="space-y-4">
                {topPerformingTemplates.map((template, index) => (
                  <div key={template.name} className="flex items-center justify-between p-3 bg-muted/20 rounded-lg">
                    <div>
                      <div className="font-medium text-foreground">{template.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {template.sent} sent • {template.opens} opens • {template.responses} responses
                      </div>
                    </div>
                    <Badge variant="secondary" className="bg-primary/10 text-primary">
                      {template.rate}
                    </Badge>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Performance Chart Placeholder */}
          <Card className="p-6 bg-card border-border">
            <h3 className="text-lg font-semibold text-foreground mb-4">Performance Trends</h3>
            <div className="h-64 flex items-center justify-center bg-muted/20 rounded-lg">
              <div className="text-center">
                <BarChart3 className="h-12 w-12 text-muted-foreground mx-auto mb-2" />
                <p className="text-muted-foreground">Interactive performance charts would be displayed here</p>
                <p className="text-sm text-muted-foreground mt-1">Showing trends for leads, emails, responses, and conversions</p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}