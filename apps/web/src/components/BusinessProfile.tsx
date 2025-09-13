import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function BusinessProfile() {
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
            {/* Profile Overview */}
            <Card className="lg:col-span-2 p-6 bg-card border-border">
              <h3 className="text-lg font-semibold text-foreground mb-6">
                Company Information
              </h3>

              <div className="space-y-4">
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
              </div>
            </Card>

            {/* Profile Stats */}
            <div className="space-y-6">
              <Card className="p-6 bg-card border-border">
                <h3 className="text-lg font-semibold text-foreground mb-4">
                  Profile Completion
                </h3>
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
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
