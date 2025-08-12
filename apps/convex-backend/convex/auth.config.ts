// Clerk authentication configuration for Convex
// Using direct Clerk integration instead of @convex-dev/auth

const authConfig = {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: process.env.CLERK_SECRET_KEY!,
    }
  ]
};

export default authConfig;