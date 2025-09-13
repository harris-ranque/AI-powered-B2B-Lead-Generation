import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DollarSign,
  Users,
  TrendingUp,
  CreditCard,
  AlertCircle,
  Download,
  RefreshCw,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { convex } from "@/lib/convex";

export function AdminBillingDashboard() {
  const {
    data: billingMetrics,
    isLoading: metricsLoading,
    refetch: refetchMetrics,
  } = useQuery({
    queryKey: ["admin-billing-metrics"],
    queryFn: async () => {
      const result = await convex.query("admin/billing:getBillingMetrics", {});
      return result;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const { data: revenueAnalytics, isLoading: revenueLoading } = useQuery({
    queryKey: ["admin-revenue-analytics"],
    queryFn: async () => {
      const result = await convex.query(
        "admin/billing:getRevenueAnalytics",
        {},
      );
      return result;
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: costAnalytics, isLoading: costLoading } = useQuery({
    queryKey: ["admin-cost-analytics"],
    queryFn: async () => {
      const result = await convex.query("admin/billing:getCostAnalytics", {});
      return result;
    },
    staleTime: 5 * 60 * 1000,
  });

  if (metricsLoading || revenueLoading || costLoading) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 mb-6">
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span>Loading billing analytics...</span>
        </div>
      </div>
    );
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Billing & Revenue Dashboard</h2>
          <p className="text-muted-foreground">
            Subscription management, revenue tracking, and cost analytics
          </p>
        </div>
        <Button onClick={() => refetchMetrics()} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Monthly Recurring Revenue
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {billingMetrics
                ? formatCurrency(billingMetrics.revenue.totalMRR)
                : "..."}
            </div>
            <p className="text-xs text-muted-foreground">
              {revenueAnalytics
                ? formatCurrency(revenueAnalytics.currentARR)
                : "..."}{" "}
              ARR
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Active Subscriptions
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {billingMetrics?.subscriptions.total || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              {billingMetrics
                ? `${billingMetrics.growth.newSubscriptions7d} new this week`
                : "Loading..."}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Churn Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {billingMetrics?.subscriptions.churnRate || 0}%
            </div>
            <p className="text-xs text-muted-foreground">
              {billingMetrics
                ? `${billingMetrics.subscriptions.cancelations} total canceled`
                : "Loading..."}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Credit Utilization
            </CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {costAnalytics?.creditUtilization || 0}%
            </div>
            <p className="text-xs text-muted-foreground">
              {costAnalytics
                ? `${formatCurrency(costAnalytics.totalCosts)} total costs`
                : "Loading..."}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Plan Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Plan Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {billingMetrics &&
                Object.entries(billingMetrics.subscriptions.planCounts).map(
                  ([plan, count]) => {
                    const planMRR =
                      revenueAnalytics?.mrrByPlan.find((p) => p.plan === plan)
                        ?.mrr || 0;
                    return (
                      <div
                        key={plan}
                        className="flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="capitalize">
                            {plan}
                          </Badge>
                          <span className="text-sm text-muted-foreground">
                            {count} subscribers
                          </span>
                        </div>
                        <span className="font-medium">
                          {formatCurrency(planMRR)}/mo
                        </span>
                      </div>
                    );
                  },
                )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Usage by Plan</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {costAnalytics?.usageByPlan.map((planData) => (
                <div
                  key={planData.plan}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="capitalize">
                      {planData.plan}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {planData.users} users
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="font-medium">
                      {formatCurrency(planData.usage)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatCurrency(planData.avgUsagePerUser)} avg/user
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Growth */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Revenue Growth (Last 12 Months)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {revenueAnalytics?.monthlyRevenue.slice(-6).map((month) => (
              <div
                key={month.month}
                className="text-center p-3 bg-muted/50 rounded-lg"
              >
                <div className="text-sm text-muted-foreground mb-1">
                  {new Date(month.month + "-01").toLocaleDateString("en-US", {
                    month: "short",
                  })}
                </div>
                <div className="font-semibold">
                  {formatCurrency(month.revenue)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {month.subscriptions} subs
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Cost Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            Cost Analytics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-medium mb-3">Costs by Operation</h4>
              <div className="space-y-2">
                {costAnalytics?.costsByOperation.slice(0, 5).map((cost) => (
                  <div key={cost.operation} className="flex justify-between">
                    <span className="text-sm text-muted-foreground">
                      {cost.operation}
                    </span>
                    <span className="font-medium">
                      {formatCurrency(cost.cost)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  Total Credits Issued
                </span>
                <span className="font-medium">
                  {formatCurrency(costAnalytics?.totalCreditsIssued || 0)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  Total Credits Used
                </span>
                <span className="font-medium">
                  {formatCurrency(costAnalytics?.totalCreditsUsed || 0)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  Recent Costs (30d)
                </span>
                <span className="font-medium">
                  {formatCurrency(costAnalytics?.recentCosts || 0)}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Admin Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 flex-wrap">
            <Button variant="outline">
              <Users className="h-4 w-4 mr-2" />
              Manage Subscriptions
            </Button>
            <Button variant="outline">
              <Download className="h-4 w-4 mr-2" />
              Export Revenue Data
            </Button>
            <Button variant="outline">
              <CreditCard className="h-4 w-4 mr-2" />
              Credit Management
            </Button>
            <Button variant="outline">
              <AlertCircle className="h-4 w-4 mr-2" />
              Failed Payments
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
