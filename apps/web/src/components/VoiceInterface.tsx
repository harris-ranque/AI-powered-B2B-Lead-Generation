import { useState } from "react";
import { Mic, MicOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface VoiceInterfaceProps {
  isListening?: boolean;
  onStartListening?: () => void;
  onStopListening?: () => void;
  onClose?: () => void;
}

export function VoiceInterface({ 
  isListening = false, 
  onStartListening, 
  onStopListening,
  onClose 
}: VoiceInterfaceProps) {
  const [isRecording, setIsRecording] = useState(isListening);

  const handleToggleRecording = () => {
    if (isRecording) {
      setIsRecording(false);
      onStopListening?.();
    } else {
      setIsRecording(true);
      onStartListening?.();
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-background to-background/80 p-6">
      {/* Header */}
      <div className="w-full flex items-center justify-between mb-8">
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-5 w-5" />
        </Button>
        <h2 className="text-lg font-medium">Speaking to AI bot</h2>
        <div className="w-10" /> {/* Spacer */}
      </div>

      {/* Status */}
      <p className="text-muted-foreground text-sm mb-16">
        {isRecording ? "I'm listening..." : "Go ahead, I'm listening"}
      </p>

      {/* Voice Visualization */}
      <div className="relative mb-16">
        {/* Outer glow rings */}
        {isRecording && (
          <>
            <div className="absolute inset-0 rounded-full border-2 border-primary/30 voice-pulse" style={{ width: '200px', height: '200px', left: '-25px', top: '-25px' }} />
            <div className="absolute inset-0 rounded-full border border-primary/20 voice-pulse" style={{ width: '240px', height: '240px', left: '-45px', top: '-45px', animationDelay: '0.5s' }} />
          </>
        )}
        
        {/* Main circle */}
        <div className={`
          relative w-[150px] h-[150px] rounded-full
          flex items-center justify-center
          transition-all duration-300
          ${isRecording 
            ? 'bg-gradient-to-br from-primary to-accent glow-primary' 
            : 'glass border-primary/20'
          }
        `}>
          {/* Inner circle with waveform effect */}
          {isRecording && (
            <div className="w-20 h-20 rounded-full bg-background/20 flex items-center justify-center">
              <div className="w-8 h-8 rounded-full bg-background/40" />
            </div>
          )}
        </div>
      </div>

      {/* Current Question */}
      <div className="text-center mb-12 max-w-sm">
        <p className="text-foreground text-lg leading-relaxed">
          What is digital abstract design and find 3 example of abstract design
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-6">
        <Button variant="ghost" size="icon" className="w-12 h-12 rounded-full glass">
          <div className="w-6 h-6 bg-muted rounded-sm" />
        </Button>
        
        <Button 
          size="icon" 
          className={`
            w-16 h-16 rounded-full transition-all duration-300
            ${isRecording 
              ? 'bg-red-500 hover:bg-red-600 glow-voice' 
              : 'gradient-primary glow-primary'
            }
          `}
          onClick={handleToggleRecording}
        >
          {isRecording ? (
            <MicOff className="h-6 w-6" />
          ) : (
            <Mic className="h-6 w-6" />
          )}
        </Button>
        
        <Button variant="ghost" size="icon" className="w-12 h-12 rounded-full glass">
          <X className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}