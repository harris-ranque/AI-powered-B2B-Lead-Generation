import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  CheckCircle,
  ArrowRight,
  ArrowLeft,
  Building2,
  Target,
  MessageSquare,
  Sparkles,
  Info,
  Plus,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useProfile } from "@/hooks/useProfile";

interface BusinessProfile {
  companyName: string;
  industry: string;
  targetIndustries: string[];
  offerings: string[];
  toneOfVoice: string;
  valueProposition: string;
  keyDifferentiators: string[];
  painPointsWeSolve: string[];
  idealCustomerProfile: string;
  currentChallenges: string[];
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  contactWebsite: string;
  contactLinkedin: string;
}

type IncomingProfile = Partial<BusinessProfile> & {
  targetMarkets?: string[];
  services?: string[];
  contactInfo?: {
    name?: string;
    email?: string;
    phone?: string;
    website?: string;
    linkedin?: string;
  };
};

interface BusinessProfileWizardProps {
  onComplete: (profile: BusinessProfile) => void;
  onSkip?: () => void;
  initialData?: Partial<BusinessProfile>;
  variant?: "wizard" | "editor";
}

const normalizeContactName = (value: string) =>
  value
    ? value
        .replace(/\s+/g, " ")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .trim()
    : "";

const parseStringArray = (value: unknown): string[] => {
  if (!value && value !== "") {
    return [];
  }

  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean),
      ),
    );
  }

  if (typeof value === "string") {
    return Array.from(
      new Set(
        value
          .split(/[,\n]/)
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    );
  }

  return [];
};

const resolveArray = (...values: unknown[]): string[] => {
  for (const value of values) {
    const parsed = parseStringArray(value);
    if (parsed.length > 0) {
      return parsed;
    }
  }

  return [];
};

