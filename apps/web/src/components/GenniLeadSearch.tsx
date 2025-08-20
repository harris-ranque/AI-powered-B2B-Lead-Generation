import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CircularProgress } from "./CircularProgress";
import { Play, Download, Bot, Mail, Clock, AlertCircle } from "lucide-react";
import type { Lead } from "@/lib/api-client";
import type { Id } from "@genni/convex-types/dataModel";
import { useLeads } from "@/hooks/useLeads";
import { useProfile } from "@/hooks/useProfile";
import { useLogger } from "@/utils/logger";

interface LeadSearchProps {
  searchId?: Id<"searches"> | null;
  onGenerateEmail?: (lead: Lead) => void;
}

export function GenniLeadSearch({ searchId, onGenerateEmail }: LeadSearchProps) {
  const logger = useLogger('GenniLeadSearch');
  
  // Real Convex hooks
  const { leads, isLoading } = useLeads(searchId || undefined);
  const { profile } = useProfile();

  useEffect(() => {
    logger.componentMount('GenniLeadSearch');
    logger.info('Lead search component initialized', { 
      searchId,
      hasProfile: !!profile 
    });
    
    return () => {
      logger.componentUnmount('GenniLeadSearch');
    };
  }, []);

  useEffect(() => {
    if (leads) {
      logger.info('Leads data updated', {
        searchId,
        leadCount: leads.length,
        statuses: leads.reduce((acc, lead) => {
          acc[lead.status] = (acc[lead.status] || 0) + 1;
          return acc;
        }, {} as Record<string, number>)
      });
    }
  }, [leads, searchId]);

  // Convert Convex leads to expected Lead format
  const searchResults = leads?.map(lead => ({
    id: lead._id,
    company_name: lead.businessName || '',
    contact_name: lead.contactInfo?.contacts?.[0]?.name || '',
    title: lead.contactInfo?.contacts?.[0]?.title || '',
    industry: lead.category || '',
    company_size: '', // Not available in current schema
    location: lead.location?.formattedAddress || lead.address || '',
    description: lead.description || '',
    website: lead.website || '',
    contact_info: {
      email: lead.contactInfo?.emails?.[0]?.email || '',
      phone: lead.phone || '',
      linkedin: lead.contactInfo?.socialProfiles?.linkedin || ''
    },
    status: lead.status,
    technologies: lead.technologies || [],
    pain_points: lead.painPoints || [],
    created_at: lead._creationTime ? new Date(lead._creationTime).toISOString() : new Date().toISOString(),
    updated_at: lead._creationTime ? new Date(lead._creationTime).toISOString() : new Date().toISOString(),
    source: lead.source || 'Google Maps Search'
  })) || [];

  const downloadResults = () => {
    logger.userAction('Download results', { 
      leadCount: searchResults.length,
      searchId 
    });
    const csvContent = [
      ['Company Name', 'Domain', 'Phone', 'Contact Name', 'Title', 'Email', 'Location', 'Industry', 'Status'],
      ...searchResults.map(result => [
        result.company_name,
        result.website ? result.website.replace(/^https?:\/\//, '').replace(/\/$/, '') : '',
        result.contact_info?.phone || '',
        result.contact_name || '',
        result.title || '',
        result.contact_info?.email || '',
        result.location || '',
        result.industry || '',
        result.status || ''
      ])
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lead-search-results-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    logger.info('Results downloaded successfully', {
      filename: `lead-search-results-${new Date().toISOString().split('T')[0]}.csv`,
      recordCount: searchResults.length
    });
  };

  return (
    <div className="space-y-6">
      {!searchId ? (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Please select a search from the Active or History tabs to view results.
          </AlertDescription>
        </Alert>
      ) : isLoading ? (
        <Alert>
          <Clock className="h-4 w-4 animate-spin" />
          <AlertDescription>
            Loading search results...
          </AlertDescription>
        </Alert>
      ) : searchResults.length === 0 ? (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            No leads found for this search. The search may still be in progress.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-foreground">
              Search Results ({searchResults.length} leads found)
            </h2>
            <Button 
              onClick={downloadResults}
              variant="outline"
              className="flex items-center gap-2"
            >
              <Download className="h-4 w-4" />
              Download CSV
            </Button>
          </div>
              
              <Card className="p-4 overflow-hidden">
                <div className="overflow-x-auto">
                  <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Company</TableHead>
                      <TableHead>Domain</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {searchResults.slice(0, 10).map((result) => (
                      <TableRow key={result.id}>
                        <TableCell className="font-medium">
                          <div>
                            <div>{result.company_name}</div>
                            <div className="text-xs text-muted-foreground">{result.industry}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {result.website ? (
                            <a 
                              href={result.website.startsWith('http') ? result.website : `https://${result.website}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-800 hover:underline text-sm"
                            >
                              {result.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                            </a>
                          ) : (
                            <span className="text-muted-foreground text-sm">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {result.contact_info?.phone || <span className="text-muted-foreground">-</span>}
                        </TableCell>
                        <TableCell>{result.contact_name || <span className="text-muted-foreground">-</span>}</TableCell>
                        <TableCell>{result.title || <span className="text-muted-foreground">-</span>}</TableCell>
                        <TableCell>
                          {result.contact_info?.email || <span className="text-muted-foreground">-</span>}
                        </TableCell>
                        <TableCell className="max-w-[200px]">
                          <div className="truncate" title={result.location}>
                            {result.location}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="bg-green-100 text-green-800">
                            {result.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => onGenerateEmail?.(result)}
                              className="text-xs"
                            >
                              <Bot className="h-3 w-3 mr-1" />
                              AI Email
                            </Button>
                            <Button size="sm" variant="ghost" className="text-xs">
                              <Mail className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  </Table>
                </div>
                
                {searchResults.length > 10 && (
                  <div className="mt-4 text-center text-muted-foreground">
                    Showing first 10 results. Download CSV to see all {searchResults.length} leads.
                  </div>
                )}
              </Card>
            </div>
        )}
    </div>
  );
}