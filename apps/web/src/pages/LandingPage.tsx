import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  ArrowRight, 
  Bot, 
  CheckCircle, 
  Globe, 
  Mail, 
  Search, 
  Sparkles, 
  TrendingUp,
  Users,
  Zap,
  Shield,
  Clock,
  DollarSign
} from "lucide-react";
import { Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { ErrorBoundaryWrapper } from "@/components/ErrorBoundary";
import { PRICING_CONFIG, getPlanPrice, formatPrice } from "@/lib/pricing-config";

export default function LandingPage() {
  const [isHovered, setIsHovered] = useState<string | null>(null);
  const [hasError, setHasError] = useState(false);

  // Check if we're in a good state to render the landing page
  useEffect(() => {
    try {
      // Basic health checks
      if (typeof window === 'undefined') {
        setHasError(true);
        return;
      }
      
      // Check if critical dependencies are available
      setHasError(false);
    } catch (error) {
      console.error('LandingPage health check failed:', error);
      setHasError(true);
    }
  }, []);

  if (hasError) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <Bot className="h-12 w-12 text-primary mx-auto mb-4" />
            <CardTitle>Lead Eternity</CardTitle>
            <CardDescription>
              We're experiencing a temporary issue. Please try refreshing the page.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button onClick={() => window.location.reload()} className="w-full">
              Refresh Page
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const features = [
    {
      icon: Search,
      title: "Smart Lead Discovery",
      description: "Find high-quality leads with our AI-powered search that analyzes business data from multiple sources."
    },
    {
      icon: Bot,
      title: "AI Email Generation", 
      description: "Generate personalized email sequences with our CrewAI multi-agent system that understands context."
    },
    {
      icon: Globe,
      title: "Real-Time Enrichment",
      description: "Automatically enrich leads with contact information, company data, and social profiles."
    },
    {
      icon: TrendingUp,
      title: "Performance Analytics",
      description: "Track email performance, conversion rates, and ROI with comprehensive analytics dashboards."
    },
    {
      icon: Shield,
      title: "Enterprise Security",
      description: "Bank-level encryption and SOC 2 compliance to keep your data safe and secure."
    },
    {
      icon: Zap,
      title: "API Integration",
      description: "Seamlessly integrate with your existing CRM and marketing tools via our REST API."
    }
  ];

  const testimonials = [
    {
      name: "Sarah Chen",
      role: "VP of Sales, TechCorp",
      content: "Lead Eternity transformed our outreach process. We've seen a 300% increase in qualified leads.",
      avatar: "SC"
    },
    {
      name: "Michael Rodriguez",
      role: "Founder, StartupHub",
      content: "The AI-generated emails are incredibly personalized. Our response rates have never been higher.",
      avatar: "MR"
    },
    {
      name: "Emma Thompson",
      role: "Marketing Director, GrowthCo",
      content: "Finally, a tool that actually understands our business and helps us connect with the right people.",
      avatar: "ET"
    }
  ];

  const pricingPlans = [
    {
      name: "Starter",
      price: formatPrice(getPlanPrice('starter', false)),
      description: "Perfect for trying out Lead Eternity",
      features: [
        "10 searches per month",
        "Up to 25 leads per search",
        "500 lead enrichments per month",
        "Basic lead discovery",
        "Community support"
      ],
      cta: "Get Started Free",
      highlighted: false
    },
    {
      name: "Professional",
      price: formatPrice(getPlanPrice('professional', false)),
      description: "For growing businesses and sales teams",
      features: [
        "50 searches per month",
        "Up to 500 leads per search",
        "25,000 lead enrichments per month",
        "Advanced AI analysis",
        "Email generation",
        "API access",
        "Priority support"
      ],
      cta: "Start Free Trial",
      highlighted: true
    },
    {
      name: "Enterprise",
      price: "Custom",
      description: "For large teams and organizations",
      features: [
        "Unlimited searches",
        "Unlimited leads per search",
        "Unlimited enrichments",
        "Custom AI training",
        "Dedicated account manager",
        "SLA guarantee (99.9% uptime)",
        "White-label options"
      ],
      cta: "Contact Sales",
      highlighted: false
    }
  ];

  return (
    <ErrorBoundaryWrapper>
      <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center space-x-2">
            <Bot className="h-8 w-8 text-primary" />
            <span className="font-bold text-xl">Lead Eternity</span>
          </Link>
          
          <div className="hidden md:flex items-center space-x-8">
            <Link to="#features" className="text-sm font-medium hover:text-primary transition-colors">
              Features
            </Link>
            <Link to="#pricing" className="text-sm font-medium hover:text-primary transition-colors">
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
      <section className="pt-20 pb-32 px-4">
        <div className="container mx-auto text-center max-w-4xl">
          <Badge className="mb-4" variant="secondary">
            <Sparkles className="h-3 w-3 mr-1" />
            AI-Powered Lead Generation
          </Badge>
          
          <h1 className="text-5xl md:text-6xl font-bold mb-6 bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            Find & Convert Your Perfect Leads with AI
          </h1>
          
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Discover high-quality leads, enrich them with contact data, and generate personalized email sequences that convert - all powered by advanced AI.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
            <Link to="/signup">
              <Button size="lg" className="gap-2">
                Start Free Trial
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link to="#demo">
              <Button size="lg" variant="outline">
                Watch Demo
              </Button>
            </Link>
          </div>

          <div className="flex items-center justify-center gap-8 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              No credit card required
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              50 free credits
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              5 minute setup
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 px-4 border-y bg-muted/30">
        <div className="container mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div>
              <div className="text-3xl font-bold">10M+</div>
              <div className="text-sm text-muted-foreground">Leads Generated</div>
            </div>
            <div>
              <div className="text-3xl font-bold">50K+</div>
              <div className="text-sm text-muted-foreground">Active Users</div>
            </div>
            <div>
              <div className="text-3xl font-bold">92%</div>
              <div className="text-sm text-muted-foreground">Customer Satisfaction</div>
            </div>
            <div>
              <div className="text-3xl font-bold">3.5x</div>
              <div className="text-sm text-muted-foreground">Average ROI</div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 px-4">
        <div className="container mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Everything You Need to Scale Your Outreach
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Our comprehensive platform combines AI technology with proven sales strategies to help you connect with the right prospects.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, index) => (
              <Card 
                key={index}
                className={`transition-all duration-200 ${
                  isHovered === feature.title ? 'scale-105 shadow-lg' : ''
                }`}
                onMouseEnter={() => setIsHovered(feature.title)}
                onMouseLeave={() => setIsHovered(null)}
              >
                <CardHeader>
                  <feature.icon className="h-10 w-10 text-primary mb-2" />
                  <CardTitle>{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="py-20 px-4 bg-muted/30">
        <div className="container mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              How Lead Eternity Works
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Four simple steps to transform your lead generation process
            </p>
          </div>

          <div className="grid md:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-primary">1</span>
              </div>
              <h3 className="font-semibold mb-2">Define Your Target</h3>
              <p className="text-sm text-muted-foreground">
                Set your ideal customer profile and search parameters
              </p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-primary">2</span>
              </div>
              <h3 className="font-semibold mb-2">Discover Leads</h3>
              <p className="text-sm text-muted-foreground">
                Our AI searches and analyzes potential leads from multiple sources
              </p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-primary">3</span>
              </div>
              <h3 className="font-semibold mb-2">Generate Emails</h3>
              <p className="text-sm text-muted-foreground">
                AI creates personalized email sequences for each lead
              </p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-primary">4</span>
              </div>
              <h3 className="font-semibold mb-2">Track & Optimize</h3>
              <p className="text-sm text-muted-foreground">
                Monitor performance and continuously improve your campaigns
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section className="py-20 px-4">
        <div className="container mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Loved by Sales Teams Worldwide
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              See what our customers have to say about Lead Eternity
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {testimonials.map((testimonial, index) => (
              <Card key={index}>
                <CardContent className="pt-6">
                  <div className="flex items-center mb-4">
                    <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mr-4">
                      <span className="font-semibold text-primary">
                        {testimonial.avatar}
                      </span>
                    </div>
                    <div>
                      <div className="font-semibold">{testimonial.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {testimonial.role}
                      </div>
                    </div>
                  </div>
                  <p className="text-muted-foreground italic">
                    "{testimonial.content}"
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20 px-4 bg-muted/30">
        <div className="container mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Simple, Transparent Pricing
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Choose the plan that fits your business needs
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {pricingPlans.map((plan, index) => (
              <Card 
                key={index}
                className={plan.highlighted ? 'border-primary shadow-lg scale-105' : ''}
              >
                <CardHeader>
                  {plan.highlighted && (
                    <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">
                      Most Popular
                    </Badge>
                  )}
                  <CardTitle className="text-2xl">{plan.name}</CardTitle>
                  <CardDescription>{plan.description}</CardDescription>
                  <div className="mt-4">
                    <span className="text-4xl font-bold">{plan.price}</span>
                    {plan.price !== "Custom" && <span className="text-muted-foreground">/month</span>}
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 mb-6">
                    {plan.features.map((feature, featureIndex) => (
                      <li key={featureIndex} className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                        <span className="text-sm">{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <Link to="/signup">
                    <Button 
                      className="w-full" 
                      variant={plan.highlighted ? "default" : "outline"}
                    >
                      {plan.cta}
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4">
        <div className="container mx-auto text-center">
          <Card className="bg-primary text-primary-foreground max-w-3xl mx-auto">
            <CardContent className="p-12">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">
                Ready to Supercharge Your Sales?
              </h2>
              <p className="text-xl mb-8 opacity-90">
                Join thousands of businesses using Lead Eternity to generate more qualified leads and close more deals.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link to="/signup">
                  <Button size="lg" variant="secondary" className="gap-2">
                    Start Your Free Trial
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <Link to="/contact">
                  <Button size="lg" variant="outline" className="border-primary-foreground text-primary-foreground hover:bg-primary-foreground hover:text-primary">
                    Talk to Sales
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
                <li><Link to="#features" className="hover:text-primary">Features</Link></li>
                <li><Link to="#pricing" className="hover:text-primary">Pricing</Link></li>
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
    </ErrorBoundaryWrapper>
  );
}