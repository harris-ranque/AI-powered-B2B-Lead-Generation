import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useMutation } from "convex/react";
import { api } from "@genni/convex-types";
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
  Sparkles,
  Info,
  AlertTriangle,
  Plus,
  X,
  Mail,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useProfile } from "@/hooks/useProfile";
import { createLogger } from "@/utils/logger";
import { normalizeError } from "@/utils/errorUtils";

// TODO: Future enhancements - Add these fields when LangGraph integration is ready:
// - toneOfVoice: string (professional/friendly/casual) - for email generation
// - painPointsWeSolve: string[] - for better AI personalization
// - idealCustomerProfile: string - for lead qualification
// - currentChallenges: string[] - for value proposition matching

// Business rules for array limits
const LIMITS = {
  MAX_SERVICES: 20,
  MAX_TARGET_MARKETS: 15,
  MAX_DIFFERENTIATORS: 10,
  VALUE_PROPOSITION_MIN: 50,
  VALUE_PROPOSITION_MAX: 500,
} as const;

// Validation helpers
const isValidUrl = (url: string): boolean => {
  if (!url.trim()) return true; // Optional field
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === "http:" || urlObj.protocol === "https:";
  } catch {
    return false;
  }
};

const isValidPhone = (phone: string): boolean => {
  if (!phone.trim()) return true; // Optional field
  // Basic phone validation - allows international formats
  const phoneRegex = /^[+]?[(]?[0-9]{1,4}[)]?[-\s.]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,9}$/;
  return phoneRegex.test(phone.replace(/\s/g, ""));
};

// Validation logic consolidated
const validateField = (
  field: keyof BusinessProfile,
  value: string | string[],
): string | null => {
  switch (field) {
    case "companyName":
      return !value || !(value as string).trim()
        ? "Company name is required"
        : null;

    case "contactName":
      return !value || !normalizeContactName(value as string)
        ? "Contact name is required"
        : null;

    case "industry":
      return !value || !(value as string).trim()
        ? "Industry is required"
        : null;

    case "targetMarkets":
      return (value as string[]).length === 0
        ? "At least one target market is required"
        : null;

    case "services":
      return (value as string[]).length === 0
        ? "At least one service is required"
        : null;

    case "valueProposition": {
      const str = value as string;
      if (!str.trim()) return "Value proposition is required";
      if (str.length < LIMITS.VALUE_PROPOSITION_MIN) {
        return `Must be at least ${LIMITS.VALUE_PROPOSITION_MIN} characters`;
      }
      if (str.length > LIMITS.VALUE_PROPOSITION_MAX) {
        return `Must not exceed ${LIMITS.VALUE_PROPOSITION_MAX} characters`;
      }
      return null;
    }

    case "keyDifferentiators":
      return (value as string[]).length === 0
        ? "At least one differentiator is required"
        : null;

    case "contactPhone":
      return value && !isValidPhone(value as string)
        ? "Invalid phone number format"
        : null;

    case "contactWebsite":
      return value && !isValidUrl(value as string)
        ? "Invalid URL format (e.g., https://example.com)"
        : null;

    case "contactLinkedin":
      return value && !isValidUrl(value as string)
        ? "Invalid URL format (e.g., https://linkedin.com/in/profile)"
        : null;

    default:
      return null;
  }
};

interface BusinessProfile {
  companyName: string;
  industry: string;
  targetMarkets: string[];
  services: string[];
  valueProposition: string;
  keyDifferentiators: string[];
  contactName: string;
  contactPhone: string;
  contactWebsite: string;
  contactLinkedin: string;
}

