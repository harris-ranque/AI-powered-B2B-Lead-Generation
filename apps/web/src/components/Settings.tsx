import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@genni/convex-types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Bell,
  Shield,
  User,
  CreditCard,
  Globe,
  Moon,
  Download,
  AlertCircle,
  Mail,
  Filter,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { ProviderKeyManager } from "@/components/settings/ProviderKeyManager";
import { InstantlySettings } from "@/components/settings/InstantlySettings";
import {
  hasSameEmailConfig,
  resolveSignature,
  type EmailConfigState,
} from "@/components/settings/emailConfig";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  APP_THEME_OPTIONS,
  DEFAULT_APP_THEME,
  applyAppTheme,
  type AppThemeKey,
} from "@/lib/appTheme";

type PreferencesState = {
  emailNotifications: boolean;
  language: string;
  timezone: string;
  theme: AppThemeKey;
  // Deduplication preferences
  enablePlaceNameDedup?: boolean;
  enableEmailDedup?: boolean;
  enableAddressDedup?: boolean;
   maxSearchExpansionIterations?: number;
   searchExpansionMultiplier?: number;
};

export function Settings() {
  const [isLoading, setIsLoading] = useState(false);

  // Fetch user data
  const userData = useQuery(api.users.queries.getCurrentUserData);
  const userPreferences = useQuery(api.users.queries.getUserPreferences);
  const businessProfile = useQuery(api.profile.queries.getCurrentProfile);
  const notificationCounts = useQuery(
    api.notifications.queries.getNotificationCounts,
  );

  const resolveThemePreference = (value: unknown): AppThemeKey => {
    const match = APP_THEME_OPTIONS.find((option) => option.value === value);
    return match ? match.value : DEFAULT_APP_THEME;
  };

  // Mutations
  const updatePreferences = useMutation(api.users.mutations.updatePreferences);
  const updateProfile = useMutation(api.users.mutations.updateProfile);
  const updateBusinessProfile = useMutation(
    api.profile.mutations.updateProfileSection,
  );

  // Local state for form data
  const [preferences, setPreferences] = useState<PreferencesState>({
    emailNotifications: true,
    language: "en",
    timezone: "UTC",
    theme: DEFAULT_APP_THEME,
    enablePlaceNameDedup: false,
    enableEmailDedup: true,
    enableAddressDedup: true,
    maxSearchExpansionIterations: 5,
    searchExpansionMultiplier: 1.5,
  });

  const [profileData, setProfileData] = useState({
    name: "",
    email: "",
    phone: "",
  });
  const [emailConfig, setEmailConfig] = useState<EmailConfigState>({
    fromName: "",
    fromEmail: "",
    signature: "",
  });
  const lastSyncedEmailConfig = useRef<EmailConfigState | null>(null);
  const [isUpdatingEmail, setIsUpdatingEmail] = useState(false);
  const [expansionIterationsSetting, setExpansionIterationsSetting] =
    useState(5);
  const [expansionMultiplierSetting, setExpansionMultiplierSetting] =
    useState(1.5);

  const normalizeContactName = (value: string) =>
    value
      ? value
          .replace(/\s+/g, " ")
          .replace(/[\u200B-\u200D\uFEFF]/g, "")
          .trim()
      : "";

  const clampExpansionIterations = (value: number) =>
    Math.min(Math.max(Math.round(value), 0), 5);
  const clampExpansionMultiplier = (value: number) =>
    Math.min(Math.max(Number.isFinite(value) ? value : 1.5, 1.1), 3);

  // Update local state when data loads
  useEffect(() => {
    if (userPreferences) {
      const theme = resolveThemePreference(
        (userPreferences as { theme?: AppThemeKey }).theme,
      );

      setPreferences((prev) => ({
        ...prev,
        emailNotifications:
          userPreferences.emailNotifications ?? prev.emailNotifications,
        language: userPreferences.language ?? prev.language,
        timezone: userPreferences.timezone ?? prev.timezone,
        theme,
        enablePlaceNameDedup:
          userPreferences.enablePlaceNameDedup ?? prev.enablePlaceNameDedup,
        enableEmailDedup:
          userPreferences.enableEmailDedup ?? prev.enableEmailDedup,
        enableAddressDedup:
          userPreferences.enableAddressDedup ?? prev.enableAddressDedup,
        maxSearchExpansionIterations:
          userPreferences.maxSearchExpansionIterations ??
          prev.maxSearchExpansionIterations,
        searchExpansionMultiplier:
          userPreferences.searchExpansionMultiplier ??
          prev.searchExpansionMultiplier,
      }));

      setExpansionIterationsSetting(
        userPreferences.maxSearchExpansionIterations ?? 5,
      );
      setExpansionMultiplierSetting(
        userPreferences.searchExpansionMultiplier ?? 1.5,
      );

      applyAppTheme(theme);
    }
  }, [userPreferences]);

  useEffect(() => {
    if (userData) {
      setProfileData({
        name:
          normalizeContactName(
            (businessProfile?.contactInfo as { name?: string } | undefined)
              ?.name || userData.name || "",
          ),
        email: userData.email || "",
        phone: businessProfile?.contactInfo?.phone || "",
      });
    }
  }, [userData, businessProfile]);

  useEffect(() => {
    const contactInfo = businessProfile?.contactInfo as {
      name?: string;
      email?: string;
      phone?: string;
      website?: string;
      linkedin?: string;
      signature?: string;
    } | null;

    const normalizedName = normalizeContactName(
      contactInfo?.name || userData?.name || "",
    );
    const fromEmail = contactInfo?.email || userData?.email || "";

    // Use saved signature from backend, or build default if none has ever been saved
    const savedSignature = contactInfo?.signature;
    const nextEmailConfig = {
      fromName: normalizedName,
      fromEmail,
      signature: resolveSignature(
        savedSignature,
        normalizedName,
        businessProfile?.companyName || "",
        fromEmail,
      ),
    };

    if (hasSameEmailConfig(lastSyncedEmailConfig.current, nextEmailConfig)) {
      return;
    }

    lastSyncedEmailConfig.current = nextEmailConfig;
    setEmailConfig(nextEmailConfig);
  }, [businessProfile, userData]);

  const handlePreferencesUpdate = async (
    updates: Partial<PreferencesState>,
  ) => {
    setIsLoading(true);
    try {
      await updatePreferences(updates);
      setPreferences((prev) => ({ ...prev, ...updates }));
      if (updates.theme) {
        applyAppTheme(resolveThemePreference(updates.theme));
      }
      toast.success("Preferences updated successfully");
    } catch (error) {
      toast.error("Failed to update preferences");
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExpansionIterationsBlur = () => {
    const clamped = clampExpansionIterations(expansionIterationsSetting);
    setExpansionIterationsSetting(clamped);
    handlePreferencesUpdate({ maxSearchExpansionIterations: clamped });
  };

  const handleExpansionMultiplierBlur = () => {
    const clamped = Number(
      clampExpansionMultiplier(expansionMultiplierSetting).toFixed(2),
    );
    setExpansionMultiplierSetting(clamped);
    handlePreferencesUpdate({ searchExpansionMultiplier: clamped });
  };

  const handleProfileUpdate = async () => {
    setIsLoading(true);
    try {
      const sanitizedName = normalizeContactName(profileData.name);

      // Update user profile
      await updateProfile({
        name: sanitizedName || undefined,
      });

      // Update business profile contact info
      if (businessProfile) {
        await updateBusinessProfile({
          section: "contact_info",
          data: {
            name: sanitizedName,
            email: profileData.email,
            phone: profileData.phone,
            website: businessProfile.contactInfo?.website || "",
            linkedin: businessProfile.contactInfo?.linkedin || "",
          },
        });
      }

      setProfileData((prev) => ({
        ...prev,
        name: sanitizedName,
      }));

      toast.success("Profile updated successfully");
    } catch (error) {
      toast.error("Failed to update profile");
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

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
          signature: emailConfig.signature, // Persist user's custom signature
        },
      });

      setEmailConfig((prev) => ({
        ...prev,
        fromName: sanitizedFromName,
        // Keep the user's signature as-is instead of rebuilding it
      }));

      toast.success("Email configuration updated successfully");
    } catch (error) {
      toast.error("Failed to update email configuration");
      console.error(error);
    } finally {
      setIsUpdatingEmail(false);
    }
  };

  const handleDataExport = async () => {
    setIsLoading(true);
    try {
      // This would typically call a backend function to generate and download data
      toast.info("Data export functionality coming soon");
    } catch (error) {
      toast.error("Failed to export data");
    } finally {
      setIsLoading(false);
    }
  };

  const handleThemeChange = (value: string) => {
    const theme = resolveThemePreference(value);
    handlePreferencesUpdate({ theme });
  };

  const themeSelectId = "app-theme-select";

  if (!userData || !userPreferences) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading settings...</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-screen">
      <div className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-4xl">
          <ProviderKeyManager plan={userData?.plan} />
          {/* Instantly Integration Settings - Available to all users */}
          <InstantlySettings />
          {/* Account Settings */}
          <Card className="p-6 bg-card border-border mb-6" data-testid="user-profile">
            <div className="flex items-center gap-3 mb-6">
              <User className="h-5 w-5 text-primary" />
              <h3 className="text-lg font-semibold text-foreground">
                Account Settings
              </h3>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">
                  Full Name
                </label>
                <Input
                  value={profileData.name}
                  onChange={(e) =>
                    setProfileData((prev) => ({
                      ...prev,
                      name: e.target.value,
                    }))
                  }
                  onBlur={(e) =>
                    setProfileData((prev) => ({
                      ...prev,
                      name: normalizeContactName(e.target.value),
                    }))
                  }
                  placeholder="Enter your full name"
                  className="bg-input border-border"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">
                  Email Address
                </label>
                <Input
                  value={profileData.email}
                  onChange={(e) =>
                    setProfileData((prev) => ({
                      ...prev,
                      email: e.target.value,
                    }))
                  }
                  placeholder="Enter your email address"
                  className="bg-input border-border"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">
                  Phone Number
                </label>
                <Input
                  value={profileData.phone}
                  onChange={(e) =>
                    setProfileData((prev) => ({
                      ...prev,
                      phone: e.target.value,
                    }))
                  }
                  placeholder="Enter your phone number"
                  className="bg-input border-border"
                />
              </div>

              <Button
                onClick={handleProfileUpdate}
                disabled={isLoading}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {isLoading ? "Updating..." : "Update Profile"}
              </Button>
            </div>
          </Card>

          {/* Notification Settings */}
          <Card className="p-6 bg-card border-border mb-6">
            <div className="flex items-center gap-3 mb-6">
              <Bell className="h-5 w-5 text-primary" />
              <h3 className="text-lg font-semibold text-foreground">
                Notification Preferences
              </h3>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-foreground">
                    Email Notifications
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Receive email updates about new leads and responses
                  </div>
                </div>
                <Switch
                  checked={preferences.emailNotifications}
                  onCheckedChange={(checked) =>
                    handlePreferencesUpdate({ emailNotifications: checked })
                  }
                  disabled={isLoading}
                />
              </div>

              <Separator className="bg-border" />

              {notificationCounts && (
                <div className="p-3 bg-muted rounded-lg">
                  <div className="text-sm font-medium text-foreground mb-2">
                    Notification Summary
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground">
                    <div>Total: {notificationCounts.total}</div>
                    <div>Unread: {notificationCounts.unread}</div>
                    <div>
                      System Alerts: {notificationCounts.byType.system_alert}
                    </div>
                    <div>
                      Search Completed:{" "}
                      {notificationCounts.byType.search_completed}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* Email Configuration */}
          <Card className="p-6 bg-card border-border mb-6">
            <div className="flex items-center gap-3 mb-6">
              <Mail className="h-5 w-5 text-primary" />
              <h3 className="text-lg font-semibold text-foreground">
                Email Configuration
              </h3>
            </div>

            <div className="space-y-4">
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
            </div>
          </Card>

          {/* Deduplication Options */}
          <Card className="p-6 bg-card border-border mb-6">
            <div className="flex items-center gap-3 mb-6">
              <Filter className="h-5 w-5 text-primary" />
              <h3 className="text-lg font-semibold text-foreground">
                Deduplication Options
              </h3>
            </div>

            <div className="space-y-6">
              {/* Place Name Deduplication */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="font-medium text-foreground">
                      Filter duplicate place names
                    </div>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button type="button" className="inline-flex">
                            <Info className="h-4 w-4 text-muted-foreground" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p>
                            Removes businesses with identical names from search results.
                            Useful for filtering out franchise locations (e.g., multiple
                            State Farm or McDonald's locations). Only keeps the first
                            occurrence found.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Search-level only (not user history)
                  </div>
                </div>
                <Switch
                  checked={preferences.enablePlaceNameDedup ?? false}
                  onCheckedChange={(checked) =>
                    handlePreferencesUpdate({ enablePlaceNameDedup: checked })
                  }
                  disabled={isLoading}
                />
              </div>

              <Separator className="bg-border" />

              {/* Email Deduplication */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="font-medium text-foreground">
                      Avoid duplicate email addresses
                    </div>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button type="button" className="inline-flex">
                            <Info className="h-4 w-4 text-muted-foreground" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p>
                            Prevents sending emails to the same email address across
                            all your searches. Checks against your historical lead
                            database.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Checks all previous leads (recommended)
                  </div>
                </div>
                <Switch
                  checked={preferences.enableEmailDedup ?? true}
                  onCheckedChange={(checked) =>
                    handlePreferencesUpdate({ enableEmailDedup: checked })
                  }
                  disabled={isLoading}
                />
              </div>

              <Separator className="bg-border" />

              {/* Address Deduplication */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="font-medium text-foreground">
                      Filter duplicate addresses
                    </div>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button type="button" className="inline-flex">
                            <Info className="h-4 w-4 text-muted-foreground" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p>
                            Removes locations with addresses you've already targeted.
                            Checks against your historical lead database.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Checks all previous leads (recommended)
                  </div>
                </div>
                <Switch
                  checked={preferences.enableAddressDedup ?? true}
                  onCheckedChange={(checked) =>
                    handlePreferencesUpdate({ enableAddressDedup: checked })
                  }
                  disabled={isLoading}
                />
              </div>

              <Separator className="bg-border" />

              <div className="space-y-3 rounded-lg border border-border/60 bg-muted/10 p-4">
                <div className="flex items-center gap-2">
                  <div className="font-medium text-foreground">
                    Search expansion safeguards
                  </div>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" className="inline-flex">
                          <Info className="h-4 w-4 text-muted-foreground" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p>
                          Automatically expands the search radius (in concentric tiles) when
                          deduplication removes too many leads. Stops after the configured number
                          of attempts or 3× the original radius.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
                      <span>Max attempts</span>
                      <Badge variant="outline">
                        {expansionIterationsSetting}
                      </Badge>
                    </div>
                    <Input
                      type="number"
                      min={0}
                      max={5}
                      step={1}
                      value={expansionIterationsSetting}
                      onChange={(e) =>
                        setExpansionIterationsSetting(Number(e.target.value))
                      }
                      onBlur={handleExpansionIterationsBlur}
                      className="bg-input border-border"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
                      <span>Radius multiplier</span>
                      <Badge variant="outline">
                        {expansionMultiplierSetting.toFixed(1)}×
                      </Badge>
                    </div>
                    <Input
                      type="number"
                      min={1.1}
                      max={3}
                      step={0.1}
                      value={expansionMultiplierSetting}
                      onChange={(e) =>
                        setExpansionMultiplierSetting(Number(e.target.value))
                      }
                      onBlur={handleExpansionMultiplierBlur}
                      className="bg-input border-border"
                    />
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  We'll fetch about 1.5× the requested leads initially, then expand up to{" "}
                  {(preferences.searchExpansionMultiplier ?? 1.5).toFixed(1)}× the original radius (max 3×)
                  until we reach your requested count or hit the attempt limit.
                </p>
              </div>
            </div>
          </Card>

          {/* Privacy & Security */}
          <Card className="p-6 bg-card border-border mb-6">
            <div className="flex items-center gap-3 mb-6">
              <Shield className="h-5 w-5 text-primary" />
              <h3 className="text-lg font-semibold text-foreground">
                Privacy & Security
              </h3>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-foreground">
                    Two-Factor Authentication
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Managed by your authentication provider
                  </div>
                </div>
                <Badge
                  variant="secondary"
                  className="bg-blue-500/10 text-blue-500"
                >
                  External Provider
                </Badge>
              </div>

              <Separator className="bg-border" />

              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-foreground">
                    Account Security
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Your account is protected by modern authentication
                  </div>
                </div>
                <Badge
                  variant="secondary"
                  className="bg-green-500/10 text-green-500"
                >
                  Secure
                </Badge>
              </div>

              <Separator className="bg-border" />

              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-foreground">Data Export</div>
                  <div className="text-sm text-muted-foreground">
                    Download all your data, leads, and search history
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-border"
                  onClick={handleDataExport}
                  disabled={isLoading}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export Data
                </Button>
              </div>

              {userData.email && (
                <>
                  <Separator className="bg-border" />
                  <div className="p-3 bg-muted rounded-lg">
                    <div className="text-sm font-medium text-foreground mb-1">
                      Account Information
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <div>Email: {userData.email}</div>
                      <div>Plan: {userData.plan || "Free"}</div>
                      <div>Credits: {userData.credits || 0}</div>
                      <div>
                        Joined:{" "}
                        {userData.createdAt
                          ? new Date(userData.createdAt).toLocaleDateString()
                          : "Unknown"}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </Card>

          {/* Appearance */}
          <Card className="p-6 bg-card border-border mb-6">
            <div className="flex items-center gap-3 mb-6">
              <Moon className="h-5 w-5 text-primary" />
              <h3 className="text-lg font-semibold text-foreground">
                Appearance
              </h3>
            </div>

            <div className="space-y-4">
              <div className="space-y-3">
                <div className="font-medium text-foreground">
                  Theme Preference
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor={themeSelectId}
                    className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    Choose your vibe
                  </label>
                  <select
                    id={themeSelectId}
                    className="w-full p-2 bg-input border border-border rounded-md text-sm"
                    value={preferences.theme}
                    onChange={(e) => handleThemeChange(e.target.value)}
                    disabled={isLoading}
                  >
                    {APP_THEME_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <Separator className="bg-border" />

              <div>
                <div className="font-medium text-foreground mb-3">Language</div>
                <select
                  className="w-full p-2 bg-input border border-border rounded-md text-sm"
                  value={preferences.language}
                  onChange={(e) =>
                    handlePreferencesUpdate({ language: e.target.value })
                  }
                  disabled={isLoading}
                >
                  <option value="en">English</option>
                  <option value="es">Spanish</option>
                  <option value="fr">French</option>
                  <option value="de">German</option>
                  <option value="it">Italian</option>
                  <option value="pt">Portuguese</option>
                </select>
              </div>

              <Separator className="bg-border" />

              <div>
                <div className="font-medium text-foreground mb-3">Timezone</div>
                <select
                  className="w-full p-2 bg-input border border-border rounded-md text-sm"
                  value={preferences.timezone}
                  onChange={(e) =>
                    handlePreferencesUpdate({ timezone: e.target.value })
                  }
                  disabled={isLoading}
                >
                  <option value="UTC">UTC</option>
                  <option value="America/New_York">Eastern Time (ET)</option>
                  <option value="America/Chicago">Central Time (CT)</option>
                  <option value="America/Denver">Mountain Time (MT)</option>
                  <option value="America/Los_Angeles">Pacific Time (PT)</option>
                  <option value="Europe/London">London</option>
                  <option value="Europe/Paris">Paris</option>
                  <option value="Asia/Tokyo">Tokyo</option>
                  <option value="Asia/Shanghai">Shanghai</option>
                </select>
              </div>
            </div>
          </Card>

          {/* Business Profile Link */}
          {businessProfile ? (
            <Card className="p-6 bg-card border-border mb-6">
              <div className="flex items-center gap-3 mb-4">
                <User className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold text-foreground">
                  Business Profile
                </h3>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-foreground">
                      {businessProfile.companyName || "Not Set"}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {businessProfile.industry || "No industry specified"}
                    </div>
                  </div>
                  <Badge
                    variant="secondary"
                    className={
                      businessProfile.isComplete
                        ? "bg-green-500/10 text-green-500"
                        : "bg-yellow-500/10 text-yellow-500"
                    }
                  >
                    {businessProfile.isComplete ? "Complete" : "Incomplete"}
                  </Badge>
                </div>

                {businessProfile.valueProposition && (
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {businessProfile.valueProposition}
                  </p>
                )}

                <div className="text-xs text-muted-foreground">
                  Services: {businessProfile.services?.length || 0} | Target
                  Markets: {businessProfile.targetMarkets?.length || 0} |
                  Differentiators:{" "}
                  {businessProfile.keyDifferentiators?.length || 0}
                </div>
              </div>
            </Card>
          ) : (
            <Card className="p-6 bg-card border-border mb-6">
              <div className="flex items-center gap-3 mb-4">
                <AlertCircle className="h-5 w-5 text-orange-500" />
                <h3 className="text-lg font-semibold text-foreground">
                  Business Profile Required
                </h3>
              </div>

              <p className="text-sm text-muted-foreground mb-4">
                Create your business profile to unlock personalized lead
                generation and email capabilities.
              </p>

              <Button className="bg-primary hover:bg-primary/90 text-primary-foreground">
                Create Business Profile
              </Button>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
