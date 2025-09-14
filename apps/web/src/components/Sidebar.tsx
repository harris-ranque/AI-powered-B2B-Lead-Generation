import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Search,
  Users,
  FileText,
  BarChart,
  Settings,
  CreditCard,
  Menu,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface SidebarProps {
  currentPage: string;
  onPageChange: (page: string) => void;
}

export function Sidebar({ currentPage, onPageChange }: SidebarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const isAdminRoute = location.pathname.startsWith("/admin");

  const mainNavItems = [
    {
      id: "search",
      icon: Search,
      title: "Search",
      subtitle: "Find new leads",
      badge: null,
    },
    {
      id: "leads",
      icon: Users,
      title: "All Leads",
      subtitle: "1,247 total",
      badge: "89",
    },
    {
      id: "templates",
      icon: FileText,
      title: "Email Templates",
      subtitle: "12 saved",
      badge: null,
    },
    {
      id: "analytics",
      icon: BarChart,
      title: "Analytics",
      subtitle: null,
      badge: null,
    },
  ];

  const settingsNavItems = [
    {
      id: "settings",
      icon: Settings,
      title: "Settings",
      subtitle: null,
      badge: null,
    },
    {
      id: "billing",
      icon: CreditCard,
      title: "Billing",
      subtitle: "Pro Plan",
      badge: null,
    },
  ];

  const NavItem = ({ item }: { item: (typeof mainNavItems)[0] }) => {
    const Icon = item.icon;
    const isActive = currentPage === item.id;

    return (
      <button
        onClick={() => {
          onPageChange(item.id);
          setIsOpen(false);
        }}
        className={`
          w-full flex items-center gap-3 p-3 mb-1 rounded-lg text-left transition-smooth relative
          ${
            isActive
              ? "bg-primary/10 text-primary border-l-2 border-primary"
              : "hover:bg-muted/10 text-foreground hover:text-primary"
          }
        `}
      >
        {isActive && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-3/5 bg-primary rounded-r" />
        )}
        <div
          className={`
          w-8 h-8 rounded-lg flex items-center justify-center transition-smooth
          ${
            isActive
              ? "bg-primary/15 text-primary"
              : "bg-muted/20 text-muted-foreground"
          }
        `}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <div className="font-medium text-sm">{item.title}</div>
          {item.subtitle && (
            <div className="text-xs text-muted-foreground mt-0.5">
              {item.subtitle}
            </div>
          )}
        </div>
        {item.badge && (
          <Badge className="bg-primary text-primary-foreground text-xs px-2 py-0.5">
            {item.badge}
          </Badge>
        )}
      </button>
    );
  };

  return (
    <>
      {/* Mobile Menu Button */}
      <Button
        variant="ghost"
        size="icon"
        className="fixed top-4 left-4 z-50 lg:hidden glass-card"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </Button>

      {/* Sidebar */}
      <aside
        className={`
        fixed left-0 top-0 h-screen w-64 gradient-surface border-r border-border p-6 z-40 transition-transform
        ${isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
      `}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 mb-10 px-2">
          <div className="w-9 h-9 gradient-primary rounded-lg flex items-center justify-center text-primary-foreground font-bold text-lg glow-accent">
            ⚡
          </div>
          <span className="text-xl font-bold">Genni</span>
      </div>

        {/* Main Navigation */}
        <nav className="space-y-6">
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-2">
              Main
            </div>
            <div className="space-y-1">
              {mainNavItems.map((item) => (
                <NavItem key={item.id} item={item} />
              ))}
            </div>
          </div>

          {/* Admin Section */}
          <div>
            <button
              className={`w-full flex items-center justify-between px-2 py-2 rounded-md text-xs font-semibold uppercase tracking-wider transition-smooth ${
                isAdminRoute ? "text-primary" : "text-muted-foreground"
              }`}
              onClick={() => setAdminOpen((v) => !v)}
              aria-expanded={adminOpen}
            >
              <span>Admin</span>
              <span className={`transition-transform ${adminOpen ? "rotate-90" : "rotate-0"}`}>›</span>
            </button>
            {adminOpen && (
              <div className="mt-2 space-y-1">
                <button
                  onClick={() => {
                    navigate("/admin");
                    setIsOpen(false);
                  }}
                  className={`w-full text-left block rounded-lg px-3 py-2 text-sm hover:bg-muted/10 ${
                    isAdminRoute && location.pathname === "/admin" ? "bg-primary/10 text-primary" : ""
                  }`}
                >
                  Admin Dashboard
                </button>
                <button
                  onClick={() => {
                    navigate("/admin?tab=users");
                    setIsOpen(false);
                  }}
                  className="w-full text-left block rounded-lg px-3 py-2 text-sm hover:bg-muted/10"
                >
                  Users
                </button>
                <button
                  onClick={() => {
                    navigate("/admin?tab=credits");
                    setIsOpen(false);
                  }}
                  className="w-full text-left block rounded-lg px-3 py-2 text-sm hover:bg-muted/10"
                >
                  Credits
                </button>
                <button
                  onClick={() => {
                    navigate("/admin?tab=services");
                    setIsOpen(false);
                  }}
                  className="w-full text-left block rounded-lg px-3 py-2 text-sm hover:bg-muted/10"
                >
                  Services
                </button>
                <button
                  onClick={() => {
                    navigate("/admin?tab=configuration");
                    setIsOpen(false);
                  }}
                  className="w-full text-left block rounded-lg px-3 py-2 text-sm hover:bg-muted/10"
                >
                  Configuration
                </button>
                <button
                  onClick={() => {
                    navigate("/admin?tab=system");
                    setIsOpen(false);
                  }}
                  className="w-full text-left block rounded-lg px-3 py-2 text-sm hover:bg-muted/10"
                >
                  System
                </button>
                <button
                  onClick={() => {
                    navigate("/admin/docs");
                    setIsOpen(false);
                  }}
                  className={`w-full text-left block rounded-lg px-3 py-2 text-sm hover:bg-muted/10 ${
                    location.pathname.startsWith("/admin/docs") ? "bg-primary/10 text-primary" : ""
                  }`}
                >
                  Documentation
                </button>
              </div>
            )}
          </div>

          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-2">
              Settings
            </div>
            <div className="space-y-1">
              {settingsNavItems.map((item) => (
                <NavItem key={item.id} item={item} />
              ))}
            </div>
          </div>
        </nav>
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
