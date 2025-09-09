import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { 
  Bot, 
  Users, 
  Target, 
  Rocket,
  Heart,
  Globe,
  Award,
  Briefcase
} from "lucide-react";
import { Link } from "react-router-dom";

export default function AboutPage() {
  const values = [
    {
      icon: Target,
      title: "Customer-Focused",
      description: "We put our customers at the center of everything we do, constantly iterating based on feedback."
    },
    {
      icon: Rocket,
      title: "Innovation First",
      description: "We leverage cutting-edge AI technology to solve real business problems in new ways."
    },
    {
      icon: Heart,
      title: "Built with Passion",
      description: "Our team is passionate about helping businesses grow through better lead generation."
    },
    {
      icon: Globe,
      title: "Global Impact",
      description: "We're helping businesses worldwide connect with their ideal customers more effectively."
    }
  ];

  const team = [
    {
      name: "Alex Thompson",
      role: "CEO & Founder",
      bio: "Serial entrepreneur with 15+ years in B2B sales and AI technology.",
      avatar: "AT"
    },
    {
      name: "Dr. Sarah Kim",
      role: "CTO",
      bio: "AI researcher from MIT, specializing in natural language processing and machine learning.",
      avatar: "SK"
    },
    {
      name: "Marcus Johnson",
      role: "VP of Sales",
      bio: "Former VP at Salesforce, expert in enterprise sales and go-to-market strategies.",
      avatar: "MJ"
    },
    {
      name: "Emily Chen",
      role: "Head of Product",
      bio: "Product leader with experience at Google and Microsoft, focused on user experience.",
      avatar: "EC"
    }
  ];

  const milestones = [
    { year: "2024", event: "Lead Eternity founded with a vision to democratize AI-powered sales" },
    { year: "2024", event: "Launched beta version with AI-powered lead generation" },
    { year: "2024", event: "Built enterprise-grade pipeline with real-time processing" },
    { year: "2024", event: "Launched production platform for businesses worldwide" }
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
            <Link to="/#features" className="text-sm font-medium hover:text-primary transition-colors">
              Features
            </Link>
            <Link to="/#pricing" className="text-sm font-medium hover:text-primary transition-colors">
              Pricing
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
      <section className="pt-20 pb-16 px-4">
        <div className="container mx-auto text-center max-w-4xl">
          <h1 className="text-4xl md:text-5xl font-bold mb-6">
            About Lead Eternity
          </h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            We're on a mission to help businesses find and connect with their ideal customers using the power of AI.
          </p>
        </div>
      </section>

      {/* Mission Section */}
      <section className="py-16 px-4 bg-muted/30">
        <div className="container mx-auto max-w-5xl">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-bold mb-4">Our Mission</h2>
              <p className="text-lg text-muted-foreground mb-4">
                Lead Eternity was born from a simple observation: finding and connecting with the right prospects is one of the biggest challenges businesses face. Traditional methods are time-consuming, expensive, and often ineffective.
              </p>
              <p className="text-lg text-muted-foreground mb-4">
                We believe that AI can transform this process, making it faster, smarter, and more personalized than ever before. Our mission is to democratize access to AI-powered lead generation, helping businesses of all sizes grow more efficiently.
              </p>
              <p className="text-lg text-muted-foreground">
                By combining advanced AI technology with deep sales expertise, we're building tools that don't just find leads – they help you understand them, connect with them, and convert them into customers.
              </p>
            </div>
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-primary/10 rounded-lg blur-3xl"></div>
              <Card className="relative">
                <CardContent className="p-8">
                  <div className="flex items-center justify-center mb-6">
                    <Bot className="h-24 w-24 text-primary" />
                  </div>
                  <div className="text-center">
                    <div className="text-4xl font-bold mb-2">AI-Powered</div>
                    <div className="text-muted-foreground">Lead Generation</div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 mt-6">
                    <div className="text-center">
                      <div className="text-2xl font-bold">Real-Time</div>
                      <div className="text-sm text-muted-foreground">Processing</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold">Smart</div>
                      <div className="text-sm text-muted-foreground">Personalization</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* Values Section */}
      <section className="py-16 px-4">
        <div className="container mx-auto max-w-5xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Our Values</h2>
            <p className="text-xl text-muted-foreground">
              The principles that guide everything we do
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {values.map((value, index) => (
              <Card key={index}>
                <CardContent className="p-6 text-center">
                  <value.icon className="h-12 w-12 text-primary mx-auto mb-4" />
                  <h3 className="font-semibold mb-2">{value.title}</h3>
                  <p className="text-sm text-muted-foreground">{value.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Timeline Section */}
      <section className="py-16 px-4 bg-muted/30">
        <div className="container mx-auto max-w-5xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Our Journey</h2>
            <p className="text-xl text-muted-foreground">
              From idea to industry leader
            </p>
          </div>

          <div className="relative">
            <div className="absolute left-1/2 transform -translate-x-1/2 h-full w-0.5 bg-border"></div>
            {milestones.map((milestone, index) => (
              <div key={index} className={`relative flex items-center mb-8 ${
                index % 2 === 0 ? 'justify-start' : 'justify-end'
              }`}>
                <div className={`w-1/2 ${index % 2 === 0 ? 'pr-8 text-right' : 'pl-8'}`}>
                  <div className="bg-background p-6 rounded-lg shadow-sm border">
                    <div className="text-primary font-bold mb-2">{milestone.year}</div>
                    <p className="text-muted-foreground">{milestone.event}</p>
                  </div>
                </div>
                <div className="absolute left-1/2 transform -translate-x-1/2 w-4 h-4 bg-primary rounded-full"></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Team Section */}
      <section className="py-16 px-4">
        <div className="container mx-auto max-w-5xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Meet Our Team</h2>
            <p className="text-xl text-muted-foreground">
              The people behind Lead Eternity
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {team.map((member, index) => (
              <Card key={index}>
                <CardContent className="p-6 text-center">
                  <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-2xl font-bold text-primary">{member.avatar}</span>
                  </div>
                  <h3 className="font-semibold mb-1">{member.name}</h3>
                  <p className="text-sm text-primary mb-3">{member.role}</p>
                  <p className="text-sm text-muted-foreground">{member.bio}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Awards Section */}
      <section className="py-16 px-4 bg-muted/30">
        <div className="container mx-auto max-w-5xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Recognition & Awards</h2>
            <p className="text-xl text-muted-foreground">
              Proud to be recognized by industry leaders
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <Card>
              <CardContent className="p-6 text-center">
                <Award className="h-12 w-12 text-primary mx-auto mb-4" />
                <h3 className="font-semibold mb-2">Enterprise-Grade</h3>
                <p className="text-sm text-muted-foreground">Reliability & Security</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6 text-center">
                <Briefcase className="h-12 w-12 text-primary mx-auto mb-4" />
                <h3 className="font-semibold mb-2">Advanced AI</h3>
                <p className="text-sm text-muted-foreground">Multi-Agent System</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6 text-center">
                <Users className="h-12 w-12 text-primary mx-auto mb-4" />
                <h3 className="font-semibold mb-2">Real-Time</h3>
                <p className="text-sm text-muted-foreground">Live Updates</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 px-4">
        <div className="container mx-auto text-center max-w-3xl">
          <h2 className="text-3xl font-bold mb-4">
            Join Us on Our Mission
          </h2>
          <p className="text-xl text-muted-foreground mb-8">
            Whether you're looking to grow your business with better leads or join our team, we'd love to hear from you.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/signup">
              <Button size="lg">Start Free Trial</Button>
            </Link>
            <Link to="/careers">
              <Button size="lg" variant="outline">View Careers</Button>
            </Link>
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