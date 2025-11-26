/**
 * FastSpring Store Builder Library (SBL) Integration
 *
 * Handles loading the FastSpring SBL script and managing popup checkout sessions.
 * Uses secure payloads encrypted server-side to prevent price tampering.
 *
 * @see https://fastspring.com/docs/storefronts/popup-storefront/
 */

// Declare FastSpring global types
declare global {
  interface Window {
    fastspring?: {
      builder: {
        reset: () => void;
        add: (product: string, quantity?: number) => void;
        checkout: () => void;
        secure: (payload: string, key: string) => void;
        viewCart: () => void;
        closePopup: () => void;
        push: (data: any) => void;
        recognize: (data: any) => void;
      };
    };
    fastspringCallback?: {
      data?: any;
      popup?: boolean;
      close?: () => void;
    };
  }
}

// Store ID from environment
const FASTSPRING_STORE_ID = import.meta.env.VITE_FASTSPRING_STORE_ID;

// Track script loading state
let scriptLoaded = false;
let scriptLoading = false;
let loadPromise: Promise<void> | null = null;

// Callbacks for checkout events
type CheckoutCallback = {
  onComplete?: (order: FastSpringOrder) => void;
  onClose?: () => void;
  onError?: (error: Error) => void;
};

export interface FastSpringOrder {
  id: string;
  reference: string;
  total: number;
  currency: string;
  items: Array<{
    product: string;
    quantity: number;
    price: number;
    subscription?: string;
  }>;
}

// Current checkout session callbacks
let currentCallbacks: CheckoutCallback = {};

/**
 * Load the FastSpring SBL script if not already loaded
 * Returns a promise that resolves when the script is ready
 */
export async function loadFastSpringScript(): Promise<void> {
  if (scriptLoaded) {
    return Promise.resolve();
  }

  if (scriptLoading && loadPromise) {
    return loadPromise;
  }

  if (!FASTSPRING_STORE_ID) {
    throw new Error("VITE_FASTSPRING_STORE_ID environment variable is not set");
  }

  scriptLoading = true;

  loadPromise = new Promise((resolve, reject) => {
    // Create the data callback before loading script
    (window as any).fscDataCallback = (data: any) => {
      handleFastSpringCallback(data);
    };

    // Create the script element
    const script = document.createElement("script");
    script.id = "fsc-api";
    script.src = "https://sbl.onfastspring.com/sbl/1.0.5/fastspring-builder.min.js";
    script.type = "text/javascript";
    script.setAttribute("data-storefront", FASTSPRING_STORE_ID);
    script.setAttribute("data-data-callback", "fscDataCallback");
    script.setAttribute("data-continuous", "true");

    script.onload = () => {
      scriptLoaded = true;
      scriptLoading = false;
      resolve();
    };

    script.onerror = (error) => {
      scriptLoading = false;
      reject(new Error("Failed to load FastSpring script"));
    };

    // Append to document
    document.head.appendChild(script);
  });

  return loadPromise;
}

/**
 * Handle FastSpring data callbacks
 * Called by SBL when checkout events occur
 */
function handleFastSpringCallback(data: any) {
  console.log("[FastSpring] Callback received:", data);

  // Check if this is an order completion
  if (data && data.id && data.reference) {
    const order: FastSpringOrder = {
      id: data.id,
      reference: data.reference,
      total: data.total || 0,
      currency: data.currency || "USD",
      items: (data.items || []).map((item: any) => ({
        product: item.product || item.path,
        quantity: item.quantity || 1,
        price: item.price || item.total || 0,
        subscription: item.subscription,
      })),
    };

    if (currentCallbacks.onComplete) {
      currentCallbacks.onComplete(order);
    }
  }

  // Check if popup was closed
  if (data && data.popup === false) {
    if (currentCallbacks.onClose) {
      currentCallbacks.onClose();
    }
  }
}

/**
 * Check if FastSpring is ready for checkout
 */
export function isFastSpringReady(): boolean {
  return scriptLoaded && !!window.fastspring?.builder;
}

/**
 * Open a FastSpring popup checkout with secure payload
 *
 * @param securePayload - Base64 encoded encrypted payload from server
 * @param secureKey - FastSpring access key for decryption
 * @param callbacks - Optional callbacks for checkout events
 */
export async function openSecureCheckout(
  securePayload: string,
  secureKey: string,
  callbacks?: CheckoutCallback
): Promise<void> {
  // Ensure script is loaded
  await loadFastSpringScript();

  if (!window.fastspring?.builder) {
    throw new Error("FastSpring builder not available");
  }

  // Store callbacks for this checkout session
  currentCallbacks = callbacks || {};

  try {
    // Reset any existing cart state
    window.fastspring.builder.reset();

    // Apply secure payload - this sets the pre-configured cart
    window.fastspring.builder.secure(securePayload, secureKey);

    // Open the checkout popup
    window.fastspring.builder.checkout();
  } catch (error) {
    console.error("[FastSpring] Checkout error:", error);
    if (currentCallbacks.onError) {
      currentCallbacks.onError(error as Error);
    }
    throw error;
  }
}

/**
 * Open a simple product checkout (without secure payload)
 * Only use for testing - production should use openSecureCheckout
 *
 * @param productPath - FastSpring product path (e.g., "credits-100")
 * @param callbacks - Optional callbacks for checkout events
 */
export async function openProductCheckout(
  productPath: string,
  callbacks?: CheckoutCallback
): Promise<void> {
  await loadFastSpringScript();

  if (!window.fastspring?.builder) {
    throw new Error("FastSpring builder not available");
  }

  currentCallbacks = callbacks || {};

  try {
    window.fastspring.builder.reset();
    window.fastspring.builder.add(productPath, 1);
    window.fastspring.builder.checkout();
  } catch (error) {
    console.error("[FastSpring] Product checkout error:", error);
    if (currentCallbacks.onError) {
      currentCallbacks.onError(error as Error);
    }
    throw error;
  }
}

/**
 * Close the FastSpring popup if open
 */
export function closeCheckout(): void {
  if (window.fastspring?.builder) {
    window.fastspring.builder.closePopup();
  }
}

/**
 * Pre-populate customer data for checkout
 * Call this before opening checkout if you have customer info
 *
 * @param email - Customer email
 * @param firstName - Customer first name
 * @param lastName - Customer last name
 */
export async function recognizeCustomer(
  email: string,
  firstName?: string,
  lastName?: string
): Promise<void> {
  await loadFastSpringScript();

  if (!window.fastspring?.builder) {
    throw new Error("FastSpring builder not available");
  }

  window.fastspring.builder.recognize({
    email,
    firstName,
    lastName,
  });
}

/**
 * Clean up FastSpring resources
 * Call when unmounting components that use checkout
 */
export function cleanup(): void {
  currentCallbacks = {};
  if (window.fastspring?.builder) {
    try {
      window.fastspring.builder.reset();
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

// Auto-load script when module is imported (in browser environment)
if (typeof window !== "undefined" && FASTSPRING_STORE_ID) {
  // Don't auto-load - let components control when to load
  // This prevents loading on pages that don't need checkout
}
