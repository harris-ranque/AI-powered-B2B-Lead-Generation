import { useState } from "react";
import { ArrowLeft, Copy, RotateCcw, ThumbsUp, ThumbsDown, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface AIResponseInterfaceProps {
  onBack?: () => void;
  onVoiceClick?: () => void;
}

export function AIResponseInterface({ onBack, onVoiceClick }: AIResponseInterfaceProps) {
  const [message, setMessage] = useState("");

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      {/* Header */}
      <header className="flex items-center justify-between p-4 border-b border-border/50">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-semibold">AI Wave</h1>
        </div>
        <Button variant="ghost" size="icon">
          <div className="w-2 h-2 bg-primary rounded-full" />
          <div className="w-2 h-2 bg-primary rounded-full ml-1" />
          <div className="w-2 h-2 bg-primary rounded-full ml-1" />
        </Button>
      </header>

      {/* Chat Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* User Message */}
        <div className="flex justify-end">
          <Card className="max-w-[80%] p-3 bg-primary text-primary-foreground">
            <p className="text-sm">What is digital abstract design and find 3 example of abstract design</p>
            <div className="flex items-center gap-2 mt-2 text-xs opacity-80">
              <ThumbsUp className="h-3 w-3" />
              <Copy className="h-3 w-3" />
            </div>
          </Card>
        </div>

        {/* AI Response */}
        <div className="flex justify-start">
          <div className="max-w-[85%]">
            <Card className="p-4 glass">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-full gradient-primary" />
                <span className="text-sm font-medium">AI</span>
              </div>
              
              <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
                <p>
                  Digital abstract design refers to creating artistic compositions using digital tools that 
                  incorporate abstract shapes, colors, and textures. This type of design typically relies on 
                  software programs such as Adobe Photoshop, Illustrator, or Sketch to create visual 
                  representations that are not representational or realistic.
                </p>
              </div>
            </Card>

            {/* Abstract Design Examples */}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Card className="aspect-square bg-gradient-to-br from-purple-500/20 to-pink-500/20 p-3 glass">
                <div className="w-full h-full bg-gradient-to-br from-purple-400 to-pink-400 rounded-lg opacity-60" />
              </Card>
              <Card className="aspect-square bg-gradient-to-br from-blue-500/20 to-cyan-500/20 p-3 glass">
                <div className="w-full h-full bg-gradient-to-br from-blue-400 to-cyan-400 rounded-lg opacity-60" />
              </Card>
            </div>

            <Card className="mt-2 aspect-video bg-gradient-to-br from-orange-500/20 to-red-500/20 p-3 glass">
              <div className="w-full h-full bg-gradient-to-br from-orange-400 to-red-400 rounded-lg opacity-60" />
            </Card>

            {/* Response Actions */}
            <div className="flex items-center gap-2 mt-3">
              <Button variant="ghost" size="sm" className="text-xs">
                <RotateCcw className="h-3 w-3 mr-1" />
                Reload Response
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Input Area */}
      <div className="p-4 border-t border-border/50">
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Write anything here..."
              className="pr-10 bg-muted/10 border-border/20"
            />
            <Button 
              variant="ghost" 
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8"
            >
              <div className="w-4 h-4 rounded-full bg-muted" />
            </Button>
          </div>
          <Button 
            size="icon" 
            onClick={onVoiceClick}
            className="gradient-primary text-primary-foreground glow-primary"
          >
            <Mic className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}