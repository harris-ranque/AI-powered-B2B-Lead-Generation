import { ClerkAuthWrapper } from "@/components/auth/ClerkAuthWrapper";

export function SignUpPage() {
  return <ClerkAuthWrapper mode="signup" redirectUrl="/app" />;
}