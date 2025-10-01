import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HelpCircle, Mail } from "lucide-react";
import { useMemo } from "react";
import { withErrorBoundary } from "@/utils/errorHandling";
import { createLogger } from "@/utils/logger";

const helpWidgetLogger = createLogger("DashboardHelpWidget");

function DashboardHelpWidgetComponent() {
  const { mailtoLink, supportEmail, errorMessage } = useMemo(() => {
    const fallbackEmail = "ethan@example.com";
    try {
      const configuredEmail = import.meta.env.VITE_SUPPORT_EMAIL?.trim();
      const resolvedEmail = configuredEmail || fallbackEmail;
      const encodedLink = `mailto:${encodeURIComponent(resolvedEmail)}`;

      return {
        mailtoLink: encodedLink,
        supportEmail: resolvedEmail,
        errorMessage: null as string | null,
      };
    } catch (error) {
      const errorInstance =
        error instanceof Error ? error : new Error(String(error));
      helpWidgetLogger.error(
        "Failed to construct support email link",
        undefined,
        errorInstance,
      );

      return {
        mailtoLink: `mailto:${fallbackEmail}`,
        supportEmail: fallbackEmail,
        errorMessage: "Support email unavailable. Using default address.",
      };
    }
  }, []);

  return (
    <Card className="flex w-full max-w-xs items-start gap-3 rounded-xl border-primary/20 bg-primary/5 p-4 shadow-sm">
      <HelpCircle className="mt-0.5 h-6 w-6 text-primary" />
      <div className="flex-1">
        <p className="text-sm font-semibold text-primary">Need help?</p>
        <p className="text-xs text-muted-foreground">
          Reach out to our support team and we'll get back to you shortly.
        </p>
        {errorMessage && (
          <p className="mt-1 text-[11px] text-destructive" role="status">
            {errorMessage}
          </p>
        )}
      </div>
      <Button
        asChild
        size="sm"
        className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
      >
        <a href={mailtoLink} aria-label={`Contact support via email at ${supportEmail}`}>
          <Mail className="mr-1.5 h-4 w-4" />
          Email us
        </a>
      </Button>
    </Card>
  );
}

DashboardHelpWidgetComponent.displayName = "DashboardHelpWidget";

export const DashboardHelpWidget = withErrorBoundary(
  DashboardHelpWidgetComponent,
  "Dashboard help widget failed to render",
);