type IncomingProfile = Partial<BusinessProfile> & {
  contactInfo?: {
    name?: string;
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

const wizardLogger = createLogger("BusinessProfileWizard");

// Reusable Array Input Component
interface ArrayInputProps {
  label: string;
  description: string;
  placeholder: string;
  values: string[];
  onAdd: (value: string) => boolean;
  onRemove: (value: string) => void;
  maxItems: number;
  fieldName: string;
  onDuplicateDetected?: () => void;
}

function ArrayInput({
  label,
  description,
  placeholder,
  values,
  onAdd,
  onRemove,
  maxItems,
  fieldName,
  onDuplicateDetected,
}: ArrayInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [showDuplicateMessage, setShowDuplicateMessage] = useState(false);
  const isAtLimit = values.length >= maxItems;

  const handleAdd = () => {
    const trimmedValue = inputValue.trim();
    if (!trimmedValue) return;

    // Check for duplicates before adding
    if (values.includes(trimmedValue)) {
      setShowDuplicateMessage(true);
      setTimeout(() => setShowDuplicateMessage(false), 3000);
      onDuplicateDetected?.();
      return;
    }

    if (onAdd(trimmedValue)) {
      setInputValue("");
      setShowDuplicateMessage(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div>
      <Label htmlFor={fieldName} className="text-sm font-medium">
        {label} *
      </Label>
      <p className="text-xs text-muted-foreground mb-2">{description}</p>

      {showDuplicateMessage && (
        <Alert className="mb-2">
          <Info className="h-4 w-4" />
          <AlertDescription>
            This item already exists in your list.
          </AlertDescription>
        </Alert>
      )}

      {isAtLimit && !showDuplicateMessage && (
        <Alert className="mb-2">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Maximum limit of {maxItems} items reached. Remove an item to add more.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex gap-2 mb-2">
        <Input
          id={fieldName}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`${placeholder} (Press Enter to add)`}
          disabled={isAtLimit}
          aria-label={label}
          aria-describedby={`${fieldName}-description`}
        />
        <Button
          onClick={handleAdd}
          size="sm"
          disabled={!inputValue.trim() || isAtLimit}
          aria-label={`Add ${label.toLowerCase()}`}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-wrap gap-2" role="list" aria-label={`${label} list`}>
        {values.map((value) => (
          <Badge
            key={value}
            variant="secondary"
            className="flex items-center gap-1"
            role="listitem"
          >
            {value}
            <button
              onClick={() => onRemove(value)}
              className="ml-1 hover:bg-muted rounded-sm focus:outline-none focus:ring-2 focus:ring-primary"
              aria-label={`Remove ${value}`}
              type="button"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>

      <p className="text-xs text-muted-foreground mt-1">
        {values.length} / {maxItems} items
      </p>
    </div>
  );
}

export function BusinessProfileWizard({
  onComplete,
  onSkip,
  initialData,
  variant = "wizard",
}: BusinessProfileWizardProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // Convex hooks
  const { profile: existingProfile, createOrUpdateProfile } = useProfile();
  const { user } = useAuth();
  const updateUserProfile = useMutation(api.users.mutations.updateProfile);
  const { toast } = useToast();

  const initialContactInfo =
    (existingProfile?.contactInfo as {
      name?: string;
      phone?: string;
      website?: string;
      linkedin?: string;
    } | null | undefined) ??
    (initialData as IncomingProfile | undefined)?.contactInfo;

  // Initialize profile from initialData or existingProfile
  const [profile, setProfile] = useState<BusinessProfile>(() => {
    return {
      companyName:
        initialData?.companyName ?? existingProfile?.companyName ?? "",
      industry: initialData?.industry ?? existingProfile?.industry ?? "",
      targetMarkets: resolveArray(
        initialData?.targetMarkets,
        existingProfile?.targetMarkets,
      ),
      services: resolveArray(initialData?.services, existingProfile?.services),
      valueProposition:
        initialData?.valueProposition ??
        existingProfile?.valueProposition ??
        "",
      keyDifferentiators: resolveArray(
        initialData?.keyDifferentiators,
        existingProfile?.keyDifferentiators,
      ),
      contactName: normalizeContactName(
        initialData?.contactName ??
          initialContactInfo?.name ??
          user?.name ??
          "",
      ),
      contactPhone:
        initialData?.contactPhone ?? initialContactInfo?.phone ?? "",
      contactWebsite:
        initialData?.contactWebsite ?? initialContactInfo?.website ?? "",
      contactLinkedin:
        initialData?.contactLinkedin ?? initialContactInfo?.linkedin ?? "",
    };
  });

  const totalSteps = 4;

  const addToArray = (field: keyof BusinessProfile, value: string): boolean => {
    const valuesToAdd = parseStringArray(value);

    if (valuesToAdd.length === 0) {
      return false;
    }

    let added = false;
    const currentArray = profile[field] as string[];

    // Check limits
    const limits: Record<string, number> = {
      targetMarkets: LIMITS.MAX_TARGET_MARKETS,
      services: LIMITS.MAX_SERVICES,
      keyDifferentiators: LIMITS.MAX_DIFFERENTIATORS,
    };

    const limit = limits[field];
    if (limit && currentArray.length >= limit) {
      return false;
    }

    setProfile((prev) => {
      const current = prev[field] as string[];
      const merged = [...current];

      valuesToAdd.forEach((item) => {
        if (!merged.includes(item) && merged.length < (limit || Infinity)) {
          merged.push(item);
          added = true;
        }
      });

      if (!added) {
        return prev;
      }

      const newProfile = {
        ...prev,
        [field]: merged,
      };

      // Real-time validation
      const error = validateField(field, merged);
      setValidationErrors((errors) => {
        const newErrors = { ...errors };
        if (error) {
          newErrors[field] = error;
        } else {
          delete newErrors[field];
        }
        return newErrors;
      });

      return newProfile;
    });

    return added;
  };

  const removeFromArray = (field: keyof BusinessProfile, value: string) => {
    setProfile((prev) => {
      const currentArray = prev[field] as string[];
      const newArray = currentArray.filter((item) => item !== value);

      // Real-time validation
      const error = validateField(field, newArray);
      setValidationErrors((errors) => {
        const newErrors = { ...errors };
        if (error) {
          newErrors[field] = error;
        } else {
          delete newErrors[field];
        }
        return newErrors;
      });

      return {
        ...prev,
        [field]: newArray,
      };
    });
  };

  // Real-time validation for text fields
  const updateField = (
    field: keyof BusinessProfile,
    value: string | string[],
  ) => {
    setProfile((prev) => ({ ...prev, [field]: value }));

    // Validate immediately
    const error = validateField(field, value);
    setValidationErrors((errors) => {
      const newErrors = { ...errors };
      if (error) {
        newErrors[field] = error;
      } else {
        delete newErrors[field];
      }
      return newErrors;
    });
  };

  const STEP_FIELD_MAP: Record<number, Array<keyof BusinessProfile>> = {
    1: ["companyName", "contactName", "industry"],
    2: ["targetMarkets", "services"],
    3: ["valueProposition", "keyDifferentiators"],
    4: ["contactPhone", "contactWebsite", "contactLinkedin"],
  };

  const buildStepErrors = useCallback(
    (step: number) => {
      const errors: Record<string, string> = {};
      const fieldsToValidate = STEP_FIELD_MAP[step] ?? [];

      fieldsToValidate.forEach((field) => {
        const value = profile[field];
        const error = validateField(field, value);
        if (error) {
          errors[field] = error;
        }
      });

      return errors;
    },
    [profile],
  );

  const validateStep = useCallback(
    (step: number): boolean => {
      const errors = buildStepErrors(step);
      setValidationErrors(errors);
      return Object.keys(errors).length === 0;
    },
    [buildStepErrors],
  );

  const isCurrentStepValid = useMemo(
    () => Object.keys(buildStepErrors(currentStep)).length === 0,
    [buildStepErrors, currentStep],
  );

  const handleNext = async () => {
    if (!validateStep(currentStep)) {
      return;
    }

    // Save current step data
    setIsSaving(true);
    setSaveError(null);

    try {
      const sanitizedContactName = normalizeContactName(profile.contactName);

      // Update user's name if it changed
      if (sanitizedContactName && sanitizedContactName !== user?.name) {
        try {
          await updateUserProfile({ name: sanitizedContactName });
          wizardLogger.info("Updated user profile name");
        } catch (userError) {
          wizardLogger.warn("Failed to update user name, continuing", userError);
        }
      }

      // Save current state to Convex
      await createOrUpdateProfile({
        companyName: profile.companyName,
        industry: profile.industry,
        services: profile.services,
        targetMarkets: profile.targetMarkets,
        valueProposition: profile.valueProposition,
        keyDifferentiators: profile.keyDifferentiators,
        contactInfo: {
          name: sanitizedContactName,
          phone: profile.contactPhone,
          website: profile.contactWebsite,
          linkedin: profile.contactLinkedin,
        },
      });

      wizardLogger.info(`Step ${currentStep} saved successfully`);

      // Move to next step or complete
      if (currentStep < totalSteps) {
        setCurrentStep((prev) => prev + 1);
      } else {
        // Final step - call onComplete
        onComplete({
          ...profile,
          contactName: sanitizedContactName,
        });

        toast({
          title: "Profile Saved!",
          description:
            "Your business profile has been saved and will be used to personalize all AI-generated emails.",
        });
      }
    } catch (error) {
      const normalizedError = normalizeError(
        error,
        "Failed to save your profile. Please try again.",
      );
      const errorInstance =
        error instanceof Error ? error : new Error(String(error));
      wizardLogger.error(
        `Failed to save step ${currentStep}`,
        {
          code: normalizedError.code,
          statusCode: normalizedError.statusCode,
          step: currentStep,
        },
        errorInstance,
      );
      setSaveError(normalizedError.message);
      toast({
        title: "Save Failed",
        description: normalizedError.message,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep((prev) => prev - 1);
      setSaveError(null);
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
            onChange={(e) => updateField("companyName", e.target.value)}
            placeholder="e.g., Acme Corporation"
            className="mt-1"
            aria-invalid={!!validationErrors.companyName}
            aria-describedby={validationErrors.companyName ? "companyName-error" : undefined}
          />
          {validationErrors.companyName && (
            <p id="companyName-error" className="text-sm text-destructive mt-1">
              {validationErrors.companyName}
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="contactName" className="text-sm font-medium">
            Contact Name *
          </Label>
          <p className="text-xs text-muted-foreground mb-2">
            This name will appear in email signatures and personalization.
          </p>
          <Input
            id="contactName"
            value={profile.contactName}
            onChange={(e) => updateField("contactName", e.target.value)}
            onBlur={(e) =>
              setProfile((prev) => ({
                ...prev,
                contactName: normalizeContactName(e.target.value),
              }))
            }
            placeholder="e.g., Alex Rivera"
            className="mt-1"
            aria-invalid={!!validationErrors.contactName}
            aria-describedby={validationErrors.contactName ? "contactName-error" : undefined}
          />
          {validationErrors.contactName && (
            <p id="contactName-error" className="text-sm text-destructive mt-1">
              {validationErrors.contactName}
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="industry" className="text-sm font-medium">
            Industry *
          </Label>
          <Input
            id="industry"
            value={profile.industry}
            onChange={(e) => updateField("industry", e.target.value)}
            placeholder="e.g., Software Development, Marketing Agency, E-commerce"
            className="mt-1"
            aria-invalid={!!validationErrors.industry}
            aria-describedby={validationErrors.industry ? "industry-error" : undefined}
          />
          {validationErrors.industry && (
            <p id="industry-error" className="text-sm text-destructive mt-1">
              {validationErrors.industry}
            </p>
          )}
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
            <h2 className="text-2xl font-bold">Target Markets & Services</h2>
            <p className="text-muted-foreground">
              Define who you serve and what you offer
            </p>
          </div>
        )}

        <div className="space-y-6">
          <div>
            <ArrayInput
              label="Target Markets"
              description="Industries or market segments you primarily serve."
              placeholder="e.g., SaaS Companies, Healthcare, E-commerce"
              values={profile.targetMarkets}
              onAdd={(value) => addToArray("targetMarkets", value)}
              onRemove={(value) => removeFromArray("targetMarkets", value)}
              maxItems={LIMITS.MAX_TARGET_MARKETS}
              fieldName="targetMarkets"
            />
            {validationErrors.targetMarkets && (
              <p className="text-sm text-destructive mt-1">
                {validationErrors.targetMarkets}
              </p>
            )}
          </div>

          <div>
            <ArrayInput
              label="Services"
              description="Products or services you provide to clients."
              placeholder="e.g., Web Development, SEO Services, AI Consulting"
              values={profile.services}
              onAdd={(value) => addToArray("services", value)}
              onRemove={(value) => removeFromArray("services", value)}
              maxItems={LIMITS.MAX_SERVICES}
              fieldName="services"
            />
            {validationErrors.services && (
              <p className="text-sm text-destructive mt-1">
                {validationErrors.services}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderStep3 = (opts?: { header?: boolean }) => {
    const charCount = profile.valueProposition.length;
    const minChars = LIMITS.VALUE_PROPOSITION_MIN;
    const maxChars = LIMITS.VALUE_PROPOSITION_MAX;
    const isTooShort = charCount > 0 && charCount < minChars;
    const isValid = charCount >= minChars && charCount <= maxChars;
    const isTooLong = charCount > maxChars;

    return (
      <div className="space-y-6">
        {(opts?.header ?? true) && (
          <div className="text-center mb-8">
            <Sparkles className="h-12 w-12 text-primary mx-auto mb-4" />
            <h2 className="text-2xl font-bold">Value Proposition</h2>
            <p className="text-muted-foreground">
              What makes you unique and valuable?
            </p>
          </div>
        )}

        <div className="space-y-6">
          <div>
            <Label htmlFor="valueProposition" className="text-sm font-medium">
              Value Proposition *
            </Label>
            <p className="text-xs text-muted-foreground mb-2">
              Main value you provide to clients ({minChars}-{maxChars} characters).
            </p>
            <Textarea
              id="valueProposition"
              value={profile.valueProposition}
              onChange={(e) => updateField("valueProposition", e.target.value)}
              placeholder="We help growing businesses scale their operations through AI-powered automation solutions that reduce manual work by 60% while improving accuracy and customer satisfaction."
              className="min-h-[100px]"
              aria-invalid={!!validationErrors.valueProposition}
              aria-describedby="valueProposition-count"
            />
            <div className="flex items-center justify-between mt-1">
              <span
                id="valueProposition-count"
                className={`text-xs ${
                  isTooLong
                    ? "text-destructive"
                    : isTooShort
                    ? "text-orange-600 dark:text-orange-400"
                    : isValid
                    ? "text-green-600 dark:text-green-400"
                    : "text-muted-foreground"
                }`}
              >
                {charCount} / {maxChars} characters
              </span>
              {isValid && (
                <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                  <CheckCircle className="h-3 w-3" />
                  Good length
                </span>
              )}
            </div>
            {validationErrors.valueProposition && (
              <p className="text-sm text-destructive mt-1">
                {validationErrors.valueProposition}
              </p>
            )}
          </div>

          <div>
            <ArrayInput
              label="Key Differentiators"
              description="Unique strengths that set you apart from competitors."
              placeholder="e.g., 24/7 Support, AI-Powered Solutions, 10+ Years Experience"
              values={profile.keyDifferentiators}
              onAdd={(value) => addToArray("keyDifferentiators", value)}
              onRemove={(value) => removeFromArray("keyDifferentiators", value)}
              maxItems={LIMITS.MAX_DIFFERENTIATORS}
              fieldName="keyDifferentiators"
            />
            {validationErrors.keyDifferentiators && (
              <p className="text-sm text-destructive mt-1">
                {validationErrors.keyDifferentiators}
              </p>
            )}
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
            <Mail className="h-12 w-12 text-primary mx-auto mb-4" />
            <h2 className="text-2xl font-bold">Contact Information</h2>
            <p className="text-muted-foreground">
              Additional contact details for prospects
            </p>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <Label htmlFor="contactPhone" className="text-sm font-medium">
              Phone Number (optional)
            </Label>
            <Input
              id="contactPhone"
              value={profile.contactPhone}
              onChange={(e) => updateField("contactPhone", e.target.value)}
              placeholder="e.g., +1 (555) 123-4567"
              className="mt-1"
              type="tel"
              aria-invalid={!!validationErrors.contactPhone}
            />
            {validationErrors.contactPhone && (
              <p className="text-sm text-destructive mt-1">
                {validationErrors.contactPhone}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="contactWebsite" className="text-sm font-medium">
              Website (optional)
            </Label>
            <Input
              id="contactWebsite"
              value={profile.contactWebsite}
              onChange={(e) => updateField("contactWebsite", e.target.value)}
              placeholder="e.g., https://yourcompany.com"
              className="mt-1"
              type="url"
              aria-invalid={!!validationErrors.contactWebsite}
            />
            {validationErrors.contactWebsite && (
              <p className="text-sm text-destructive mt-1">
                {validationErrors.contactWebsite}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="contactLinkedin" className="text-sm font-medium">
              LinkedIn Profile (optional)
            </Label>
            <Input
              id="contactLinkedin"
              value={profile.contactLinkedin}
              onChange={(e) => updateField("contactLinkedin", e.target.value)}
              placeholder="e.g., https://linkedin.com/in/yourprofile"
              className="mt-1"
              type="url"
              aria-invalid={!!validationErrors.contactLinkedin}
            />
            {validationErrors.contactLinkedin && (
              <p className="text-sm text-destructive mt-1">
                {validationErrors.contactLinkedin}
              </p>
            )}
          </div>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              This contact information will appear in your email signatures.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  };

  // Editor mode: show all sections at once with a single save
  if (variant === "editor") {
    const isEditorValid = () => {
      const allFields: Array<keyof BusinessProfile> = [
        "companyName",
        "contactName",
        "industry",
        "targetMarkets",
        "services",
        "valueProposition",
        "keyDifferentiators",
        "contactPhone",
        "contactWebsite",
        "contactLinkedin",
      ];

      return allFields.every((field) => {
        const value = profile[field];
        const error = validateField(field, value);
        return !error;
      });
    };

    const handleEditorSave = async () => {
      if (!isEditorValid()) return;

      setIsSaving(true);
      setSaveError(null);

      try {
        const sanitizedContactName = normalizeContactName(profile.contactName);

        if (sanitizedContactName && sanitizedContactName !== user?.name) {
          try {
            await updateUserProfile({ name: sanitizedContactName });
            wizardLogger.info("Updated user profile name");
          } catch (userError) {
            wizardLogger.warn("Failed to update user name, continuing", userError);
          }
        }

        await createOrUpdateProfile({
          companyName: profile.companyName,
          industry: profile.industry,
          services: profile.services,
          targetMarkets: profile.targetMarkets,
          valueProposition: profile.valueProposition,
          keyDifferentiators: profile.keyDifferentiators,
          contactInfo: {
            name: sanitizedContactName,
            phone: profile.contactPhone,
            website: profile.contactWebsite,
            linkedin: profile.contactLinkedin,
          },
        });

        wizardLogger.info("Profile saved successfully");
        onComplete({
          ...profile,
          contactName: sanitizedContactName,
        });

        toast({
          title: "Profile Saved!",
          description:
            "Your business profile has been saved and will be used to personalize all AI-generated emails.",
        });
      } catch (error) {
        const normalizedError = normalizeError(
          error,
          "Failed to save your profile. Please try again.",
        );
        const errorInstance =
          error instanceof Error ? error : new Error(String(error));
        wizardLogger.error(
          "Failed to save business profile",
          {
            code: normalizedError.code,
            statusCode: normalizedError.statusCode,
          },
          errorInstance,
        );
        setSaveError(normalizedError.message);
        toast({
          title: "Save Failed",
          description: normalizedError.message,
          variant: "destructive",
        });
      } finally {
        setIsSaving(false);
      }
    };

    return (
      <div className="max-w-3xl mx-auto p-6">
        {saveError && (
          <Alert variant="destructive" className="mb-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{saveError}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSaveError(null)}
              >
                Dismiss
              </Button>
            </AlertDescription>
          </Alert>
        )}
        <Card className="p-4">
          <Accordion
            type="multiple"
            defaultValue={["company", "market", "value", "contact"]}
            className="w-full"
          >
            <AccordionItem value="company">
              <AccordionTrigger>
                <div className="text-left flex items-center gap-3">
                  <Building2 className="h-4 w-4 text-primary" />
                  <div>
                    <div className="font-semibold">Company Information</div>
                    <div className="text-xs text-muted-foreground">
                      Name, industry, contact person
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
                      Target Markets & Services
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Markets served and services offered
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
                      Differentiators and core value
                    </div>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="pt-4">{renderStep3({ header: false })}</div>
              </AccordionContent>
            </AccordionItem>

            <Separator className="my-2" />

            <AccordionItem value="contact">
              <AccordionTrigger>
                <div className="text-left flex items-center gap-3">
                  <Mail className="h-4 w-4 text-primary" />
                  <div>
                    <div className="font-semibold">Contact Information</div>
                    <div className="text-xs text-muted-foreground">
                      Email, phone, website, LinkedIn
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
              onClick={handleEditorSave}
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
      {saveError && (
        <Alert variant="destructive" className="mb-6">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{saveError}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSaveError(null)}
            >
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-3xl font-bold">Business Profile Setup</h1>
          {onSkip && (
            <Button
              variant="ghost"
              onClick={onSkip}
              aria-label="Skip profile setup for now"
            >
              Skip for now
            </Button>
          )}
        </div>
        {onSkip && (
          <Alert className="mb-4">
            <Info className="h-4 w-4" />
            <AlertDescription className="text-sm">
              You can skip setup and access your dashboard, but you'll need to complete your profile before creating lead searches.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground">
            Step {currentStep} of {totalSteps}
          </span>
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {Math.round((currentStep / totalSteps) * 100)}% complete
          </span>
        </div>

        <Progress
          value={(currentStep / totalSteps) * 100}
          className="h-2"
          aria-label={`Progress: Step ${currentStep} of ${totalSteps}`}
        />
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
            aria-label="Go to previous step"
          >
            <ArrowLeft className="h-4 w-4" />
            Previous
          </Button>

          <div className="flex items-center gap-2" role="navigation" aria-label="Step indicator">
            {Array.from({ length: totalSteps }, (_, i) => (
              <div
                key={i}
                className={`h-2 w-8 rounded-full ${
                  i + 1 <= currentStep ? "bg-primary" : "bg-muted"
                }`}
                aria-label={`Step ${i + 1}${i + 1 === currentStep ? " (current)" : i + 1 < currentStep ? " (completed)" : ""}`}
              />
            ))}
          </div>

          <Button
            onClick={handleNext}
            disabled={isSaving || !isCurrentStepValid}
            className="flex items-center gap-2"
            aria-label={currentStep === totalSteps ? "Complete setup" : "Go to next step"}
          >
            {currentStep === totalSteps ? (
              <>
                <CheckCircle className="h-4 w-4" />
                {isSaving ? "Saving..." : "Complete Setup"}
              </>
            ) : (
              <>
                {isSaving ? "Saving..." : "Next"}
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </Card>
    </div>
  );
}
