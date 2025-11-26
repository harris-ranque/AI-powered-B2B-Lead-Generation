/**
 * useFastSpring Hook
 *
 * React hook for FastSpring popup checkout integration.
 * Handles script loading, checkout sessions, and order completion.
 */

import { useState, useEffect, useCallback } from "react";
import { useAction } from "convex/react";
import { api } from "@genni/convex-types";
import {
  loadFastSpringScript,
  openSecureCheckout,
  isFastSpringReady,
  cleanup,
  type FastSpringOrder,
} from "../lib/fastspring";
import { useToast } from "./use-toast";

interface UseFastSpringOptions {
  onOrderComplete?: (order: FastSpringOrder) => void;
  onCheckoutClose?: () => void;
  autoLoad?: boolean;
}

interface CheckoutState {
  isLoading: boolean;
  isOpen: boolean;
  error: string | null;
}

export function useFastSpring(options: UseFastSpringOptions = {}) {
  const { onOrderComplete, onCheckoutClose, autoLoad = false } = options;
  const { toast } = useToast();

  const [isReady, setIsReady] = useState(isFastSpringReady());
  const [isLoadingScript, setIsLoadingScript] = useState(false);
  const [checkoutState, setCheckoutState] = useState<CheckoutState>({
    isLoading: false,
    isOpen: false,
    error: null,
  });

  // Convex actions for checkout data
  const createSubscriptionCheckout = useAction(
    api.billing.mutations.createSubscriptionCheckout
  );
  const createCreditsCheckout = useAction(
    api.billing.mutations.createCreditsCheckout
  );
  const validateOrder = useAction(api.billing.mutations.validateOrder);

  // Load FastSpring script
  const loadScript = useCallback(async () => {
    if (isReady || isLoadingScript) return;

    setIsLoadingScript(true);
    try {
      await loadFastSpringScript();
      setIsReady(true);
    } catch (error) {
      console.error("[useFastSpring] Script load failed:", error);
      toast({
        variant: "destructive",
        title: "Payment system error",
        description: "Failed to load payment system. Please refresh the page.",
      });
    } finally {
      setIsLoadingScript(false);
    }
  }, [isReady, isLoadingScript, toast]);

  // Auto-load script if option is enabled
  useEffect(() => {
    if (autoLoad && !isReady && !isLoadingScript) {
      loadScript();
    }
  }, [autoLoad, isReady, isLoadingScript, loadScript]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, []);

  // Handle order completion
  const handleOrderComplete = useCallback(
    async (order: FastSpringOrder) => {
      console.log("[useFastSpring] Order completed:", order);

      // Validate order with backend
      try {
        const validation = await validateOrder({
          orderId: order.id,
          orderReference: order.reference,
        });

        if (!validation.valid) {
          console.error("[useFastSpring] Order validation failed:", validation);
          toast({
            variant: "destructive",
            title: "Order verification failed",
            description: "Please contact support if you were charged.",
          });
          return;
        }

        toast({
          title: "Payment successful!",
          description: "Your purchase has been processed.",
        });

        if (onOrderComplete) {
          onOrderComplete(order);
        }
      } catch (error) {
        console.error("[useFastSpring] Order validation error:", error);
        // Still notify success since FastSpring completed - webhook will handle
        toast({
          title: "Payment processing",
          description: "Your payment is being processed. Credits will be added shortly.",
        });

        if (onOrderComplete) {
          onOrderComplete(order);
        }
      }

      setCheckoutState((prev) => ({ ...prev, isOpen: false, isLoading: false }));
    },
    [validateOrder, toast, onOrderComplete]
  );

  // Handle checkout close
  const handleCheckoutClose = useCallback(() => {
    console.log("[useFastSpring] Checkout closed");
    setCheckoutState((prev) => ({ ...prev, isOpen: false, isLoading: false }));

    if (onCheckoutClose) {
      onCheckoutClose();
    }
  }, [onCheckoutClose]);

  // Handle checkout error
  const handleCheckoutError = useCallback(
    (error: Error) => {
      console.error("[useFastSpring] Checkout error:", error);
      setCheckoutState({
        isLoading: false,
        isOpen: false,
        error: error.message,
      });

      toast({
        variant: "destructive",
        title: "Checkout error",
        description: error.message || "Failed to open checkout. Please try again.",
      });
    },
    [toast]
  );

  /**
   * Start subscription checkout
   *
   * @param planId - Plan identifier (e.g., "professional", "business")
   * @param billingCycle - "monthly" or "yearly"
   */
  const startSubscriptionCheckout = useCallback(
    async (planId: string, billingCycle: "monthly" | "yearly") => {
      if (!isReady) {
        await loadScript();
      }

      setCheckoutState({ isLoading: true, isOpen: false, error: null });

      try {
        // Get secure checkout data from backend
        const checkoutData = await createSubscriptionCheckout({
          planId,
          billingCycle,
        });

        // Open FastSpring popup with secure payload
        await openSecureCheckout(
          checkoutData.securePayload,
          checkoutData.secureKey,
          {
            onComplete: handleOrderComplete,
            onClose: handleCheckoutClose,
            onError: handleCheckoutError,
          }
        );

        setCheckoutState((prev) => ({ ...prev, isOpen: true, isLoading: false }));
      } catch (error) {
        console.error("[useFastSpring] Subscription checkout failed:", error);
        handleCheckoutError(error as Error);
      }
    },
    [
      isReady,
      loadScript,
      createSubscriptionCheckout,
      handleOrderComplete,
      handleCheckoutClose,
      handleCheckoutError,
    ]
  );

  /**
   * Start credits purchase checkout
   *
   * @param credits - Number of credits to purchase (must match a configured pack)
   */
  const startCreditsCheckout = useCallback(
    async (credits: number) => {
      if (!isReady) {
        await loadScript();
      }

      setCheckoutState({ isLoading: true, isOpen: false, error: null });

      try {
        // Get secure checkout data from backend
        const checkoutData = await createCreditsCheckout({ credits });

        // Open FastSpring popup with secure payload
        await openSecureCheckout(
          checkoutData.securePayload,
          checkoutData.secureKey,
          {
            onComplete: handleOrderComplete,
            onClose: handleCheckoutClose,
            onError: handleCheckoutError,
          }
        );

        setCheckoutState((prev) => ({ ...prev, isOpen: true, isLoading: false }));
      } catch (error) {
        console.error("[useFastSpring] Credits checkout failed:", error);
        handleCheckoutError(error as Error);
      }
    },
    [
      isReady,
      loadScript,
      createCreditsCheckout,
      handleOrderComplete,
      handleCheckoutClose,
      handleCheckoutError,
    ]
  );

  return {
    // State
    isReady,
    isLoading: checkoutState.isLoading || isLoadingScript,
    isCheckoutOpen: checkoutState.isOpen,
    error: checkoutState.error,

    // Actions
    loadScript,
    startSubscriptionCheckout,
    startCreditsCheckout,

    // Clear error
    clearError: () => setCheckoutState((prev) => ({ ...prev, error: null })),
  };
}

/**
 * Simplified hook for just credits checkout
 */
export function useFastSpringCredits(
  onSuccess?: (order: FastSpringOrder) => void
) {
  const fastspring = useFastSpring({
    onOrderComplete: onSuccess,
    autoLoad: true,
  });

  return {
    purchaseCredits: fastspring.startCreditsCheckout,
    isLoading: fastspring.isLoading,
    isReady: fastspring.isReady,
    error: fastspring.error,
  };
}

/**
 * Simplified hook for subscription checkout
 */
export function useFastSpringSubscription(
  onSuccess?: (order: FastSpringOrder) => void
) {
  const fastspring = useFastSpring({
    onOrderComplete: onSuccess,
    autoLoad: true,
  });

  return {
    subscribe: fastspring.startSubscriptionCheckout,
    isLoading: fastspring.isLoading,
    isReady: fastspring.isReady,
    error: fastspring.error,
  };
}
