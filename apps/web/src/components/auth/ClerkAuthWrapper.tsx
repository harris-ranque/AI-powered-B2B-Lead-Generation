import { SignIn, SignUp, UserButton } from "@clerk/clerk-react";
import { ReactNode } from "react";

// Minimal local type to satisfy ESLint/TS for Clerk's additionalSignUpFields
interface AdditionalSignUpField {
  name: string;
  type?: "checkbox" | "text" | "email" | "password";
  label?: string;
  placeholder?: string;
  required?: boolean;
}

interface ClerkAuthWrapperProps {
  children?: ReactNode;
  mode?: "signin" | "signup";
  redirectUrl?: string;
}

export function ClerkAuthWrapper({
  children,
  mode = "signin",
  redirectUrl,
}: ClerkAuthWrapperProps) {
  if (mode === "signup") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-full max-w-md" data-testid="sign-up-button">
          <SignUp
            redirectUrl={redirectUrl || "/app"}
            signInUrl="/signin"
            appearance={{
              elements: {
                formButtonPrimary:
                  "bg-primary hover:bg-primary/90 text-primary-foreground border-0",
                card: "shadow-lg border border-border bg-card",
                headerTitle: "text-2xl font-semibold text-foreground",
                headerSubtitle: "text-muted-foreground",
                socialButtonsBlockButton:
                  "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
                socialButtonsBlockButtonText: "text-foreground",
                dividerLine: "bg-border",
                dividerText: "text-muted-foreground",
                formFieldInput:
                  "border border-input bg-background text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
                formFieldLabel: "text-foreground font-medium",
                formFieldInputShowPasswordButton:
                  "text-muted-foreground hover:text-foreground",
                footerActionLink: "text-primary hover:text-primary/80",
                identityPreviewText: "text-foreground",
                identityPreviewEditButton: "text-primary hover:text-primary/80",
                formHeaderTitle: "text-foreground",
                formHeaderSubtitle: "text-muted-foreground",
                otpCodeFieldInput:
                  "border border-input bg-background text-foreground",
                alternativeMethodsBlockButton:
                  "border border-input bg-background hover:bg-accent text-foreground",
              },
              layout: {
                socialButtonsPlacement: "top",
                showOptionalFields: true,
              },
            }}
            additionalSignUpFields={[
              {
                name: "first_name",
                label: "First name",
                placeholder: "Enter your first name",
                required: true,
              },
              {
                name: "last_name",
                label: "Last name",
                placeholder: "Enter your last name",
                required: true,
              },
              // Require users to accept Terms of Service & Privacy Policy
              {
                // Using Clerk's conventional field id for legal acceptance
                // so it appears and validates as a checkbox within the prebuilt UI.
                name: "legalAccepted",
                type: "checkbox",
                label: "I agree to the Terms of Service and Privacy Policy",
                required: true,
              } as AdditionalSignUpField,
            ]}
          />
          <p className="mt-4 text-xs text-muted-foreground text-center">
            By signing up, you agree to our{" "}
            <a
              href="/terms"
              className="underline hover:text-primary"
              target="_blank"
              rel="noopener noreferrer"
            >
              Terms of Service
            </a>{" "}
            and{" "}
            <a
              href="/privacy"
              className="underline hover:text-primary"
              target="_blank"
              rel="noopener noreferrer"
            >
              Privacy Policy
            </a>
            .
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-md" data-testid="sign-in-button">
        <SignIn
          redirectUrl={redirectUrl || "/app"}
          signUpUrl="/signup"
          appearance={{
            elements: {
              formButtonPrimary:
                "bg-primary hover:bg-primary/90 text-primary-foreground border-0",
              card: "shadow-lg border border-border bg-card",
              headerTitle: "text-2xl font-semibold text-foreground",
              headerSubtitle: "text-muted-foreground",
              socialButtonsBlockButton:
                "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
              socialButtonsBlockButtonText: "text-foreground",
              dividerLine: "bg-border",
              dividerText: "text-muted-foreground",
              formFieldInput:
                "border border-input bg-background text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
              formFieldLabel: "text-foreground font-medium",
              formFieldInputShowPasswordButton:
                "text-muted-foreground hover:text-foreground",
              footerActionLink: "text-primary hover:text-primary/80",
              identityPreviewText: "text-foreground",
              identityPreviewEditButton: "text-primary hover:text-primary/80",
              formHeaderTitle: "text-foreground",
              formHeaderSubtitle: "text-muted-foreground",
              otpCodeFieldInput:
                "border border-input bg-background text-foreground",
              alternativeMethodsBlockButton:
                "border border-input bg-background hover:bg-accent text-foreground",
            },
            layout: {
              socialButtonsPlacement: "top",
            },
          }}
        />
      </div>
    </div>
  );
}

export function ClerkUserButton() {
  return (
    <div data-testid="user-menu">
      <UserButton
        appearance={{
          elements: {
            avatarBox: "w-8 h-8",
            userButtonPopoverCard: "shadow-md border",
            userButtonPopoverActionButton: "hover:bg-accent",
          },
        }}
        showName={false}
        afterSignOutUrl="/signin"
      />
    </div>
  );
}
