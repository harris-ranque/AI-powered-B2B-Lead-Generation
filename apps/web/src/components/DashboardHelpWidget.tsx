import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HelpCircle, Mail } from "lucide-react";

export function DashboardHelpWidget() {
  const supportEmail =
    import.meta.env.VITE_SUPPORT_EMAIL?.trim() || "ethan@example.com";
  const mailtoLink = `mailto:${encodeURIComponent(supportEmail)}`;

  return (
    <Card className="flex w-full max-w-xs items-start gap-3 rounded-xl border-primary/20 bg-primary/5 p-4 shadow-sm">
      <HelpCircle className="mt-0.5 h-6 w-6 text-primary" />
      <div className="flex-1">
        <p className="text-sm font-semibold text-primary">Need help?</p>
        <p className="text-xs text-muted-foreground">
          Reach out to our support team and we'll get back to you shortly.
        </p>
      </div>
      <Button
        asChild
        size="sm"
        className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
      >
        <a href={mailtoLink} aria-label="Contact support via email">
          <Mail className="mr-1.5 h-4 w-4" />
          Email us
        </a>
      </Button>
    </Card>
  );
}
