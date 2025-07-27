import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, Mail, UserPlus, TrendingUp } from "lucide-react";

const activities = [
  {
    id: 1,
    type: "search",
    icon: Search,
    title: "New lead search completed",
    description: "Found 47 SaaS companies in Austin",
    time: "2 minutes ago",
    status: "success"
  },
  {
    id: 2,
    type: "email",
    icon: Mail,
    title: "Email template updated",
    description: "SaaS Partnership Outreach template",
    time: "15 minutes ago",
    status: "info"
  },
  {
    id: 3,
    type: "lead",
    icon: UserPlus,
    title: "New lead added",
    description: "TechVision AI - John Smith",
    time: "1 hour ago",
    status: "success"
  },
  {
    id: 4,
    type: "analytics",
    icon: TrendingUp,
    title: "Weekly report generated",
    description: "89 new leads this week",
    time: "3 hours ago",
    status: "info"
  }
];

export function ActivityPanel() {
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold">Recent Activity</h3>
      
      <div className="space-y-3">
        {activities.map((activity) => {
          const Icon = activity.icon;
          return (
            <Card key={activity.id} className="glass-card p-4 hover-accent transition-smooth cursor-pointer">
              <div className="flex items-start gap-3">
                <div className={`
                  w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0
                  ${activity.status === 'success' 
                    ? 'bg-primary/10 text-primary' 
                    : 'bg-muted/20 text-muted-foreground'
                  }
                `}>
                  <Icon className="h-4 w-4" />
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm mb-1">{activity.title}</div>
                  <div className="text-xs text-muted-foreground mb-2">{activity.description}</div>
                  <div className="text-xs text-muted-foreground">{activity.time}</div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Quick Stats */}
      <div className="space-y-3 pt-4 border-t border-border">
        <h4 className="text-sm font-medium text-muted-foreground">This Week</h4>
        <div className="grid grid-cols-2 gap-3">
          <div className="text-center">
            <div className="text-lg font-bold text-primary">89</div>
            <div className="text-xs text-muted-foreground">New Leads</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-primary">24%</div>
            <div className="text-xs text-muted-foreground">Open Rate</div>
          </div>
        </div>
      </div>
    </div>
  );
}