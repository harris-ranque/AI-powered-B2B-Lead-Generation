import { ConvexProvider as BaseConvexProvider } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ReactNode } from "react";
import { convex } from "@/lib/convex";

interface ConvexProviderProps {
  children: ReactNode;
}

export function ConvexProvider({ children }: ConvexProviderProps) {
  return (
    <BaseConvexProvider client={convex}>
      <ConvexAuthProvider>
        {children}
      </ConvexAuthProvider>
    </BaseConvexProvider>
  );
}