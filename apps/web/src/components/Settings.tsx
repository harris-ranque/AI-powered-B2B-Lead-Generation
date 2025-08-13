import { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@genni/convex-types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Bell, Mail, Shield, User, CreditCard, Globe, Moon, Sun, Download, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export function Settings() {
  const [isLoading, setIsLoading] = useState(false);
  
  // Fetch user data
  const userData = useQuery(api.users.queries.getCurrentUserData);
  const userPreferences = useQuery(api.users.queries.getUserPreferences);
  const businessProfile = useQuery(api.profile.queries.getCurrentProfile);
  const notificationCounts = useQuery(api.notifications.queries.getNotificationCounts);
  
  // Mutations
  const updatePreferences = useMutation(api.users.mutations.updatePreferences);
  const updateProfile = useMutation(api.users.mutations.updateProfile);
  const updateBusinessProfile = useMutation(api.profile.mutations.updateProfileSection);
  
  // Local state for form data
  const [preferences, setPreferences] = useState({
    emailNotifications: true,
    language: "en",
    timezone: "UTC",
  });
  
  const [profileData, setProfileData] = useState({
    name: "",
    email: "",
    phone: "",
  });
  
  const [emailConfig, setEmailConfig] = useState({
    fromName: "",
    fromEmail: "",
    signature: "",
    autoFollowUp: false,
  });

  // Update local state when data loads
  useEffect(() => {
    if (userPreferences) {
      setPreferences(userPreferences);
    }
  }, [userPreferences]);

  useEffect(() => {
    if (userData) {
      setProfileData({
        name: userData.name || "",
        email: userData.email || "",
        phone: businessProfile?.contactInfo?.phone || "",
      });
    }
  }, [userData, businessProfile]);

  useEffect(() => {
    if (businessProfile?.contactInfo) {
      setEmailConfig({
        fromName: userData?.name || "",
        fromEmail: businessProfile.contactInfo.email || userData?.email || "",
        signature: `Best regards,\n${userData?.name || ""}\n${businessProfile.companyName || ""}\n${businessProfile.contactInfo.email || ""}`,
        autoFollowUp: false, // This could be a new field in the profile
      });
    }
  }, [businessProfile, userData]);

  const handlePreferencesUpdate = async (updates: Partial<typeof preferences>) => {
    setIsLoading(true);
    try {
      await updatePreferences(updates);
      setPreferences(prev => ({ ...prev, ...updates }));
      toast.success("Preferences updated successfully");
    } catch (error) {
      toast.error("Failed to update preferences");
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleProfileUpdate = async () => {
    setIsLoading(true);
    try {
      // Update user profile
      await updateProfile({
        name: profileData.name,
      });
      
      // Update business profile contact info
      if (businessProfile) {
        await updateBusinessProfile({
          section: "contact_info",
          data: {
            email: profileData.email,
            phone: profileData.phone,
            website: businessProfile.contactInfo?.website || "",
            linkedin: businessProfile.contactInfo?.linkedin || "",
          },
        });
      }
      
      toast.success("Profile updated successfully");
    } catch (error) {
      toast.error("Failed to update profile");
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailConfigUpdate = async () => {
    setIsLoading(true);
    try {
      if (businessProfile) {
        await updateBusinessProfile({
          section: "contact_info",
          data: {
            email: emailConfig.fromEmail,
            phone: businessProfile.contactInfo?.phone || "",
            website: businessProfile.contactInfo?.website || "",
            linkedin: businessProfile.contactInfo?.linkedin || "",
          },
        });
      }
      toast.success("Email configuration updated successfully");
    } catch (error) {
      toast.error("Failed to update email configuration");
      console.error(error);
    } finally {
      setIsLoading(false);
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
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-foreground mb-2">Settings</h1>
            <p className="text-muted-foreground">Manage your account preferences and application settings.</p>
          </div>

          {/* Account Settings */}
          <Card className="p-6 bg-card border-border mb-6">
            <div className="flex items-center gap-3 mb-6">
              <User className="h-5 w-5 text-primary" />
              <h3 className="text-lg font-semibold text-foreground">Account Settings</h3>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">Full Name</label>
                <Input 
                  value={profileData.name}
                  onChange={(e) => setProfileData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Enter your full name"
                  className="bg-input border-border" 
                />
              </div>
              
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">Email Address</label>
                <Input 
                  value={profileData.email}
                  onChange={(e) => setProfileData(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="Enter your email address"
                  className="bg-input border-border" 
                />
              </div>
              
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">Phone Number</label>
                <Input 
                  value={profileData.phone}
                  onChange={(e) => setProfileData(prev => ({ ...prev, phone: e.target.value }))}
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
              <h3 className="text-lg font-semibold text-foreground">Notification Preferences</h3>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-foreground">Email Notifications</div>
                  <div className="text-sm text-muted-foreground">Receive email updates about new leads and responses</div>
                </div>
                <Switch 
                  checked={preferences.emailNotifications}
                  onCheckedChange={(checked) => handlePreferencesUpdate({ emailNotifications: checked })}
                  disabled={isLoading}
                />
              </div>
              
              <Separator className="bg-border" />
              
              {notificationCounts && (
                <div className="p-3 bg-muted rounded-lg">
                  <div className="text-sm font-medium text-foreground mb-2">Notification Summary</div>
                  <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground">
                    <div>Total: {notificationCounts.total}</div>
                    <div>Unread: {notificationCounts.unread}</div>
                    <div>System Alerts: {notificationCounts.byType.system_alert}</div>
                    <div>Search Completed: {notificationCounts.byType.search_completed}</div>
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* Email Settings */}
          <Card className="p-6 bg-card border-border mb-6">
            <div className="flex items-center gap-3 mb-6">
              <Mail className="h-5 w-5 text-primary" />
              <h3 className="text-lg font-semibold text-foreground">Email Configuration</h3>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">Default From Name</label>
                <Input 
                  value={emailConfig.fromName}
                  onChange={(e) => setEmailConfig(prev => ({ ...prev, fromName: e.target.value }))}
                  placeholder="Enter your name for email sending"
                  className="bg-input border-border" 
                />
              </div>
              
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">Default From Email</label>
                <Input 
                  value={emailConfig.fromEmail}
                  onChange={(e) => setEmailConfig(prev => ({ ...prev, fromEmail: e.target.value }))}
                  placeholder="Enter your email address"
                  className="bg-input border-border" 
                />
              </div>
              
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">Email Signature</label>
                <textarea 
                  className="w-full p-3 bg-input border border-border rounded-md text-sm min-h-[80px] resize-none"
                  value={emailConfig.signature}
                  onChange={(e) => setEmailConfig(prev => ({ ...prev, signature: e.target.value }))}
                  placeholder="Enter your email signature"
                />
              </div>
              
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-foreground">Auto-follow up</div>
                  <div className="text-sm text-muted-foreground">Automatically send follow-up emails after 7 days</div>
                </div>
                <Switch 
                  checked={emailConfig.autoFollowUp}
                  onCheckedChange={(checked) => setEmailConfig(prev => ({ ...prev, autoFollowUp: checked }))}
                />
              </div>
              
              <Button 
                onClick={handleEmailConfigUpdate}
                disabled={isLoading}
                variant="outline"
                className="border-border"
              >
                {isLoading ? "Updating..." : "Update Email Settings"}
              </Button>
            </div>
          </Card>

          {/* Privacy & Security */}
          <Card className="p-6 bg-card border-border mb-6">
            <div className="flex items-center gap-3 mb-6">
              <Shield className="h-5 w-5 text-primary" />
              <h3 className="text-lg font-semibold text-foreground">Privacy & Security</h3>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-foreground">Two-Factor Authentication</div>
                  <div className="text-sm text-muted-foreground">Managed by your authentication provider</div>
                </div>
                <Badge variant="secondary" className="bg-blue-500/10 text-blue-500">
                  External Provider
                </Badge>
              </div>
              
              <Separator className="bg-border" />
              
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-foreground">Account Security</div>
                  <div className="text-sm text-muted-foreground">Your account is protected by modern authentication</div>
                </div>
                <Badge variant="secondary" className="bg-green-500/10 text-green-500">
                  Secure
                </Badge>
              </div>
              
              <Separator className="bg-border" />
              
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-foreground">Data Export</div>
                  <div className="text-sm text-muted-foreground">Download all your data, leads, and search history</div>
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
                    <div className="text-sm font-medium text-foreground mb-1">Account Information</div>
                    <div className="text-xs text-muted-foreground">
                      <div>Email: {userData.email}</div>
                      <div>Plan: {userData.plan || 'Free'}</div>
                      <div>Credits: {userData.credits || 0}</div>
                      <div>Joined: {userData.createdAt ? new Date(userData.createdAt).toLocaleDateString() : 'Unknown'}</div>
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
              <h3 className="text-lg font-semibold text-foreground">Appearance</h3>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-foreground">Theme Preference</div>
                  <div className="text-sm text-muted-foreground">Currently managed by system preference</div>
                </div>
                <Badge variant="secondary" className="bg-blue-500/10 text-blue-500">
                  System
                </Badge>
              </div>
              
              <Separator className="bg-border" />
              
              <div>
                <div className="font-medium text-foreground mb-3">Language</div>
                <select 
                  className="w-full p-2 bg-input border border-border rounded-md text-sm"
                  value={preferences.language}
                  onChange={(e) => handlePreferencesUpdate({ language: e.target.value })}
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
                  onChange={(e) => handlePreferencesUpdate({ timezone: e.target.value })}
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
                <h3 className="text-lg font-semibold text-foreground">Business Profile</h3>
              </div>
              
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-foreground">{businessProfile.companyName || "Not Set"}</div>
                    <div className="text-sm text-muted-foreground">{businessProfile.industry || "No industry specified"}</div>
                  </div>
                  <Badge 
                    variant="secondary" 
                    className={businessProfile.isComplete ? "bg-green-500/10 text-green-500" : "bg-yellow-500/10 text-yellow-500"}
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
                  Services: {businessProfile.services?.length || 0} | 
                  Target Markets: {businessProfile.targetMarkets?.length || 0} | 
                  Differentiators: {businessProfile.keyDifferentiators?.length || 0}
                </div>
              </div>
            </Card>
          ) : (
            <Card className="p-6 bg-card border-border mb-6">
              <div className="flex items-center gap-3 mb-4">
                <AlertCircle className="h-5 w-5 text-orange-500" />
                <h3 className="text-lg font-semibold text-foreground">Business Profile Required</h3>
              </div>
              
              <p className="text-sm text-muted-foreground mb-4">
                Create your business profile to unlock personalized lead generation and email capabilities.
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