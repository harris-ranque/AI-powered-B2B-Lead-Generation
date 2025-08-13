import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ConvexProvider } from "@/components/providers/ConvexProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Public Pages
import LandingPage from "./pages/LandingPage";
import AboutPage from "./pages/AboutPage";
import ContactPage from "./pages/ContactPage";
import PricingPage from "./pages/PricingPage";
import PrivacyPage from "./pages/PrivacyPage";
import TermsPage from "./pages/TermsPage";

// Auth Components
import { LoginForm } from "@/components/auth/LoginForm";
import { SignUpForm } from "@/components/auth/SignUpForm";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AdminRoute } from "@/components/auth/AdminRoute";
import { DeveloperRoute } from "@/components/auth/DeveloperRoute";

// App Components
import { GenniApp } from "@/components/GenniApp";
import { AdminDashboard } from "@/components/AdminDashboard";
import { DeveloperRoyaltyDashboard } from "@/components/royalty/DeveloperRoyaltyDashboard";

// Other Pages
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <ErrorBoundary>
    <ConvexProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <ErrorBoundary>
              <Routes>
                {/* Public Routes - No Authentication Required */}
                <Route path="/" element={<LandingPage />} />
                <Route path="/about" element={<AboutPage />} />
                <Route path="/contact" element={<ContactPage />} />
                <Route path="/pricing" element={<PricingPage />} />
                <Route path="/privacy" element={<PrivacyPage />} />
                <Route path="/terms" element={<TermsPage />} />

                {/* Authentication Routes */}
                <Route path="/signin" element={<LoginForm />} />
                <Route path="/login" element={<LoginForm />} /> {/* Legacy redirect */}
                <Route path="/signup" element={<SignUpForm />} />
                <Route path="/forgot-password" element={<ForgotPasswordForm />} />
                <Route path="/reset-password" element={<ResetPasswordForm />} />

                {/* Protected App Routes */}
                <Route 
                  path="/app" 
                  element={
                    <ErrorBoundary>
                      <ProtectedRoute>
                        <GenniApp />
                      </ProtectedRoute>
                    </ErrorBoundary>
                  } 
                />
                <Route 
                  path="/app/*" 
                  element={
                    <ErrorBoundary>
                      <ProtectedRoute>
                        <GenniApp />
                      </ProtectedRoute>
                    </ErrorBoundary>
                  } 
                />

                {/* Admin Routes */}
                <Route 
                  path="/admin" 
                  element={
                    <ErrorBoundary>
                      <AdminRoute>
                        <AdminDashboard />
                      </AdminRoute>
                    </ErrorBoundary>
                  } 
                />

                {/* Developer Routes */}
                <Route 
                  path="/developer" 
                  element={
                    <ErrorBoundary>
                      <DeveloperRoute>
                        <DeveloperRoyaltyDashboard />
                      </DeveloperRoute>
                    </ErrorBoundary>
                  } 
                />

                {/* Catch-all route - must be last */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </ErrorBoundary>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ConvexProvider>
  </ErrorBoundary>
);

export default App;