export function BusinessProfileWizard({
  onComplete,
  onSkip,
  initialData,
  variant = "wizard",
}: BusinessProfileWizardProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [isSaving, setIsSaving] = useState(false);

  // State for form inputs
  const [newTargetIndustry, setNewTargetIndustry] = useState("");
  const [newOffering, setNewOffering] = useState("");
  const [newDifferentiator, setNewDifferentiator] = useState("");
  const [newPainPoint, setNewPainPoint] = useState("");
  const [newChallenge, setNewChallenge] = useState("");

  // Convex hooks
  const { profile: existingProfile, createOrUpdateProfile } = useProfile();
  const { user } = useAuth();

  const initialContactInfo =
    (existingProfile?.contactInfo as {
      name?: string;
      email?: string;
      phone?: string;
      website?: string;
      linkedin?: string;
    } | null | undefined) ??
    (initialData as IncomingProfile | undefined)?.contactInfo;

  const [profile, setProfile] = useState<BusinessProfile>({
    companyName:
      initialData?.companyName ?? existingProfile?.companyName ?? "",
    industry: initialData?.industry ?? existingProfile?.industry ?? "",
    targetIndustries: resolveArray(
      initialData?.targetIndustries,
      (initialData as IncomingProfile | undefined)?.targetMarkets,
      existingProfile?.targetIndustries,
      (existingProfile as IncomingProfile | undefined)?.targetMarkets,
    ),
    offerings: resolveArray(
      initialData?.offerings,
      (initialData as IncomingProfile | undefined)?.services,
      existingProfile?.offerings,
      (existingProfile as IncomingProfile | undefined)?.services,
    ),
    toneOfVoice:
      initialData?.toneOfVoice ??
      existingProfile?.toneOfVoice ??
      "professional",
    valueProposition:
      initialData?.valueProposition ??
      existingProfile?.valueProposition ??
      "",
    keyDifferentiators: resolveArray(
      initialData?.keyDifferentiators,
      existingProfile?.keyDifferentiators,
    ),
    painPointsWeSolve: resolveArray(
      initialData?.painPointsWeSolve,
      existingProfile?.painPointsWeSolve,
    ),
    idealCustomerProfile:
      initialData?.idealCustomerProfile ??
      existingProfile?.idealCustomerProfile ??
      "",
    currentChallenges: resolveArray(
      initialData?.currentChallenges,
      existingProfile?.currentChallenges,
    ),
    contactName: normalizeContactName(
      initialData?.contactName ??
        initialContactInfo?.name ??
        user?.name ??
        "",
    ),
    contactEmail:
      initialData?.contactEmail ??
      initialContactInfo?.email ??
      user?.email ??
      "",
    contactPhone:
      initialData?.contactPhone ?? initialContactInfo?.phone ?? "",
    contactWebsite:
      initialData?.contactWebsite ?? initialContactInfo?.website ?? "",
    contactLinkedin:
      initialData?.contactLinkedin ?? initialContactInfo?.linkedin ?? "",
  });

  useEffect(() => {
    const sourceProfile = initialData || existingProfile;
    if (!sourceProfile) {
      return;
    }

    const normalizedProfile: IncomingProfile = sourceProfile;
    const contactInfo = normalizedProfile.contactInfo ?? {};

    setProfile((prev) => ({
      ...prev,
      companyName: prev.companyName || sourceProfile.companyName || "",
      industry: prev.industry || sourceProfile.industry || "",
      valueProposition:
        prev.valueProposition || sourceProfile.valueProposition || "",
      targetIndustries:
        prev.targetIndustries.length > 0
          ? prev.targetIndustries
          : resolveArray(
              normalizedProfile.targetIndustries,
              normalizedProfile.targetMarkets,
            ),
      offerings:
        prev.offerings.length > 0
          ? prev.offerings
          : resolveArray(
              normalizedProfile.offerings,
              normalizedProfile.services,
            ),
      keyDifferentiators:
        prev.keyDifferentiators.length > 0
          ? prev.keyDifferentiators
          : resolveArray(sourceProfile.keyDifferentiators),
      painPointsWeSolve:
        prev.painPointsWeSolve.length > 0
          ? prev.painPointsWeSolve
          : resolveArray(normalizedProfile.painPointsWeSolve),
      idealCustomerProfile:
        prev.idealCustomerProfile ||
        normalizedProfile.idealCustomerProfile ||
        "",
      currentChallenges:
        prev.currentChallenges.length > 0
          ? prev.currentChallenges
          : resolveArray(normalizedProfile.currentChallenges),
      contactName: normalizeContactName(
        prev.contactName ||
          normalizedProfile.contactName ||
          contactInfo.name ||
          user?.name ||
          "",
      ),
      contactEmail:
        prev.contactEmail ||
        normalizedProfile.contactEmail ||
        contactInfo.email ||
        user?.email ||
        "",
      contactPhone:
        prev.contactPhone ||
        normalizedProfile.contactPhone ||
        contactInfo.phone ||
        "",
      contactWebsite:
        prev.contactWebsite ||
        normalizedProfile.contactWebsite ||
        contactInfo.website ||
        "",
      contactLinkedin:
        prev.contactLinkedin ||
        normalizedProfile.contactLinkedin ||
        contactInfo.linkedin ||
        "",
    }));
  }, [initialData, existingProfile, user]);

  const { toast } = useToast();
  const totalSteps = 4;

  const addToArray = (field: keyof BusinessProfile, value: string) => {
    const valuesToAdd = parseStringArray(value);

    if (valuesToAdd.length === 0) {
      return false;
    }

    let added = false;

    setProfile((prev) => {
      const currentArray = prev[field] as string[];
      const merged = [...currentArray];

      valuesToAdd.forEach((item) => {
        if (!merged.includes(item)) {
          merged.push(item);
          added = true;
        }
      });

      if (!added) {
        return prev;
      }

      return {
        ...prev,
        [field]: merged,
      };
    });

    return added;
  };

  const removeFromArray = (field: keyof BusinessProfile, value: string) => {
    const currentArray = profile[field] as string[];
    setProfile((prev) => ({
      ...prev,
      [field]: currentArray.filter((item) => item !== value),
    }));
  };

  const handleNext = () => {
    if (currentStep < totalSteps) {
      setCurrentStep((prev) => prev + 1);
    } else {
      handleComplete();
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleComplete = async () => {
    // Basic validation
    const sanitizedContactName = normalizeContactName(profile.contactName);

    if (
      !profile.companyName ||
      !profile.industry ||
      !sanitizedContactName ||
      !profile.valueProposition
    ) {
      toast({
        title: "Missing Information",
        description:
          "Please fill in the required fields (Company Name, Your Name, Industry, Value Proposition).",
        variant: "destructive",
      });
      return;
    }

    const completedProfile = {
      ...profile,
      contactName: sanitizedContactName,
    };

    setIsSaving(true);

    try {
      // Save profile to Convex - map frontend fields to backend schema
      await createOrUpdateProfile({
        companyName: completedProfile.companyName,
        industry: completedProfile.industry,
        services: completedProfile.offerings, // Map offerings to services
        targetMarkets: completedProfile.targetIndustries, // Map targetIndustries to targetMarkets
        valueProposition: completedProfile.valueProposition,
        keyDifferentiators: completedProfile.keyDifferentiators,
        contactInfo: {
          name: sanitizedContactName,
          email: completedProfile.contactEmail,
          phone: completedProfile.contactPhone,
          website: completedProfile.contactWebsite,
          linkedin: completedProfile.contactLinkedin,
        },
      });

      setProfile(completedProfile);
      onComplete(completedProfile);
      toast({
        title: "Profile Saved!",
        description:
          "Your business profile has been saved and will be used to personalize all AI-generated emails.",
      });
    } catch (error) {
      console.error("Error saving profile:", error);
      toast({
        title: "Save Failed",
        description: "Failed to save your profile. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const isStepValid = () => {
    switch (currentStep) {
      case 1:
        return (
          profile.companyName &&
          profile.industry &&
          normalizeContactName(profile.contactName)
        );
      case 2:
        return (
          profile.targetIndustries.length > 0 && profile.offerings.length > 0
        );
      case 3:
        return (
          profile.valueProposition && profile.keyDifferentiators.length > 0
        );
      case 4:
        return profile.idealCustomerProfile;
      default:
        return true;
    }
  };

  const renderStep1 = (opts?: { header?: boolean }) => (
    <div className="space-y-6">
      {(opts?.header ?? true) && (
        <div className="text-center mb-8">
          <Building2 className="h-12 w-12 text-primary mx-auto mb-4" />
          <h2 className="text-2xl font-bold">Company Information</h2>
          <p className="text-muted-foreground">Tell us about your business</p>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <Label htmlFor="companyName" className="text-sm font-medium">
            Company Name *
          </Label>
          <Input
            id="companyName"
            value={profile.companyName}
            onChange={(e) =>
              setProfile((prev) => ({ ...prev, companyName: e.target.value }))
            }
            placeholder="Enter your company name"
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="contactName" className="text-sm font-medium">
            Your Name *
          </Label>
          <p className="text-xs text-muted-foreground mb-2">
            We'll use this name in email signatures and personalization.
          </p>
          <Input
            id="contactName"
            value={profile.contactName}
            onChange={(e) =>
              setProfile((prev) => ({
                ...prev,
                contactName: e.target.value,
              }))
            }
            onBlur={(e) =>
              setProfile((prev) => ({
                ...prev,
                contactName: normalizeContactName(e.target.value),
              }))
            }
            placeholder="e.g., Alex Rivera"
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="industry" className="text-sm font-medium">
            Your Industry *
          </Label>
          <Input
            id="industry"
            value={profile.industry}
            onChange={(e) =>
              setProfile((prev) => ({ ...prev, industry: e.target.value }))
            }
            placeholder="e.g., Software Development, Marketing Agency, E-commerce"
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="toneOfVoice" className="text-sm font-medium">
            Preferred Communication Tone
          </Label>
          <div className="grid grid-cols-3 gap-2 mt-2">
            {["professional", "friendly", "casual"].map((tone) => (
              <Button
                key={tone}
                variant={profile.toneOfVoice === tone ? "default" : "outline"}
                size="sm"
                onClick={() =>
                  setProfile((prev) => ({ ...prev, toneOfVoice: tone }))
                }
                className="capitalize"
              >
                {tone}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const renderStep2 = (opts?: { header?: boolean }) => {
    return (
      <div className="space-y-6">
        {(opts?.header ?? true) && (
          <div className="text-center mb-8">
            <Target className="h-12 w-12 text-primary mx-auto mb-4" />
            <h2 className="text-2xl font-bold">Target Market & Offerings</h2>
            <p className="text-muted-foreground">
              Define who you serve and what you offer
            </p>
          </div>
        )}

        <div className="space-y-6">
          <div>
            <Label className="text-sm font-medium">Target Industries *</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Which industries do you primarily serve?
            </p>
            <div className="flex gap-2 mb-2">
              <Input
                value={newTargetIndustry}
                onChange={(e) => setNewTargetIndustry(e.target.value)}
                placeholder="e.g., SaaS, Healthcare, E-commerce"
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    if (addToArray("targetIndustries", newTargetIndustry)) {
                      setNewTargetIndustry("");
                    }
                  }
                }}
                onBlur={() => {
                  if (addToArray("targetIndustries", newTargetIndustry)) {
                    setNewTargetIndustry("");
                  }
                }}
              />
              <Button
                onClick={() => {
                  if (addToArray("targetIndustries", newTargetIndustry)) {
                    setNewTargetIndustry("");
                  }
                }}
                size="sm"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {profile.targetIndustries.map((industry) => (
                <Badge
                  key={industry}
                  variant="secondary"
                  className="flex items-center gap-1"
                >
                  {industry}
                  <X
                    className="h-3 w-3 cursor-pointer"
                    onClick={() =>
                      removeFromArray("targetIndustries", industry)
                    }
                  />
                </Badge>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-sm font-medium">Your Offerings *</Label>
            <p className="text-xs text-muted-foreground mb-2">
              What products or services do you provide?
            </p>
            <div className="flex gap-2 mb-2">
              <Input
                value={newOffering}
                onChange={(e) => setNewOffering(e.target.value)}
                placeholder="e.g., Web Development, SEO Services, AI Consulting"
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    if (addToArray("offerings", newOffering)) {
                      setNewOffering("");
                    }
                  }
                }}
                onBlur={() => {
                  if (addToArray("offerings", newOffering)) {
                    setNewOffering("");
                  }
                }}
              />
              <Button
                onClick={() => {
                  if (addToArray("offerings", newOffering)) {
                    setNewOffering("");
                  }
                }}
                size="sm"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {profile.offerings.map((offering) => (
                <Badge
                  key={offering}
                  variant="secondary"
                  className="flex items-center gap-1"
                >
                  {offering}
                  <X
                    className="h-3 w-3 cursor-pointer"
                    onClick={() => removeFromArray("offerings", offering)}
                  />
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderStep3 = () => {
    return (
      <div className="space-y-6">
        <div className="text-center mb-8">
          <Sparkles className="h-12 w-12 text-primary mx-auto mb-4" />
          <h2 className="text-2xl font-bold">Value Proposition</h2>
          <p className="text-muted-foreground">
            What makes you unique and valuable?
          </p>
        </div>

        <div className="space-y-6">
          <div>
            <Label htmlFor="valueProposition" className="text-sm font-medium">
              Core Value Proposition *
            </Label>
            <p className="text-xs text-muted-foreground mb-2">
              In 1-2 sentences, describe the main value you provide to clients
            </p>
            <Textarea
              id="valueProposition"
              value={profile.valueProposition}
              onChange={(e) =>
                setProfile((prev) => ({
                  ...prev,
                  valueProposition: e.target.value,
                }))
              }
              placeholder="We help growing businesses scale their operations through AI-powered automation solutions that reduce manual work by 60% while improving accuracy and customer satisfaction."
              className="min-h-[80px]"
            />
          </div>

          <div>
            <Label className="text-sm font-medium">Key Differentiators *</Label>
            <p className="text-xs text-muted-foreground mb-2">
              What sets you apart from competitors?
            </p>
            <div className="flex gap-2 mb-2">
              <Input
                value={newDifferentiator}
                onChange={(e) => setNewDifferentiator(e.target.value)}
                placeholder="e.g., 24/7 support, AI-powered solutions, 10+ years experience"
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    if (addToArray("keyDifferentiators", newDifferentiator)) {
                      setNewDifferentiator("");
                    }
                  }
                }}
                onBlur={() => {
                  if (addToArray("keyDifferentiators", newDifferentiator)) {
                    setNewDifferentiator("");
                  }
                }}
              />
              <Button
                onClick={() => {
                  if (addToArray("keyDifferentiators", newDifferentiator)) {
                    setNewDifferentiator("");
                  }
                }}
                size="sm"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {profile.keyDifferentiators.map((diff) => (
                <Badge
                  key={diff}
                  variant="secondary"
                  className="flex items-center gap-1"
                >
                  {diff}
                  <X
                    className="h-3 w-3 cursor-pointer"
                    onClick={() => removeFromArray("keyDifferentiators", diff)}
                  />
                </Badge>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-sm font-medium">Pain Points You Solve</Label>
            <p className="text-xs text-muted-foreground mb-2">
              What problems do your clients typically face before working with
              you?
            </p>
            <div className="flex gap-2 mb-2">
              <Input
                value={newPainPoint}
                onChange={(e) => setNewPainPoint(e.target.value)}
                placeholder="e.g., Manual processes, Poor lead quality, High customer acquisition costs"
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    if (addToArray("painPointsWeSolve", newPainPoint)) {
                      setNewPainPoint("");
                    }
                  }
                }}
                onBlur={() => {
                  if (addToArray("painPointsWeSolve", newPainPoint)) {
                    setNewPainPoint("");
                  }
                }}
              />
              <Button
                onClick={() => {
                  if (addToArray("painPointsWeSolve", newPainPoint)) {
                    setNewPainPoint("");
                  }
                }}
                size="sm"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {profile.painPointsWeSolve.map((pain) => (
                <Badge
                  key={pain}
                  variant="secondary"
                  className="flex items-center gap-1"
                >
                  {pain}
                  <X
                    className="h-3 w-3 cursor-pointer"
                    onClick={() => removeFromArray("painPointsWeSolve", pain)}
                  />
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderStep4 = (opts?: { header?: boolean }) => {
    return (
      <div className="space-y-6">
        {(opts?.header ?? true) && (
          <div className="text-center mb-8">
            <MessageSquare className="h-12 w-12 text-primary mx-auto mb-4" />
            <h2 className="text-2xl font-bold">Ideal Customer & Challenges</h2>
            <p className="text-muted-foreground">
              Help us understand your perfect client
            </p>
          </div>
        )}

        <div className="space-y-6">
          <div>
            <Label
              htmlFor="idealCustomerProfile"
              className="text-sm font-medium"
            >
              Ideal Customer Profile *
            </Label>
            <p className="text-xs text-muted-foreground mb-2">
              Describe your ideal customer in detail (company size, role,
              challenges, goals)
            </p>
            <Textarea
              id="idealCustomerProfile"
              value={profile.idealCustomerProfile}
              onChange={(e) =>
                setProfile((prev) => ({
                  ...prev,
                  idealCustomerProfile: e.target.value,
                }))
              }
              placeholder="Growing SaaS companies with 50-200 employees, led by founders or VPs of Marketing who are struggling to scale their lead generation processes while maintaining personalization. They typically have strong product-market fit but need help optimizing their sales funnel and improving conversion rates."
              className="min-h-[120px]"
            />
          </div>

          <div>
            <Label className="text-sm font-medium">
              Current Business Challenges
            </Label>
            <p className="text-xs text-muted-foreground mb-2">
              What challenges are you currently facing in your business?
            </p>
            <div className="flex gap-2 mb-2">
              <Input
                value={newChallenge}
                onChange={(e) => setNewChallenge(e.target.value)}
                placeholder="e.g., Scaling lead generation, Improving conversion rates, Reducing manual work"
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    if (addToArray("currentChallenges", newChallenge)) {
                      setNewChallenge("");
                    }
                  }
                }}
                onBlur={() => {
                  if (addToArray("currentChallenges", newChallenge)) {
                    setNewChallenge("");
                  }
                }}
              />
              <Button
                onClick={() => {
                  if (addToArray("currentChallenges", newChallenge)) {
                    setNewChallenge("");
                  }
                }}
                size="sm"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {profile.currentChallenges.map((challenge) => (
                <Badge
                  key={challenge}
                  variant="secondary"
                  className="flex items-center gap-1"
                >
                  {challenge}
                  <X
                    className="h-3 w-3 cursor-pointer"
                    onClick={() =>
                      removeFromArray("currentChallenges", challenge)
                    }
                  />
                </Badge>
              ))}
            </div>
          </div>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              This information will help our AI agents create highly
              personalized emails that resonate with your prospects and speak
              directly to their needs.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  };

  // Editor mode: show all sections at once with a single save
  if (variant === "editor") {
    const isEditorValid = () => {
      return (
        !!profile.companyName &&
        !!profile.industry &&
        !!profile.valueProposition
      );
    };

    return (
      <div className="max-w-3xl mx-auto p-6">
        <Card className="p-4">
          <Accordion type="multiple" defaultValue={[]} className="w-full">
            <AccordionItem value="company">
              <AccordionTrigger>
                <div className="text-left flex items-center gap-3">
                  <Building2 className="h-4 w-4 text-primary" />
                  <div>
                    <div className="font-semibold">Company Information</div>
                    <div className="text-xs text-muted-foreground">
                      Name, industry, tone of voice
                    </div>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="pt-4">{renderStep1({ header: false })}</div>
              </AccordionContent>
            </AccordionItem>

            <Separator className="my-2" />

            <AccordionItem value="market">
              <AccordionTrigger>
                <div className="text-left flex items-center gap-3">
                  <Target className="h-4 w-4 text-primary" />
                  <div>
                    <div className="font-semibold">
                      Target Market & Offerings
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Industries served and services offered
                    </div>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="pt-4">{renderStep2({ header: false })}</div>
              </AccordionContent>
            </AccordionItem>

            <Separator className="my-2" />

            <AccordionItem value="value">
              <AccordionTrigger>
                <div className="text-left flex items-center gap-3">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <div>
                    <div className="font-semibold">Value Proposition</div>
                    <div className="text-xs text-muted-foreground">
                      Differentiators and pain points you solve
                    </div>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="pt-4">{renderStep3({ header: false })}</div>
              </AccordionContent>
            </AccordionItem>

            <Separator className="my-2" />

            <AccordionItem value="ideal">
              <AccordionTrigger>
                <div className="text-left flex items-center gap-3">
                  <MessageSquare className="h-4 w-4 text-primary" />
                  <div>
                    <div className="font-semibold">
                      Ideal Customer & Challenges
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Ideal customer profile and current challenges
                    </div>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="pt-4">{renderStep4({ header: false })}</div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <div className="flex items-center justify-end pt-6">
            <Button
              onClick={handleComplete}
              disabled={!isEditorValid() || isSaving}
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // Default wizard mode
  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-3xl font-bold">Business Profile Setup</h1>
          {onSkip && (
            <Button variant="ghost" onClick={onSkip}>
              Skip for now
            </Button>
          )}
        </div>

        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground">
            Step {currentStep} of {totalSteps}
          </span>
          <span className="text-sm text-muted-foreground">
            {Math.round((currentStep / totalSteps) * 100)}% complete
          </span>
        </div>

        <Progress value={(currentStep / totalSteps) * 100} className="h-2" />
      </div>

      <Card className="p-8">
        {currentStep === 1 && renderStep1()}
        {currentStep === 2 && renderStep2()}
        {currentStep === 3 && renderStep3()}
        {currentStep === 4 && renderStep4()}

        <Separator className="my-8" />

        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            onClick={handlePrevious}
            disabled={currentStep === 1}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Previous
          </Button>

          <div className="flex items-center gap-2">
            {Array.from({ length: totalSteps }, (_, i) => (
              <div
                key={i}
                className={`h-2 w-8 rounded-full ${
                  i + 1 <= currentStep ? "bg-primary" : "bg-muted"
                }`}
              />
            ))}
          </div>

          <Button
            onClick={handleNext}
            disabled={!isStepValid() || isSaving}
            className="flex items-center gap-2"
          >
            {currentStep === totalSteps ? (
              <>
                <CheckCircle className="h-4 w-4" />
                {isSaving ? "Saving..." : "Complete Setup"}
              </>
            ) : (
              <>
                Next
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </Card>
    </div>
  );
}
