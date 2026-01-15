import React from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Download, FileSpreadsheet, Info, CheckCircle2, AlertCircle } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";

/**
 * CSV Template Download Component
 *
 * Provides users with:
 * - Downloadable sample CSV template with all fields
 * - Field documentation (required vs optional)
 * - Credit cost explanation
 * - Example data rows
 */
export function CSVTemplateDownload() {
  const generateSampleCSV = () => {
    // CSV Header with essential fields only - show required fields clearly
    const headers = [
      // REQUIRED
      "company_name (required)",
      "domain (required)",
      // OPTIONAL - Contact
      "contact_name",
      "contact_email",
      "phone",
      // OPTIONAL - Business
      "website",
      "industry",
      "notes",
    ];

    // Example rows demonstrating different scenarios
    const rows = [
      // Row 1: With email (1 credit - skip enrichment)
      [
        "Acme Corp",
        "acme.com",
        "John Smith",
        "john@acme.com",
        "(555) 123-4567",
        "https://acme.com",
        "Software",
        "High-priority prospect",
      ],
      // Row 2: Domain only (2 credits - needs enrichment)
      [
        "TechStart Inc",
        "techstart.io",
        "",
        "",
        "+1-555-987-6543",
        "https://techstart.io",
        "Technology",
        "AI consulting services",
      ],
      // Row 3: Minimal with email (1 credit)
      [
        "Local Bakery",
        "localbakery.com",
        "Jane Doe",
        "jane@localbakery.com",
        "(555) 555-1212",
        "",
        "Food & Beverage",
        "",
      ],
    ];

    // Convert to CSV format
    const csvContent =
      headers.join(",") +
      "\n" +
      rows
        .map((row) =>
          row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","),
        )
        .join("\n");

    // Create download link
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "genni_lead_template.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="glass-card border-primary/20">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              CSV Template & Instructions
            </CardTitle>
            <CardDescription>
              Download the sample template to see the correct format and learn about
              credit costs
            </CardDescription>
          </div>
          <Button
            onClick={generateSampleCSV}
            size="sm"
            className="gap-2 bg-primary hover:bg-primary/90"
          >
            <Download className="h-4 w-4" />
            Download Template
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Quick Reference */}
        <div className="grid grid-cols-2 gap-4">
          <Alert className="border-green-500/50 bg-green-500/10">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <AlertDescription className="text-sm">
              <strong className="block mb-1">Has Email (1 credit)</strong>
              Provide company_name + domain + contact_email to skip enrichment
            </AlertDescription>
          </Alert>

          <Alert className="border-blue-500/50 bg-blue-500/10">
            <Info className="h-4 w-4 text-blue-500" />
            <AlertDescription className="text-sm">
              <strong className="block mb-1">Needs Enrichment (2 credits)</strong>
              Provide company_name + domain without email for full enrichment
            </AlertDescription>
          </Alert>
        </div>

        {/* Field Documentation */}
        <Accordion type="single" collapsible className="w-full">
          {/* Required Fields */}
          <AccordionItem value="required">
            <AccordionTrigger className="text-sm font-semibold">
              <div className="flex items-center gap-2">
                <Badge variant="destructive">Required</Badge>
                Required Fields (2)
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-2 text-sm">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 mt-0.5 text-red-500 flex-shrink-0" />
                  <div>
                    <strong>company_name:</strong> Business name (e.g., "Acme Corp")
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 mt-0.5 text-red-500 flex-shrink-0" />
                  <div>
                    <strong>domain:</strong> Website domain (e.g., "acme.com") - OR
                    provide contact_email
                  </div>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Contact Info */}
          <AccordionItem value="contact">
            <AccordionTrigger className="text-sm font-semibold">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">Optional</Badge>
                Contact Information (3 fields)
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p className="text-primary font-medium mb-2">
                  Providing contact_email saves 1 credit per lead (skips enrichment)
                </p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>
                    <strong>contact_name:</strong> Decision maker name
                  </li>
                  <li>
                    <strong>contact_email:</strong> Direct email (skips enrichment!)
                  </li>
                  <li>
                    <strong>phone:</strong> Phone number
                  </li>
                </ul>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Business Info */}
          <AccordionItem value="business">
            <AccordionTrigger className="text-sm font-semibold">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">Optional</Badge>
                Business Information (3 fields)
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-1 text-sm text-muted-foreground">
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>
                    <strong>website:</strong> Full website URL
                  </li>
                  <li>
                    <strong>industry:</strong> Industry/category
                  </li>
                  <li>
                    <strong>notes:</strong> Custom notes or description
                  </li>
                </ul>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {/* Credit Cost Explanation */}
        <Alert className="border-yellow-500/50 bg-yellow-500/10">
          <Info className="h-4 w-4 text-yellow-500" />
          <AlertDescription className="text-sm space-y-2">
            <strong className="block">Credit Cost Logic:</strong>
            <ul className="list-disc list-inside space-y-1 ml-2 text-muted-foreground">
              <li>
                <strong>1 credit:</strong> Lead has contact_email (skips enrichment,
                research only)
              </li>
              <li>
                <strong>2 credits:</strong> Lead has domain but no email (enrichment +
                research)
              </li>
              <li>
                <strong>Invalid:</strong> Lead missing both domain AND email (will be
                skipped)
              </li>
            </ul>
          </AlertDescription>
        </Alert>

        {/* Tips */}
        <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
          <p>
            <strong>💡 Tips:</strong>
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>Use the domain without "www" (e.g., "example.com" not "www.example.com")</li>
            <li>If you have emails, provide them to save credits!</li>
            <li>Invalid rows will be skipped with detailed error reports</li>
            <li>Maximum file size: 10MB, Maximum rows: 5,000</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
