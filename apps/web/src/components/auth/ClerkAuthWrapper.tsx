import { SignIn, SignUp, UserButton } from "@clerk/clerk-react";
import { ReactNode } from "react";

interface ClerkAuthWrapperProps {
  children?: ReactNode;
  mode?: 'signin' | 'signup';
  redirectUrl?: string;
}

export function ClerkAuthWrapper({ children, mode = 'signin', redirectUrl }: ClerkAuthWrapperProps) {
  if (mode === 'signup') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-full max-w-md">
          <SignUp
            redirectUrl={redirectUrl || "/app"}
            signInUrl="/signin"
            appearance={{
              elements: {
                formButtonPrimary: "bg-primary hover:bg-primary/90 text-primary-foreground border-0",
                card: "shadow-lg border border-border bg-card",
                headerTitle: "text-2xl font-semibold text-foreground",
                headerSubtitle: "text-muted-foreground",
                socialButtonsBlockButton: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
                socialButtonsBlockButtonText: "text-foreground",
                dividerLine: "bg-border",
                dividerText: "text-muted-foreground",
                formFieldInput: "border border-input bg-background text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
                formFieldLabel: "text-foreground font-medium",
                formFieldInputShowPasswordButton: "text-muted-foreground hover:text-foreground",
                footerActionLink: "text-primary hover:text-primary/80",
                identityPreviewText: "text-foreground",
                identityPreviewEditButton: "text-primary hover:text-primary/80",
                formHeaderTitle: "text-foreground",
                formHeaderSubtitle: "text-muted-foreground",
                otpCodeFieldInput: "border border-input bg-background text-foreground",
                alternativeMethodsBlockButton: "border border-input bg-background hover:bg-accent text-foreground",
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
            ]}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-md">
        <SignIn
          redirectUrl={redirectUrl || "/app"}
          signUpUrl="/signup"
          appearance={{
            elements: {
              formButtonPrimary: "bg-primary hover:bg-primary/90 text-primary-foreground border-0",
              card: "shadow-lg border border-border bg-card",
              headerTitle: "text-2xl font-semibold text-foreground",
              headerSubtitle: "text-muted-foreground",
              socialButtonsBlockButton: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
              socialButtonsBlockButtonText: "text-foreground",
              dividerLine: "bg-border",
              dividerText: "text-muted-foreground",
              formFieldInput: "border border-input bg-background text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
              formFieldLabel: "text-foreground font-medium",
              formFieldInputShowPasswordButton: "text-muted-foreground hover:text-foreground",
              footerActionLink: "text-primary hover:text-primary/80",
              identityPreviewText: "text-foreground",
              identityPreviewEditButton: "text-primary hover:text-primary/80",
              formHeaderTitle: "text-foreground",
              formHeaderSubtitle: "text-muted-foreground",
              otpCodeFieldInput: "border border-input bg-background text-foreground",
              alternativeMethodsBlockButton: "border border-input bg-background hover:bg-accent text-foreground",
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
  );
}