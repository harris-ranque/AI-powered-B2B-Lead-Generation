import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { 
  Bot, 
  CheckCircle,
  ArrowRight,
  Star,
  Users,
  CreditCard,
  HeadphonesIcon,
  Shield,
  Zap,
  Globe,
  FileText,
  BarChart3
} from "lucide-react";
import { Link } from "react-router-dom";
import { useState } from "react";

export default function PricingPage() {
  const [isAnnual, setIsAnnual] = useState(false);

  const plans = [
    {
      name: "Free",
      description: "Perfect for trying out Lead Eternity",
      monthlyPrice: 0,
      annualPrice: 0,
      features: [
        "50 credits per month",
        "Up to 25 leads per search",
        "5 searches per month",
        "Email generation",
        "Basic analytics",
        "Community support"
      ],
      limitations: [
        "Limited lead enrichment",
        "Basic email templates",
        "No API access"
      ],
      cta: "Get Started Free",
      highlighted: false,
      popular: false
    },
    {
      name: "Pro",
      description: "For growing businesses and sales teams",
      monthlyPrice: 49,
      annualPrice: 39,
      features: [
        "500 credits per month",
        "Up to 100 leads per search",
        "50 searches per month",
        "Advanced AI analysis",
        "Full lead enrichment",
        "Custom email templates",
        "API access",
        "Priority support",
        "Bulk operations",
        "Advanced analytics",
        "Email sequence automation",
        "CRM integrations"
      ],
      limitations: [],
      cta: "Start Free Trial",
      highlighted: true,
      popular: true
    },
    {
      name: "Enterprise",
      description: "For large teams and organizations",
      monthlyPrice: 199,
      annualPrice: 149,
      features: [
        "2000+ credits per month",
        "Unlimited searches",
        "500 leads per search",
        "Custom AI training",
        "Advanced lead scoring",
        "White-label options",
        "Dedicated account manager",
        "SLA guarantee (99.9% uptime)",
        "Custom integrations",
        "Advanced security features",
        "Team management",
        "Custom reporting",
        "Onboarding & training",
        "24/7 phone support"
      ],
      limitations: [],
      cta: "Contact Sales",
      highlighted: false,
      popular: false
    }
  ];

  const features = [
    {
      icon: Zap,
      title: "AI-Powered Search",
      description: "Find leads with advanced AI algorithms"
    },
    {
      icon: Globe,
      title: "Global Database",
      description: "Access to millions of businesses worldwide"
    },
    {
      icon: FileText,
      title: "Email Generation",
      description: "Personalized emails that convert"
    },
    {
      icon: BarChart3,
      title: "Advanced Analytics",
      description: "Track performance and optimize campaigns"
    },
    {
      icon: Shield,
      title: "Enterprise Security",
      description: "Bank-level encryption and compliance"
    },
    {
      icon: Users,
      title: "Team Collaboration",
      description: "Work together with your sales team"
    }
  ];

  const faqs = [
    {
      question: "What are credits and how do they work?",
      answer: "Credits are used for various actions in Lead Eternity. Lead discovery costs 1 credit, contact enrichment costs 2 credits, AI analysis costs 3 credits, and email generation costs 5 credits. Credits reset each month."
    },
    {
      question: "Can I upgrade or downgrade my plan at any time?",
      answer: "Yes, you can change your plan at any time. Upgrades take effect immediately, while downgrades take effect at the end of your current billing cycle."
    },
    {
      question: "Do you offer refunds?",
      answer: "We offer a 30-day money-back guarantee for annual plans. Monthly plans are non-refundable, but you can cancel at any time."
    },
    {
      question: "Is there a free trial for paid plans?",
      answer: "Yes, we offer a 14-day free trial for all paid plans. No credit card required to start your trial."
    },
    {
      question: "What happens if I exceed my credit limit?",
      answer: "If you exceed your monthly credit limit, you'll be prompted to upgrade your plan or purchase additional credits."
    },
    {
      question: "Do unused credits roll over to the next month?",
      answer: "No, credits reset at the beginning of each billing cycle and don't roll over."
    }
  ];

  const getPrice = (plan: any) => {
    return isAnnual ? plan.annualPrice : plan.monthlyPrice;
  };

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
            <Link to="/#features" className="text-sm font-medium hover:text-primary transition-colors">
              Features
            </Link>
            <Link to="/pricing" className="text-sm font-medium text-primary">
              Pricing
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
              <Button>Get Started Free</Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-20 pb-16 px-4">
        <div className="container mx-auto text-center max-w-4xl">
          <h1 className="text-4xl md:text-5xl font-bold mb-6">
            Simple, Transparent Pricing
          </h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Choose the plan that fits your business needs. Start free and scale as you grow.
          </p>

          {/* Billing Toggle */}
          <div className="flex items-center justify-center gap-4 mb-8">
            <span className={isAnnual ? "text-muted-foreground" : "font-medium"}>Monthly</span>
            <Switch
              checked={isAnnual}
              onCheckedChange={setIsAnnual}
            />
            <span className={isAnnual ? "font-medium" : "text-muted-foreground"}>
              Annual
              <Badge variant="secondary" className="ml-2">Save 20%</Badge>
            </span>
          </div>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="pb-20 px-4">
        <div className="container mx-auto max-w-7xl">
          <div className="grid lg:grid-cols-3 gap-8">
            {plans.map((plan, index) => (
              <Card 
                key={index}
                className={`relative ${plan.highlighted ? 'border-primary shadow-lg scale-105' : ''}`}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-primary-foreground">
                      <Star className="h-3 w-3 mr-1" />
                      Most Popular
                    </Badge>
                  </div>
                )}
                
                <CardHeader className="text-center pb-8">
                  <CardTitle className="text-2xl">{plan.name}</CardTitle>
                  <CardDescription className="text-base">{plan.description}</CardDescription>
                  
                  <div className="mt-4">
                    <div className="flex items-baseline justify-center">
                      <span className="text-5xl font-bold">
                        ${getPrice(plan)}
                      </span>
                      {plan.monthlyPrice > 0 && (
                        <span className="text-muted-foreground ml-2">
                          /{isAnnual ? 'year' : 'month'}
                        </span>
                      )}
                    </div>
                    {isAnnual && plan.monthlyPrice > 0 && (
                      <p className="text-sm text-muted-foreground mt-1">
                        ${plan.monthlyPrice}/month billed annually
                      </p>
                    )}
                  </div>
                </CardHeader>

                <CardContent className="space-y-6">
                  {/* Features */}
                  <div>
                    <h4 className="font-semibold mb-3">Everything included:</h4>
                    <ul className="space-y-2">
                      {plan.features.map((feature, featureIndex) => (
                        <li key={featureIndex} className="flex items-center gap-2">
                          <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                          <span className="text-sm">{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Limitations */}
                  {plan.limitations.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-3 text-muted-foreground">Limitations:</h4>
                      <ul className="space-y-2">
                        {plan.limitations.map((limitation, limitIndex) => (
                          <li key={limitIndex} className="flex items-center gap-2">
                            <span className="h-4 w-4 text-muted-foreground flex-shrink-0">×</span>
                            <span className="text-sm text-muted-foreground">{limitation}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* CTA Button */}
                  <div className="pt-4">
                    {plan.name === "Enterprise" ? (
                      <Link to="/contact">
                        <Button 
                          className="w-full" 
                          variant={plan.highlighted ? "default" : "outline"}
                        >
                          {plan.cta}
                        </Button>
                      </Link>
                    ) : (
                      <Link to="/signup">
                        <Button 
                          className="w-full" 
                          variant={plan.highlighted ? "default" : "outline"}
                        >
                          {plan.cta}
                          <ArrowRight className="h-4 w-4 ml-2" />
                        </Button>
                      </Link>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-20 px-4 bg-muted/30">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">
              Everything You Need to Succeed
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Powerful features to help you find, engage, and convert your ideal customers
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, index) => (
              <Card key={index}>
                <CardContent className="p-6">
                  <feature.icon className="h-10 w-10 text-primary mb-4" />
                  <h3 className="font-semibold mb-2">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-20 px-4">
        <div className="container mx-auto max-w-4xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">
              Frequently Asked Questions
            </h2>
            <p className="text-xl text-muted-foreground">
              Everything you need to know about our pricing and plans
            </p>
          </div>

          <div className="grid gap-6">
            {faqs.map((faq, index) => (
              <Card key={index}>
                <CardContent className="p-6">
                  <h3 className="font-semibold mb-2">{faq.question}</h3>
                  <p className="text-muted-foreground">{faq.answer}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Enterprise CTA */}
      <section className="py-20 px-4 bg-muted/30">
        <div className="container mx-auto text-center max-w-3xl">
          <h2 className="text-3xl font-bold mb-4">
            Need Something Custom?
          </h2>
          <p className="text-xl text-muted-foreground mb-8">
            We work with enterprise teams to create custom solutions that fit your specific needs and scale.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/contact">
              <Button size="lg">
                <HeadphonesIcon className="h-4 w-4 mr-2" />
                Talk to Sales
              </Button>
            </Link>
            <Link to="/signup">
              <Button size="lg" variant="outline">
                Start Free Trial
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 px-4">
        <div className="container mx-auto text-center max-w-3xl">
          <Card className="bg-primary text-primary-foreground">
            <CardContent className="p-12">
              <h2 className="text-3xl font-bold mb-4">
                Ready to Transform Your Lead Generation?
              </h2>
              <p className="text-xl mb-8 opacity-90">
                Join thousands of businesses already using Lead Eternity to find and convert their ideal customers.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link to="/signup">
                  <Button size="lg" variant="secondary">
                    Start Free Trial
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </Link>
                <Link to="/contact">
                  <Button size="lg" variant="outline" className="border-primary-foreground text-primary-foreground hover:bg-primary-foreground hover:text-primary">
                    Schedule Demo
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
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
                <li><Link to="/pricing" className="hover:text-primary">Pricing</Link></li>
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