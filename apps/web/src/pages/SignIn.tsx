import { ClerkAuthWrapper } from "@/components/auth/ClerkAuthWrapper";

export function SignInPage() {
  return <ClerkAuthWrapper mode="signin" redirectUrl="/app" />;
}