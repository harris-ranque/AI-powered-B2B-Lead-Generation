import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Clock, Mail, Eye, ExternalLink } from "lucide-react";
import { useUserLeads } from "@/hooks/useLeads";
import { useToast } from "@/hooks/use-toast";

export function LeadsPage() {
  const { leads, stats, isLoading } = useUserLeads();
  const { toast } = useToast();

  const handleCopyEmail = async (email: string) => {
    try {
      await navigator.clipboard.writeText(email);
      toast({
        title: "Email Copied",
        description: "Email address has been copied to clipboard.",
      });
    } catch (error) {
      toast({
        title: "Copy Failed",
        description: "Failed to copy email address.",
        variant: "destructive",
      });
    }
  };

  const handleViewWebsite = (website: string) => {
    if (website) {
      const url = website.startsWith('http') ? website : `https://${website}`;
      window.open(url, '_blank');
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">All Leads</h1>
        <p className="text-muted-foreground text-lg">
          Manage and view all your generated leads
        </p>
      </div>

      {/* Loading State */}
      {isLoading ? (
        <Alert>
          <Clock className="h-4 w-4 animate-spin" />
          <AlertDescription>
            Loading your leads...
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="glass-card p-6 text-center hover-scale transition-smooth">
              <div className="text-3xl font-bold text-primary mb-1">{stats?.totalLeads || 0}</div>
              <div className="text-sm text-muted-foreground">Total Leads</div>
            </Card>
            <Card className="glass-card p-6 text-center hover-scale transition-smooth">
              <div className="text-3xl font-bold text-primary mb-1">{stats?.withEmails || 0}</div>
              <div className="text-sm text-muted-foreground">With Emails</div>
            </Card>
            <Card className="glass-card p-6 text-center hover-scale transition-smooth">
              <div className="text-3xl font-bold text-primary mb-1">{stats?.thisWeek || 0}</div>
              <div className="text-sm text-muted-foreground">New This Week</div>
            </Card>
          </div>
        </>
      )}

      {/* Leads List */}
      {!isLoading && (
        <div className="space-y-4">
          {leads && leads.length > 0 ? (
            leads.map((lead) => (
              <Card key={lead._id} className="glass-card p-5 hover-slide transition-smooth cursor-pointer hover-accent">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="font-semibold text-base mb-1">{lead.contactName || 'No Contact Name'}</h3>
                    <p className="text-sm text-muted-foreground">{lead.companyName}</p>
                    <p className="text-xs text-muted-foreground">
                      {lead.title && `${lead.title} • `}{lead.location}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Badge 
                      variant={lead.status === 'new' ? 'default' : lead.status === 'contacted' ? 'secondary' : 'outline'}
                      className="capitalize"
                    >
                      {lead.status}
                    </Badge>
                    {lead.enrichmentScore && (
                      <Badge className="bg-primary/10 text-primary border border-primary/20 font-semibold">
                        {Math.round(lead.enrichmentScore * 100)}% Match
                      </Badge>
                    )}
                  </div>
                </div>
                
                {lead.description && (
                  <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                    {lead.description}
                  </p>
                )}

                <div className="flex gap-2 flex-wrap">
                  <Button variant="secondary" size="sm" className="transition-smooth">
                    <Eye className="h-3 w-3 mr-1" />
                    View Details
                  </Button>
                  {lead.email && (
                    <Button 
                      variant="secondary" 
                      size="sm" 
                      className="transition-smooth"
                      onClick={() => handleCopyEmail(lead.email!)}
                    >
                      <Mail className="h-3 w-3 mr-1" />
                      Copy Email
                    </Button>
                  )}
                  {lead.website && (
                    <Button 
                      variant="secondary" 
                      size="sm" 
                      className="transition-smooth"
                      onClick={() => handleViewWebsite(lead.website!)}
                    >
                      <ExternalLink className="h-3 w-3 mr-1" />
                      Website
                    </Button>
                  )}
                </div>

                {/* Company Info */}
                {(lead.industry || lead.companySize || lead.technologies?.length) && (
                  <div className="mt-3 p-3 bg-muted/5 border border-border/50 rounded-lg">
                    <div className="flex flex-wrap gap-2 text-xs">
                      {lead.industry && (
                        <Badge variant="outline">{lead.industry}</Badge>
                      )}
                      {lead.companySize && (
                        <Badge variant="outline">{lead.companySize}</Badge>
                      )}
                      {lead.technologies?.map((tech) => (
                        <Badge key={tech} variant="outline">{tech}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            ))
          ) : (
            <Alert>
              <AlertDescription>
                No leads found. Start a search to discover new leads for your business.
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}
    </div>
  );
}