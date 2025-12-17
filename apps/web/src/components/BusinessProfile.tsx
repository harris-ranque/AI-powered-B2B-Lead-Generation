import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@genni/convex-types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Mail, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { createLogger } from "@/utils/logger";
import { useApiError } from "@/hooks/useApiError";

const logger = createLogger("BusinessProfile");

export function BusinessProfile() {
  const userData = useQuery(api.users.queries.getCurrentUserData);
  const businessProfile = useQuery(api.profile.queries.getCurrentProfile);
  const updateBusinessProfile = useMutation(
    api.profile.mutations.updateProfileSection,
  );

  const [emailConfig, setEmailConfig] = useState({
    fromName: "",
    fromEmail: "",
    signature: "",
  });
  const [isUpdatingEmail, setIsUpdatingEmail] = useState(false);
  const [companyInfoOpen, setCompanyInfoOpen] = useState(false);
  const [emailConfigOpen, setEmailConfigOpen] = useState(false);
  const [profileCompletionOpen, setProfileCompletionOpen] = useState(false);

  const normalizeContactName = (value: string) =>
    value
      ? value
          .replace(/\s+/g, " ")
          .replace(/[\u200B-\u200D\uFEFF]/g, "")
          .trim()
      : "";

  const buildSignature = (
    name: string,
    company?: string,
    email?: string,
  ) => {
    const lines = [
      "Best regards,",
      name,
      company,
      email,
    ].filter((line) => !!line?.trim());

    return lines.join("\n");
  };

  useEffect(() => {
    const contactInfo = businessProfile?.contactInfo as {
      name?: string;
      email?: string;
      phone?: string;
      website?: string;
      linkedin?: string;
    } | undefined;

    const normalizedName = normalizeContactName(
      contactInfo?.name || userData?.name || "",
    );
    const fromEmail = contactInfo?.email || userData?.email || "";

    setEmailConfig({
      fromName: normalizedName,
      fromEmail,
      signature: buildSignature(
        normalizedName,
        businessProfile?.companyName || "",
        fromEmail,
      ),
    });
  }, [businessProfile, userData]);

  const handleEmailConfigUpdate = async () => {
    setIsUpdatingEmail(true);
    try {
      const sanitizedFromName = normalizeContactName(emailConfig.fromName);
      const contactInfo = (businessProfile?.contactInfo as {
        phone?: string;
        website?: string;
        linkedin?: string;
      }) || {};

      await updateBusinessProfile({
        section: "contact_info",
        data: {
          name: sanitizedFromName,
          email: emailConfig.fromEmail,
          phone: contactInfo.phone || "",
          website: contactInfo.website || "",
          linkedin: contactInfo.linkedin || "",
        },
      });

      setEmailConfig((prev) => ({
        ...prev,
        fromName: sanitizedFromName,
        signature: buildSignature(
          sanitizedFromName,
          businessProfile?.companyName || "",
          emailConfig.fromEmail,
        ),
      }));

      toast.success("Email configuration updated successfully");
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      logger.error("Failed to update email configuration", { section: "contact_info" }, errorObj);
      toast.error("Failed to update email configuration");
    } finally {
      setIsUpdatingEmail(false);
    }
  };

  return (
    <div className="flex h-screen">
      <div className="flex-1 p-8">
        <div className="max-w-4xl">
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-foreground mb-2">
              Business Profile
            </h1>
            <p className="text-muted-foreground">
              Manage your business information and preferences.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <Collapsible
                open={companyInfoOpen}
                onOpenChange={setCompanyInfoOpen}
              >
                <Card className="p-6 bg-card border-border">
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between text-left"
                    >
                      <h3 className="text-lg font-semibold text-foreground">
                        Company Information
                      </h3>
                      <ChevronRight
                        className={cn(
                          "h-5 w-5 text-muted-foreground transition-transform",
                          companyInfoOpen && "rotate-90",
                        )}
                      />
                    </button>
                  </CollapsibleTrigger>

                  <CollapsibleContent className="space-y-4 pt-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium text-foreground mb-2 block">
                          Company Name
                        </label>
                        <Input
                          defaultValue="Acme Corp"
                          className="bg-input border-border"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-foreground mb-2 block">
                          Industry
                        </label>
                        <Input
                          defaultValue="Software & Technology"
                          className="bg-input border-border"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-sm font-medium text-foreground mb-2 block">
                        Company Description
                      </label>
                      <Textarea
                        defaultValue="We're a leading technology company that specializes in creating innovative solutions for businesses worldwide."
                        className="bg-input border-border min-h-[100px]"
                      />
                    </div>

                    <div>
                      <label className="text-sm font-medium text-foreground mb-2 block">
                        Offer for Email Campaign
                      </label>
                      <Textarea
                        defaultValue="Get 30% off your first purchase with our innovative software solutions. Limited time offer for new customers!"
                        className="bg-input border-border min-h-[80px]"
                        placeholder="Describe your special offer or value proposition for email campaigns..."
                      />
                    </div>

                    <div>
                      <label className="text-sm font-medium text-foreground mb-2 block">
                        Location
                      </label>
                      <Input
                        defaultValue="San Francisco, CA"
                        className="bg-input border-border"
                      />
                    </div>

                    <div className="flex gap-3 pt-4">
                      <Button className="bg-primary hover:bg-primary/90 text-primary-foreground">
                        Save Changes
                      </Button>
                      <Button variant="outline" className="border-border">
                        Cancel
                      </Button>
                    </div>
                  </CollapsibleContent>
                </Card>
              </Collapsible>

              <Collapsible
                open={emailConfigOpen}
                onOpenChange={setEmailConfigOpen}
              >
                <Card className="p-6 bg-card border-border">
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between text-left"
                    >
                      <span className="flex items-center gap-3">
                        <Mail className="h-5 w-5 text-primary" />
                        <h3 className="text-lg font-semibold text-foreground">
                          Email Configuration
                        </h3>
                      </span>
                      <ChevronRight
                        className={cn(
                          "h-5 w-5 text-muted-foreground transition-transform",
                          emailConfigOpen && "rotate-90",
                        )}
                      />
                    </button>
                  </CollapsibleTrigger>

                  <CollapsibleContent className="space-y-4 pt-6">
                    <div>
                      <label className="text-sm font-medium text-foreground mb-2 block">
                        Default From Name
                      </label>
                      <Input
                        value={emailConfig.fromName}
                        onChange={(e) =>
                          setEmailConfig((prev) => ({
                            ...prev,
                            fromName: e.target.value,
                          }))
                        }
                        onBlur={(e) =>
                          setEmailConfig((prev) => ({
                            ...prev,
                            fromName: normalizeContactName(e.target.value),
                          }))
                        }
                        placeholder="Enter your name for email sending"
                        className="bg-input border-border"
                      />
                    </div>

                    <div>
                      <label className="text-sm font-medium text-foreground mb-2 block">
                        Default From Email
                      </label>
                      <Input
                        value={emailConfig.fromEmail}
                        onChange={(e) =>
                          setEmailConfig((prev) => ({
                            ...prev,
                            fromEmail: e.target.value,
                          }))
                        }
                        placeholder="Enter your email address"
                        className="bg-input border-border"
                      />
                    </div>

                    <div>
                      <label className="text-sm font-medium text-foreground mb-2 block">
                        Email Signature
                      </label>
                      <Textarea
                        value={emailConfig.signature}
                        onChange={(e) =>
                          setEmailConfig((prev) => ({
                            ...prev,
                            signature: e.target.value,
                          }))
                        }
                        className="bg-input border-border min-h-[100px]"
                        placeholder="Enter your email signature"
                      />
                    </div>

                    <Button
                      onClick={handleEmailConfigUpdate}
                      disabled={isUpdatingEmail}
                      variant="outline"
                      className="border-border"
                    >
                      {isUpdatingEmail ? "Saving..." : "Save Email Settings"}
                    </Button>

                    <p className="text-sm text-muted-foreground">
                      Genni automatically prepares two follow-up emails for each
                      outreach sequence by default.
                    </p>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            </div>

            <div className="space-y-6">
              <Collapsible
                open={profileCompletionOpen}
                onOpenChange={setProfileCompletionOpen}
              >
                <Card className="p-6 bg-card border-border">
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between text-left"
                    >
                      <h3 className="text-lg font-semibold text-foreground">
                        Profile Completion
                      </h3>
                      <ChevronRight
                        className={cn(
                          "h-5 w-5 text-muted-foreground transition-transform",
                          profileCompletionOpen && "rotate-90",
                        )}
                      />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-6">
                    <div className="text-center">
                      <div className="text-3xl font-bold text-primary mb-2">
                        85%
                      </div>
                      <p className="text-sm text-muted-foreground mb-4">
                        Almost there! Complete your profile to get better leads.
                      </p>
                      <Button
                        size="sm"
                        className="bg-primary hover:bg-primary/90 text-primary-foreground w-full"
                      >
                        Complete Profile
                      </Button>
                    </div>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
