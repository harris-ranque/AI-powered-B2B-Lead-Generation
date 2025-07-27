import { useState } from "react";
import { Search, MapPin, Target, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SearchPageProps {
  onSearch?: (params: {
    businessType: string;
    location: string;
    resultCount: number;
  }) => void;
}

export function SearchPage({ onSearch }: SearchPageProps) {
  const [businessType, setBusinessType] = useState("");
  const [location, setLocation] = useState("");
  const [resultCount, setResultCount] = useState(50);

  const quickSearches = [
    "Tech Startups in Austin",
    "Marketing Agencies NYC", 
    "SaaS Companies Bay Area"
  ];

  const handleSearch = () => {
    const searchParams = {
      businessType,
      location,
      resultCount
    };
    onSearch?.(searchParams);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold">Let's find new leads</h1>
        <p className="text-muted-foreground text-lg">
          Tell me what kind of businesses you're looking for
        </p>
      </div>

      {/* Search Form */}
      <Card className="glass-card p-8 space-y-6">
        <div className="space-y-2">
          <Label className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Search className="h-4 w-4" />
            Business Type or Name
          </Label>
          <Input
            value={businessType}
            onChange={(e) => setBusinessType(e.target.value)}
            placeholder="e.g., SaaS companies, Marketing agencies, Dentists"
            className="bg-input border-border focus:border-primary focus:ring-primary/25"
          />
        </div>

        <div className="space-y-2">
          <Label className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <MapPin className="h-4 w-4" />
            Location
          </Label>
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g., San Francisco, Austin TX, 90210"
            className="bg-input border-border focus:border-primary focus:ring-primary/25"
          />
        </div>

        <div className="space-y-2">
          <Label className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Target className="h-4 w-4" />
            Number of Results
          </Label>
          <Input
            type="number"
            value={resultCount}
            onChange={(e) => setResultCount(Number(e.target.value))}
            min="10"
            max="500"
            className="bg-input border-border focus:border-primary focus:ring-primary/25"
          />
        </div>

        <Button 
          onClick={handleSearch}
          className="w-full gradient-primary glow-primary hover:opacity-90 transition-smooth"
          size="lg"
        >
          <ArrowRight className="h-4 w-4 mr-2" />
          Start Searching
        </Button>
      </Card>

      {/* Quick Searches */}
      <div className="space-y-4">
        <h3 className="text-base font-medium text-muted-foreground">Quick Searches</h3>
        <div className="flex flex-wrap gap-2">
          {quickSearches.map((search, index) => (
            <Button
              key={index}
              variant="secondary"
              size="sm"
              className="rounded-full bg-secondary hover:bg-secondary/80 transition-smooth"
              onClick={() => {
                // Parse quick search and populate fields
                setBusinessType(search.split(' in ')[0]);
                if (search.includes(' in ')) {
                  setLocation(search.split(' in ')[1]);
                }
              }}
            >
              {search}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}