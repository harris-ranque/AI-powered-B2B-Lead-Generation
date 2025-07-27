import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Calendar, MapPin, Building, Users, Download, Repeat } from "lucide-react";

export function SearchHistory() {
  const searchHistory = [
    {
      id: 1,
      query: "SaaS companies in San Francisco",
      date: "2024-01-15",
      results: 89,
      location: "San Francisco, CA",
      industry: "Software & Technology",
      status: "completed"
    },
    {
      id: 2,
      query: "Marketing agencies in Austin",
      date: "2024-01-14",
      results: 156,
      location: "Austin, TX",
      industry: "Marketing & Advertising",
      status: "completed"
    },
    {
      id: 3,
      query: "Healthcare startups NYC",
      date: "2024-01-13",
      results: 67,
      location: "New York, NY",
      industry: "Healthcare",
      status: "completed"
    },
    {
      id: 4,
      query: "E-commerce companies Los Angeles",
      date: "2024-01-12",
      results: 234,
      location: "Los Angeles, CA",
      industry: "E-commerce",
      status: "completed"
    },
    {
      id: 5,
      query: "FinTech companies",
      date: "2024-01-11",
      results: 0,
      location: "Remote",
      industry: "Financial Services",
      status: "failed"
    }
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-green-500/10 text-green-500";
      case "failed":
        return "bg-red-500/10 text-red-500";
      default:
        return "bg-primary/10 text-primary";
    }
  };

  return (
    <div className="flex h-screen">
      <div className="flex-1 p-8">
        <div className="max-w-6xl">
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-foreground mb-2">Search History</h1>
            <p className="text-muted-foreground">View and manage your previous lead searches.</p>
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <Card className="p-4 bg-card border-border">
              <div className="flex items-center gap-3">
                <div className="bg-primary/10 p-2 rounded-lg">
                  <Search className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-foreground">47</div>
                  <div className="text-sm text-muted-foreground">Total Searches</div>
                </div>
              </div>
            </Card>
            
            <Card className="p-4 bg-card border-border">
              <div className="flex items-center gap-3">
                <div className="bg-primary/10 p-2 rounded-lg">
                  <Users className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-foreground">2,847</div>
                  <div className="text-sm text-muted-foreground">Leads Found</div>
                </div>
              </div>
            </Card>
            
            <Card className="p-4 bg-card border-border">
              <div className="flex items-center gap-3">
                <div className="bg-primary/10 p-2 rounded-lg">
                  <Calendar className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-foreground">12</div>
                  <div className="text-sm text-muted-foreground">This Month</div>
                </div>
              </div>
            </Card>
            
            <Card className="p-4 bg-card border-border">
              <div className="flex items-center gap-3">
                <div className="bg-primary/10 p-2 rounded-lg">
                  <Building className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-foreground">8</div>
                  <div className="text-sm text-muted-foreground">Industries</div>
                </div>
              </div>
            </Card>
          </div>

          {/* Search History List */}
          <div className="space-y-4">
            {searchHistory.map((search) => (
              <Card key={search.id} className="p-6 bg-card border-border hover:border-primary/30 transition-colors">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-3">
                      <h3 className="text-lg font-medium text-foreground">{search.query}</h3>
                      <Badge className={`${getStatusColor(search.status)} border-0`}>
                        {search.status}
                      </Badge>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4" />
                        <span>{new Date(search.date).toLocaleDateString()}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4" />
                        <span>{search.location}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Building className="h-4 w-4" />
                        <span>{search.industry}</span>
                      </div>
                    </div>
                    
                    <div className="mt-3">
                      <span className="text-sm font-medium text-primary">
                        {search.results} leads found
                      </span>
                    </div>
                  </div>
                  
                  <div className="flex gap-2 ml-4">
                    {search.status === "completed" && (
                      <>
                        <Button size="sm" variant="outline" className="border-border">
                          <Download className="h-4 w-4 mr-1" />
                          Export
                        </Button>
                        <Button size="sm" variant="outline" className="border-border">
                          <Repeat className="h-4 w-4 mr-1" />
                          Re-run
                        </Button>
                      </>
                    )}
                    {search.status === "failed" && (
                      <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground">
                        <Repeat className="h-4 w-4 mr-1" />
                        Retry
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}