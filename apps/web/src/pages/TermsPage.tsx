import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Bot, FileText, Scale, Shield, AlertCircle, UserCheck, CreditCard, Ban } from "lucide-react";
import { Link } from "react-router-dom";

export default function TermsPage() {
  const sections = [
    {
      title: "Acceptable Use",
      icon: UserCheck,
      content: [
        "Use the service only for lawful business purposes",
        "Maintain accurate account information",
        "Respect intellectual property rights",
        "Do not attempt to reverse engineer our systems",
        "Comply with all applicable laws and regulations"
      ]
    },
    {
      title: "Service Terms",
      icon: FileText,
      content: [
        "We provide the service on an 'as-is' basis",
        "Service availability is not guaranteed 100%",
        "Features may be added or removed over time",
        "We reserve the right to suspend accounts for violations",
        "API usage is subject to rate limits"
      ]
    },
    {
      title: "Payment Terms",
      icon: CreditCard,
      content: [
        "Subscriptions renew automatically",
        "Prices may change with 30 days notice",
        "No refunds for partial months",
        "Credits expire at the end of each billing period",
        "Failed payments may result in service suspension"
      ]
    },
    {
      title: "Prohibited Uses",
      icon: Ban,
      content: [
        "Spamming or sending unsolicited emails",
        "Harvesting data for unauthorized purposes",
        "Violating privacy laws or regulations",
        "Impersonating others or misrepresenting affiliation",
        "Using the service to harm or harass others"
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
            <Link to="/signin">
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
            <Scale className="h-16 w-16 text-primary" />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold mb-6">
            Terms of Service
          </h1>
          <p className="text-xl text-muted-foreground mb-4">
            Please read these terms carefully before using Lead Eternity.
          </p>
          <p className="text-sm text-muted-foreground">
            Effective Date: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
      </section>

      {/* Main Content */}
      <section className="py-16 px-4">
        <div className="container mx-auto max-w-4xl">
          {/* Introduction */}
          <div className="prose prose-gray max-w-none mb-12">
            <p className="text-lg leading-relaxed mb-6">
              These Terms of Service ("Terms") govern your use of Lead Eternity's services, website, and software (collectively, the "Service") operated by Lead Eternity, Inc. ("we," "us," or "our").
            </p>
            <p className="text-lg leading-relaxed mb-6">
              By accessing or using our Service, you agree to be bound by these Terms. If you disagree with any part of these terms, then you may not access the Service.
            </p>
          </div>

          {/* Key Sections Grid */}
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

          {/* Detailed Terms */}
          <div className="space-y-8">
            <div>
              <h2 className="text-2xl font-bold mb-4">1. Account Terms</h2>
              <p className="text-muted-foreground mb-4">
                You are responsible for maintaining the security of your account and password. Lead Eternity cannot and will not be liable for any loss or damage from your failure to comply with this security obligation. You are responsible for all content posted and activity that occurs under your account.
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>You must be 18 years or older to use this Service</li>
                <li>You must provide accurate and complete registration information</li>
                <li>You are responsible for all activity under your account</li>
                <li>You must not share your account credentials</li>
                <li>One person or legal entity may not maintain more than one free account</li>
              </ul>
            </div>

            <div>
              <h2 className="text-2xl font-bold mb-4">2. API Terms</h2>
              <p className="text-muted-foreground mb-4">
                Customers may access their Lead Eternity account data via our API. Any use of the API, including use of the API through a third-party product that accesses Lead Eternity, is bound by these Terms plus the following specific terms:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>You expressly understand and agree that we shall not be liable for any damages or losses resulting from your use of the API</li>
                <li>Abuse or excessively frequent requests may result in temporary or permanent suspension of your account's access to the API</li>
                <li>We reserve the right to modify or discontinue the API at any time</li>
                <li>You may not use the API to substantially replicate our Service</li>
              </ul>
            </div>

            <div>
              <h2 className="text-2xl font-bold mb-4">3. Payment and Refunds</h2>
              <p className="text-muted-foreground mb-4">
                Our paid plans are offered on a subscription basis and payment is due in advance. Pricing and features are subject to change with notice.
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>All fees are exclusive of all taxes, levies, or duties</li>
                <li>Subscription fees are non-refundable except as required by law</li>
                <li>Downgrading your plan may cause loss of features or capacity</li>
                <li>Unused credits do not roll over to the next billing period</li>
                <li>We reserve the right to change prices with 30 days notice</li>
              </ul>
            </div>

            <div>
              <h2 className="text-2xl font-bold mb-4">4. Intellectual Property</h2>
              <p className="text-muted-foreground mb-4">
                The Service and its original content, features, and functionality are and will remain the exclusive property of Lead Eternity and its licensors. The Service is protected by copyright, trademark, and other laws. Our trademarks and trade dress may not be used in connection with any product or service without our prior written consent.
              </p>
              <p className="text-muted-foreground">
                You retain all rights to data you submit to the Service. By submitting data, you grant us a license to use that data solely to provide the Service to you.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-bold mb-4">5. Privacy and Data Protection</h2>
              <p className="text-muted-foreground mb-4">
                Your use of the Service is also governed by our Privacy Policy. By using the Service, you consent to the collection and use of information as detailed in our Privacy Policy.
              </p>
              <p className="text-muted-foreground">
                You are responsible for complying with all applicable data protection laws when using our Service, including obtaining necessary consents for processing personal data.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-bold mb-4">6. Termination</h2>
              <p className="text-muted-foreground mb-4">
                We may terminate or suspend your account immediately, without prior notice or liability, for any reason, including without limitation if you breach the Terms. Upon termination, your right to use the Service will cease immediately.
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>You may cancel your account at any time through the account settings</li>
                <li>All provisions which by their nature should survive termination shall survive</li>
                <li>We will make reasonable efforts to allow you to export your data upon termination</li>
              </ul>
            </div>

            <div>
              <h2 className="text-2xl font-bold mb-4">7. Disclaimers and Limitations</h2>
              <Card className="border-warning bg-warning/10">
                <CardContent className="p-6">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-6 w-6 text-warning mt-1" />
                    <div className="text-sm">
                      <p className="font-semibold mb-2">Important Legal Notice</p>
                      <p className="text-muted-foreground mb-2">
                        THE SERVICE IS PROVIDED ON AN "AS IS" AND "AS AVAILABLE" BASIS. WE EXPRESSLY DISCLAIM ALL WARRANTIES OF ANY KIND, WHETHER EXPRESS OR IMPLIED.
                      </p>
                      <p className="text-muted-foreground">
                        IN NO EVENT SHALL LEAD ETERNITY BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING WITHOUT LIMITATION, LOSS OF PROFITS, DATA, USE, GOODWILL, OR OTHER INTANGIBLE LOSSES.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div>
              <h2 className="text-2xl font-bold mb-4">8. Indemnification</h2>
              <p className="text-muted-foreground">
                You agree to defend, indemnify, and hold harmless Lead Eternity and its licensees and licensors, and their employees, contractors, agents, officers and directors, from and against any and all claims, damages, obligations, losses, liabilities, costs or debt, and expenses (including but not limited to attorney's fees).
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-bold mb-4">9. Governing Law</h2>
              <p className="text-muted-foreground">
                These Terms shall be governed and construed in accordance with the laws of California, United States, without regard to its conflict of law provisions. Our failure to enforce any right or provision of these Terms will not be considered a waiver of those rights.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-bold mb-4">10. Changes to Terms</h2>
              <p className="text-muted-foreground">
                We reserve the right, at our sole discretion, to modify or replace these Terms at any time. If a revision is material, we will try to provide at least 30 days notice prior to any new terms taking effect. By continuing to access or use our Service after those revisions become effective, you agree to be bound by the revised terms.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-bold mb-4">11. Contact Information</h2>
              <p className="text-muted-foreground mb-4">
                If you have any questions about these Terms, please contact us:
              </p>
              <Card>
                <CardContent className="p-6">
                  <div className="space-y-2">
                    <p>Email: legal@leadeternity.com</p>
                    <p>Address: Lead Eternity, Inc.</p>
                    <p>123 Market Street, Suite 500</p>
                    <p>San Francisco, CA 94105</p>
                    <p>United States</p>
                  </div>
                </CardContent>
              </Card>
            </div>
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