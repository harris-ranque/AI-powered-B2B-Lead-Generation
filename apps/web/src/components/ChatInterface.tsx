import { useState } from "react";
import { Mic, Image, ArrowRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface ChatInterfaceProps {
  onVoiceClick?: () => void;
}

export function ChatInterface({ onVoiceClick }: ChatInterfaceProps) {
  const [query, setQuery] = useState("");

  const recentSearches = [
    "Look for 5 potential headlines for websites with fintech themes",
    "Find the python code to create a 10-fold branch",
    "5 copywriting for the benefits and features section on the Saas website",
  ];

  const quickActions = [
    {
      title: "Start Now",
      subtitle: "Chat",
      icon: "💬",
      gradient: true,
    },
    {
      title: "Search by",
      subtitle: "image",
      icon: "🖼️",
      gradient: false,
    },
  ];

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-background via-background to-muted/20 p-4">
      {/* Greeting */}
      <div className="text-center mt-8 mb-12">
        <h1 className="text-2xl font-bold mb-2">
          Let's see what can I do for you ?
        </h1>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-3 mb-8">
        {quickActions.map((action, index) => (
          <Card
            key={index}
            className={`
              p-6 cursor-pointer transition-smooth hover:scale-105
              ${
                action.gradient
                  ? "gradient-primary text-primary-foreground glow-primary"
                  : "glass hover:bg-muted/10"
              }
            `}
          >
            <div className="text-2xl mb-2">{action.icon}</div>
            <div className="text-sm font-medium">{action.title}</div>
            <div className="text-xs opacity-80">{action.subtitle}</div>
          </Card>
        ))}
      </div>

      {/* Voice Recording Button */}
      <div className="flex justify-center mb-8">
        <Button
          onClick={onVoiceClick}
          className="gradient-primary text-primary-foreground px-6 py-3 rounded-full glow-primary transition-smooth hover:scale-105"
        >
          <Mic className="h-4 w-4 mr-2" />
          Start Recording
        </Button>
      </div>

      {/* Search by Image */}
      <div className="mb-8">
        <Card className="p-4 glass cursor-pointer hover:bg-muted/10 transition-smooth">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-muted/20 flex items-center justify-center">
                <Image className="h-4 w-4" />
              </div>
              <div>
                <div className="font-medium text-sm">Search by</div>
                <div className="text-xs text-muted-foreground">image</div>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </div>
        </Card>
      </div>

      {/* Recent Searches */}
      <div className="flex-1">
        <h3 className="text-sm text-muted-foreground mb-4 font-medium">
          Recently Search
        </h3>
        <div className="space-y-3">
          {recentSearches.map((search, index) => (
            <Card
              key={index}
              className="p-4 glass cursor-pointer hover:bg-muted/10 transition-smooth"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-muted/20 flex items-center justify-center">
                    <Search className="h-4 w-4" />
                  </div>
                  <p className="text-sm text-muted-foreground flex-1">
                    {search}
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
