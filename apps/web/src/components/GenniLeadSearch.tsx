import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CircularProgress } from "./CircularProgress";
import { Play, Download, Bot, Mail, Clock, AlertCircle } from "lucide-react";
import type { Lead } from "@/lib/api-client";
import type { Id } from "@/@/convex/_generated/dataModel";
import { useLeads } from "@/hooks/useLeads";
import { useProfile } from "@/hooks/useProfile";

interface LeadSearchProps {
  searchId?: Id<"searches"> | null;
  onGenerateEmail?: (lead: Lead) => void;
}

export function GenniLeadSearch({ searchId, onGenerateEmail }: LeadSearchProps) {
  // Real Convex hooks
  const { leads, isLoading } = useLeads(searchId || undefined);
  const { profile } = useProfile();

  // Convert Convex leads to expected Lead format
  const searchResults = leads?.map(lead => ({
    id: lead._id,
    company_name: lead.companyName,
    contact_name: lead.contactName || '',
    title: lead.title || '',
    industry: lead.industry || '',
    company_size: lead.companySize || '',
    location: lead.location || '',
    description: lead.description || '',
    website: lead.website || '',
    contact_info: {
      email: lead.email || '',
      phone: lead.phone || '',
      linkedin: lead.linkedinUrl || ''
    },
    status: lead.status,
    technologies: lead.technologies || [],
    pain_points: lead.painPoints || [],
    created_at: lead._creationTime ? new Date(lead._creationTime).toISOString() : new Date().toISOString(),
    updated_at: lead._creationTime ? new Date(lead._creationTime).toISOString() : new Date().toISOString(),
    source: lead.source || 'Google Maps Search'
  })) || [];

  const downloadResults = () => {
    const csvContent = [
      ['Company Name', 'Contact Name', 'Title', 'Email', 'Phone', 'Location', 'Industry', 'Company Size', 'Website'],
      ...searchResults.map(result => [
        result.company_name,
        result.contact_name || '',
        result.title || '',
        result.contact_info?.email || '',
        result.contact_info?.phone || '',
        result.location || '',
        result.industry || '',
        result.company_size || '',
        result.website || ''
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
              
              <Card className="p-4">
                
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Company</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Company Size</TableHead>
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
                        <TableCell>{result.contact_name}</TableCell>
                        <TableCell>{result.title}</TableCell>
                        <TableCell>
                          <div className="text-sm">
                            <div>{result.contact_info?.email}</div>
                            <div className="text-xs text-muted-foreground">{result.contact_info?.phone}</div>
                          </div>
                        </TableCell>
                        <TableCell>{result.location}</TableCell>
                        <TableCell>{result.company_size}</TableCell>
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