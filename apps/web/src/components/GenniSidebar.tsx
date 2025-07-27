import { useState } from "react";
import { 
  BarChart3, 
  User, 
  Search, 
  History, 
  TrendingUp, 
  Settings,
  Moon,
  Menu,
  X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { GenniLogo } from "./GenniLogo";

interface GenniSidebarProps {
  currentPage: string;
  onPageChange: (page: string) => void;
}

export function GenniSidebar({ currentPage, onPageChange }: GenniSidebarProps) {
  const [isOpen, setIsOpen] = useState(false);

  const navItems = [
    {
      id: "dashboard",
      icon: BarChart3,
      title: "Dashboard",
    },
    {
      id: "business-profile",
      icon: User,
      title: "Business Profile",
    },
    {
      id: "lead-search",
      icon: Search,
      title: "Lead Search",
    },
    {
      id: "search-history",
      icon: History,
      title: "Search History",
    },
    {
      id: "performance",
      icon: TrendingUp,
      title: "Performance",
    },
    {
      id: "settings",
      icon: Settings,
      title: "Settings",
    }
  ];

  const NavItem = ({ item }: { item: typeof navItems[0] }) => {
    const Icon = item.icon;
    const isActive = currentPage === item.id;

    return (
      <button
        onClick={() => {
          onPageChange(item.id);
          setIsOpen(false);
        }}
        className={`
          w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-smooth relative
          ${isActive 
            ? 'bg-primary/10 text-primary' 
            : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-primary'
          }
        `}
      >
        <Icon className="h-5 w-5" />
        <span className="font-medium">{item.title}</span>
      </button>
    );
  };

  return (
    <>
      {/* Mobile Menu Button */}
      <Button
        variant="ghost"
        size="icon"
        className="fixed top-4 left-4 z-50 lg:hidden bg-card border border-border"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </Button>

      {/* Sidebar */}
      <aside className={`
        fixed left-0 top-0 h-screen w-64 bg-sidebar-background border-r border-sidebar-border z-40 transition-transform
        ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="p-6">
          {/* Logo */}
          <div className="flex justify-center mb-12">
            <GenniLogo className="w-40 h-40" />
          </div>

          {/* Navigation */}
          <nav className="space-y-2">
            {navItems.map((item) => (
              <NavItem key={item.id} item={item} />
            ))}
          </nav>

          {/* Dark Mode Toggle */}
          <div className="mt-auto pt-8">
            <button className="flex items-center gap-3 px-4 py-3 w-full text-left text-sidebar-foreground hover:bg-sidebar-accent hover:text-primary rounded-lg transition-smooth">
              <Moon className="h-5 w-5" />
              <span className="font-medium">Settings</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-30 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  );
}