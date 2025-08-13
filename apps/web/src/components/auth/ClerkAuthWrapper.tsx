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
                formButtonPrimary: "bg-primary hover:bg-primary/90",
                card: "shadow-md",
                headerTitle: "text-2xl font-semibold",
                headerSubtitle: "text-muted-foreground",
                socialButtonsBlockButton: "border border-input bg-background hover:bg-accent",
                formFieldInput: "border border-input bg-background",
                footerActionLink: "text-primary hover:text-primary/80",
              },
            }}
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
              formButtonPrimary: "bg-primary hover:bg-primary/90",
              card: "shadow-md",
              headerTitle: "text-2xl font-semibold",
              headerSubtitle: "text-muted-foreground",
              socialButtonsBlockButton: "border border-input bg-background hover:bg-accent",
              formFieldInput: "border border-input bg-background",
              footerActionLink: "text-primary hover:text-primary/80",
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