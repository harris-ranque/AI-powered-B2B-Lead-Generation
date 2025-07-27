import { Menu, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MobileHeaderProps {
  title: string;
  showMenu?: boolean;
  onMenuClick?: () => void;
}

export function MobileHeader({ title, showMenu = true, onMenuClick }: MobileHeaderProps) {
  return (
    <header className="flex items-center justify-between p-4 bg-card/50 backdrop-blur-sm border-b border-border">
      <div className="flex items-center gap-3">
        {showMenu && (
          <Button variant="ghost" size="icon" onClick={onMenuClick}>
            <Menu className="h-5 w-5" />
          </Button>
        )}
        <h1 className="text-lg font-semibold">{title}</h1>
      </div>
      
      <Button variant="ghost" size="icon">
        <MoreHorizontal className="h-5 w-5" />
      </Button>
    </header>
  );
}