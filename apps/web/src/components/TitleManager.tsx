import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const defaultTitle = "Genni";

const routeTitles: { pattern: RegExp; label: string }[] = [
  { pattern: /^\/$/, label: "Lead Generation Platform" },
  { pattern: /^\/about\/?$/, label: "About" },
  { pattern: /^\/contact\/?$/, label: "Contact" },
  { pattern: /^\/pricing\/?$/, label: "Pricing" },
  { pattern: /^\/privacy\/?$/, label: "Privacy Policy" },
  { pattern: /^\/terms\/?$/, label: "Terms of Service" },
  { pattern: /^\/(login|signin)\/?$/, label: "Sign In" },
  { pattern: /^\/signup\/?$/, label: "Sign Up" },
  { pattern: /^\/forgot-password\/?$/, label: "Forgot Password" },
  { pattern: /^\/reset-password\/?$/, label: "Reset Password" },
  { pattern: /^\/app(\/.*)?$/, label: "Dashboard" },
  { pattern: /^\/admin(\/docs.*)?$/, label: "Admin" },
];

function resolvePageTitle(pathname: string): string | undefined {
  for (const { pattern, label } of routeTitles) {
    if (pattern.test(pathname)) {
      return label;
    }
  }
  return undefined;
}

function updateMetaTag(selector: string, content: string) {
  const element = document.querySelector<HTMLMetaElement>(selector);
  if (element) {
    element.setAttribute("content", content);
  }
}

export function TitleManager() {
  const { pathname } = useLocation();

  useEffect(() => {
    const pageTitle = resolvePageTitle(pathname);
    const fullTitle = pageTitle ? `Genni – ${pageTitle}` : defaultTitle;

    document.title = fullTitle;
    updateMetaTag("meta[property='og:title']", fullTitle);
    updateMetaTag("meta[name='twitter:title']", fullTitle);
  }, [pathname]);

  return null;
}

