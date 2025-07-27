import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Bot, Shield, Lock, Eye, UserCheck, Globe, FileText, Mail } from "lucide-react";
import { Link } from "react-router-dom";

export default function PrivacyPage() {
  const sections = [
    {
      title: "Information We Collect",
      icon: Eye,
      content: [
        "Account information (name, email, company details)",
        "Usage data (searches, leads generated, features used)",
        "Payment information (processed securely through Stripe)",
        "Communication preferences and support interactions"
      ]
    },
    {
      title: "How We Use Your Information",
      icon: UserCheck,
      content: [
        "Provide and improve our services",
        "Process payments and manage subscriptions",
        "Send important service updates and notifications",
        "Analyze usage patterns to enhance user experience",
        "Comply with legal obligations"
      ]
    },
    {
      title: "Data Security",
      icon: Lock,
      content: [
        "256-bit SSL encryption for all data transfers",
        "Encrypted storage for sensitive information",
        "Regular security audits and penetration testing",
        "SOC 2 Type II compliance",
        "Strict access controls and authentication"
      ]
    },
    {
      title: "Data Sharing",
      icon: Globe,
      content: [
        "We never sell your personal data",
        "Third-party services used only for core functionality",
        "Data shared only with your explicit consent",
        "Anonymized aggregate data for analytics",
        "Legal compliance when required by law"
      ]
    }
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center space-x-2">
            <Bot className="h-8 w-8 text-primary" />
            <span className="font-bold text-xl">Lead Eternity</span>
          </Link>
          
          <div className="hidden md:flex items-center space-x-8">
            <Link to="/" className="text-sm font-medium hover:text-primary transition-colors">
              Home
            </Link>
            <Link to="/about" className="text-sm font-medium hover:text-primary transition-colors">
              About
            </Link>
            <Link to="/contact" className="text-sm font-medium hover:text-primary transition-colors">
              Contact
            </Link>
          </div>

          <div className="flex items-center space-x-4">
            <Link to="/login">
              <Button variant="ghost">Sign In</Button>
            </Link>
            <Link to="/signup">
              <Button>Get Started</Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-20 pb-16 px-4 bg-muted/30">
        <div className="container mx-auto text-center max-w-4xl">
          <div className="flex justify-center mb-6">
            <Shield className="h-16 w-16 text-primary" />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold mb-6">
            Privacy Policy
          </h1>
          <p className="text-xl text-muted-foreground mb-4">
            Your privacy is important to us. This policy explains how we collect, use, and protect your information.
          </p>
          <p className="text-sm text-muted-foreground">
            Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
      </section>

      {/* Main Content */}
      <section className="py-16 px-4">
        <div className="container mx-auto max-w-4xl">
          {/* Introduction */}
          <div className="prose prose-gray max-w-none mb-12">
            <p className="text-lg leading-relaxed mb-6">
              Lead Eternity ("we," "our," or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our service.
            </p>
            <p className="text-lg leading-relaxed mb-6">
              By using Lead Eternity, you agree to the collection and use of information in accordance with this policy. If you do not agree with the terms of this policy, please do not use our service.
            </p>
          </div>

          {/* Key Sections */}
          <div className="grid md:grid-cols-2 gap-6 mb-12">
            {sections.map((section, index) => (
              <Card key={index}>
                <CardContent className="p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <section.icon className="h-8 w-8 text-primary" />
                    <h3 className="text-xl font-semibold">{section.title}</h3>
                  </div>
                  <ul className="space-y-2">
                    {section.content.map((item, itemIndex) => (
                      <li key={itemIndex} className="flex items-start gap-2">
                        <span className="text-primary mt-1">•</span>
                        <span className="text-muted-foreground">{item}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Detailed Sections */}
          <div className="space-y-8">
            <div>
              <h2 className="text-2xl font-bold mb-4">Your Rights</h2>
              <p className="text-muted-foreground mb-4">
                Under applicable privacy laws, you have certain rights regarding your personal information:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>Access your personal data and request a copy</li>
                <li>Correct inaccurate or incomplete information</li>
                <li>Delete your account and associated data</li>
                <li>Export your data in a portable format</li>
                <li>Opt-out of marketing communications</li>
                <li>Restrict or object to certain data processing</li>
              </ul>
            </div>

            <div>
              <h2 className="text-2xl font-bold mb-4">Data Retention</h2>
              <p className="text-muted-foreground mb-4">
                We retain your information only as long as necessary to provide our services and fulfill the purposes outlined in this policy:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>Active account data: Retained while your account is active</li>
                <li>Deleted account data: Removed within 30 days of deletion request</li>
                <li>Billing records: Retained for 7 years for tax and legal compliance</li>
                <li>Analytics data: Anonymized and aggregated after 24 months</li>
              </ul>
            </div>

            <div>
              <h2 className="text-2xl font-bold mb-4">Cookies and Tracking</h2>
              <p className="text-muted-foreground mb-4">
                We use cookies and similar tracking technologies to improve your experience:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>Essential cookies: Required for basic site functionality</li>
                <li>Analytics cookies: Help us understand usage patterns</li>
                <li>Preference cookies: Remember your settings and choices</li>
                <li>Marketing cookies: Used only with your consent</li>
              </ul>
              <p className="text-muted-foreground mt-4">
                You can control cookie settings through your browser preferences.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-bold mb-4">International Data Transfers</h2>
              <p className="text-muted-foreground">
                Lead Eternity operates globally. Your information may be transferred to and processed in countries other than your own. We ensure appropriate safeguards are in place to protect your data in accordance with this policy and applicable laws, including the use of Standard Contractual Clauses for transfers from the EU/EEA.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-bold mb-4">Children's Privacy</h2>
              <p className="text-muted-foreground">
                Lead Eternity is not intended for use by children under 16 years of age. We do not knowingly collect personal information from children. If we learn that we have collected information from a child under 16, we will delete that information promptly.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-bold mb-4">Changes to This Policy</h2>
              <p className="text-muted-foreground">
                We may update this Privacy Policy from time to time. We will notify you of any material changes by posting the new policy on this page and updating the "Last updated" date. For significant changes, we will provide additional notice via email or through the service.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-bold mb-4">Contact Us</h2>
              <p className="text-muted-foreground mb-4">
                If you have questions about this Privacy Policy or our data practices, please contact us:
              </p>
              <Card>
                <CardContent className="p-6">
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <Mail className="h-5 w-5 text-primary" />
                      <span>privacy@leadeternity.com</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <FileText className="h-5 w-5 text-primary" />
                      <span>Data Protection Officer</span>
                    </div>
                    <div className="flex items-start gap-3">
                      <Globe className="h-5 w-5 text-primary mt-1" />
                      <div>
                        Lead Eternity, Inc.<br />
                        123 Market Street, Suite 500<br />
                        San Francisco, CA 94105<br />
                        United States
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* GDPR Section */}
          <div className="mt-12 p-6 bg-muted/30 rounded-lg">
            <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <Shield className="h-6 w-6 text-primary" />
              GDPR Compliance
            </h3>
            <p className="text-muted-foreground mb-4">
              For users in the European Union, we comply with the General Data Protection Regulation (GDPR). Our legal bases for processing your data include:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
              <li>Contract: Processing necessary to provide our services</li>
              <li>Consent: Where you have given explicit consent</li>
              <li>Legitimate interests: For business operations and improvements</li>
              <li>Legal obligations: When required by law</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-12 px-4">
        <div className="container mx-auto">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center space-x-2 mb-4">
                <Bot className="h-6 w-6 text-primary" />
                <span className="font-bold">Lead Eternity</span>
              </div>
              <p className="text-sm text-muted-foreground">
                AI-powered lead generation for modern sales teams.
              </p>
            </div>
            
            <div>
              <h4 className="font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link to="/#features" className="hover:text-primary">Features</Link></li>
                <li><Link to="/#pricing" className="hover:text-primary">Pricing</Link></li>
                <li><Link to="/api" className="hover:text-primary">API</Link></li>
                <li><Link to="/integrations" className="hover:text-primary">Integrations</Link></li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-semibold mb-4">Company</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link to="/about" className="hover:text-primary">About</Link></li>
                <li><Link to="/blog" className="hover:text-primary">Blog</Link></li>
                <li><Link to="/careers" className="hover:text-primary">Careers</Link></li>
                <li><Link to="/contact" className="hover:text-primary">Contact</Link></li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-semibold mb-4">Legal</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link to="/privacy" className="hover:text-primary">Privacy Policy</Link></li>
                <li><Link to="/terms" className="hover:text-primary">Terms of Service</Link></li>
                <li><Link to="/security" className="hover:text-primary">Security</Link></li>
                <li><Link to="/gdpr" className="hover:text-primary">GDPR</Link></li>
              </ul>
            </div>
          </div>
          
          <div className="mt-8 pt-8 border-t text-center text-sm text-muted-foreground">
            <p>&copy; {new Date().getFullYear()} Lead Eternity. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}