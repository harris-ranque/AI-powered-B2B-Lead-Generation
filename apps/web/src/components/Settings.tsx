import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Bell, Mail, Shield, User, CreditCard, Globe, Moon, Sun } from "lucide-react";

export function Settings() {
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-foreground mb-2 block">First Name</label>
                  <Input defaultValue="John" className="bg-input border-border" />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground mb-2 block">Last Name</label>
                  <Input defaultValue="Smith" className="bg-input border-border" />
                </div>
              </div>
              
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">Email Address</label>
                <Input defaultValue="john.smith@acmecorp.com" className="bg-input border-border" />
              </div>
              
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">Phone Number</label>
                <Input defaultValue="+1 (555) 123-4567" className="bg-input border-border" />
              </div>
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
                <Switch defaultChecked />
              </div>
              
              <Separator className="bg-border" />
              
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-foreground">Daily Summary</div>
                  <div className="text-sm text-muted-foreground">Get a daily summary of your lead generation activity</div>
                </div>
                <Switch defaultChecked />
              </div>
              
              <Separator className="bg-border" />
              
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-foreground">Lead Alerts</div>
                  <div className="text-sm text-muted-foreground">Instant notifications when high-quality leads are found</div>
                </div>
                <Switch />
              </div>
              
              <Separator className="bg-border" />
              
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-foreground">Campaign Updates</div>
                  <div className="text-sm text-muted-foreground">Updates about your email campaign performance</div>
                </div>
                <Switch defaultChecked />
              </div>
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
                <Input defaultValue="John Smith" className="bg-input border-border" />
              </div>
              
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">Default From Email</label>
                <Input defaultValue="john@acmecorp.com" className="bg-input border-border" />
              </div>
              
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">Email Signature</label>
                <textarea 
                  className="w-full p-3 bg-input border border-border rounded-md text-sm min-h-[80px] resize-none"
                  defaultValue="Best regards,&#10;John Smith&#10;CEO, Acme Corp&#10;john@acmecorp.com"
                />
              </div>
              
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-foreground">Auto-follow up</div>
                  <div className="text-sm text-muted-foreground">Automatically send follow-up emails after 7 days</div>
                </div>
                <Switch />
              </div>
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
                  <div className="text-sm text-muted-foreground">Add an extra layer of security to your account</div>
                </div>
                <Badge variant="secondary" className="bg-green-500/10 text-green-500">
                  Enabled
                </Badge>
              </div>
              
              <Separator className="bg-border" />
              
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-foreground">Profile Visibility</div>
                  <div className="text-sm text-muted-foreground">Make your profile visible to other users</div>
                </div>
                <Switch />
              </div>
              
              <Separator className="bg-border" />
              
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-foreground">Data Export</div>
                  <div className="text-sm text-muted-foreground">Download all your data and leads</div>
                </div>
                <Button variant="outline" size="sm" className="border-border">
                  Export Data
                </Button>
              </div>
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
                  <div className="font-medium text-foreground">Dark Mode</div>
                  <div className="text-sm text-muted-foreground">Switch between light and dark themes</div>
                </div>
                <Switch defaultChecked />
              </div>
              
              <Separator className="bg-border" />
              
              <div>
                <div className="font-medium text-foreground mb-3">Language</div>
                <select className="w-full p-2 bg-input border border-border rounded-md text-sm">
                  <option>English</option>
                  <option>Spanish</option>
                  <option>French</option>
                  <option>German</option>
                </select>
              </div>
            </div>
          </Card>

          {/* Save Changes */}
          <div className="flex gap-3">
            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground">
              Save Changes
            </Button>
            <Button variant="outline" className="border-border">
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}