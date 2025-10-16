import { useState } from "react";
import { ChatInterface } from "./ChatInterface";
import { VoiceInterface } from "./VoiceInterface";
import { AIResponseInterface } from "./AIResponseInterface";
import { MobileHeader } from "./MobileHeader";

type AppState = "chat" | "voice" | "response";

export function MobileAIApp() {
  const [currentState, setCurrentState] = useState<AppState>("chat");
  const [isListening, setIsListening] = useState(false);

  const handleVoiceClick = () => {
    setCurrentState("voice");
    setIsListening(true);
  };

  const handleStopListening = () => {
    setIsListening(false);
    // Simulate processing and show response
    setTimeout(() => {
      setCurrentState("response");
    }, 1000);
  };

  const handleBackToChat = () => {
    setCurrentState("chat");
    setIsListening(false);
  };

  const handleCloseVoice = () => {
    setCurrentState("chat");
    setIsListening(false);
  };

  if (currentState === "voice") {
    return (
      <VoiceInterface
        isListening={isListening}
        onStartListening={() => setIsListening(true)}
        onStopListening={handleStopListening}
        onClose={handleCloseVoice}
      />
    );
  }

  if (currentState === "response") {
    return (
      <AIResponseInterface
        onBack={handleBackToChat}
        onVoiceClick={handleVoiceClick}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <MobileHeader title="AI Assistant" showMenu={false} />
      <ChatInterface onVoiceClick={handleVoiceClick} />
    </div>
  );
}
