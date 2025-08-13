import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TrendingUp, Users, Mail, Target, Clock, Search, Bot } from "lucide-react";
import { useDashboardMetrics } from "@/hooks/useDashboard";
import { useUserLeads } from "@/hooks/useLeads";
import { useSearches } from "@/hooks/useSearches";
import { useCrewAIRequests } from "@/hooks/useCrewAI";
import { useNotifications } from "@/hooks/useNotifications";

export function Dashboard() {
  // Real Convex hooks
  const { leadStats, searchStats, emailStats, isLoading: metricsLoading } = useDashboardMetrics();
  const { stats: userLeadStats } = useUserLeads();
  const { searches } = useSearches();
  const { requests: emailRequests } = useCrewAIRequests();
  const { notifications } = useNotifications();

  // Calculate real stats
  const totalLeads = userLeadStats?.totalLeads || 0;
  const leadsWithEmails = userLeadStats?.withEmails || 0;
  const totalSearches = searches?.length || 0;
  const emailsGenerated = emailRequests?.page?.length || 0;

  const stats = [
    { 
      title: "Total Leads Found", 
      value: totalLeads.toLocaleString(), 
      change: userLeadStats?.thisWeek ? `+${userLeadStats.thisWeek} this week` : "No recent activity", 
      icon: Users 
    },
    { 
      title: "Leads with Emails", 
      value: leadsWithEmails.toLocaleString(), 
      change: `${Math.round((leadsWithEmails / totalLeads) * 100) || 0}% coverage`, 
      icon: Target 
    },
    { 
      title: "Searches Completed", 
      value: totalSearches.toLocaleString(), 
      change: searches?.filter(s => s.status === 'completed').length ? `${searches.filter(s => s.status === 'completed').length} completed` : "No searches yet", 
      icon: Search 
    },
    { 
      title: "AI Emails Generated", 
      value: emailsGenerated.toLocaleString(), 
      change: emailRequests?.page?.filter(r => r.status === 'completed').length ? `${emailRequests.page.filter(r => r.status === 'completed').length} successful` : "None generated", 
      icon: Bot 
    },
  ];

  // Convert notifications to recent activity format
  const recentActivity = notifications?.notifications?.slice(0, 4).map(notification => ({
    action: notification.title,
    time: new Date(notification._creationTime).toLocaleString(),
    count: notification.type
  })) || [];

  return (
    <div className="flex h-screen">
      <div className="flex-1 p-8">
        <div className="max-w-6xl">
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-foreground mb-2">Dashboard</h1>
            <p className="text-muted-foreground">Welcome back! Here's what's happening with your leads.</p>
          </div>

          {/* Loading State */}
          {metricsLoading ? (
            <Alert className="mb-8">
              <Clock className="h-4 w-4 animate-spin" />
              <AlertDescription>
                Loading dashboard metrics...
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {/* Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                {stats.map((stat) => {
                  const Icon = stat.icon;
                  return (
                    <Card key={stat.title} className="p-6 bg-card border-border">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">{stat.title}</p>
                          <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                          <p className="text-sm text-primary">{stat.change}</p>
                        </div>
                        <div className="bg-primary/10 p-3 rounded-lg">
                          <Icon className="h-6 w-6 text-primary" />
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </>
          )}

          {/* Charts & Activity */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Performance Chart */}
            <Card className="p-6 bg-card border-border">
              <h3 className="text-lg font-semibold text-foreground mb-4">Lead Generation Trend</h3>
              <div className="h-64 flex items-center justify-center bg-muted/20 rounded-lg">
                <p className="text-muted-foreground">Chart visualization would go here</p>
              </div>
            </Card>

            {/* Recent Activity */}
            <Card className="p-6 bg-card border-border">
              <h3 className="text-lg font-semibold text-foreground mb-4">Recent Activity</h3>
              <div className="space-y-4">
                {recentActivity.length > 0 ? (
                  recentActivity.map((activity, index) => (
                    <div key={index} className="flex items-center justify-between py-2">
                      <div>
                        <p className="text-sm font-medium text-foreground">{activity.action}</p>
                        <p className="text-xs text-muted-foreground">{activity.time}</p>
                      </div>
                      <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">
                        {activity.count}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground">No recent activity</p>
                    <p className="text-sm text-muted-foreground">Start a search to see your activity here</p>
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* Quick Actions */}
          <Card className="p-6 bg-card border-border mt-6">
            <h3 className="text-lg font-semibold text-foreground mb-4">Quick Actions</h3>
            <div className="flex gap-4">
              <Button className="bg-primary hover:bg-primary/90 text-primary-foreground">
                Start New Search
              </Button>
              <Button variant="outline" className="border-border">
                Create Email Template
              </Button>
              <Button variant="outline" className="border-border">
                Export Leads
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}