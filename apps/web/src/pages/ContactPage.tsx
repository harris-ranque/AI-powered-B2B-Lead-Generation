import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Bot,
  Mail,
  MessageSquare,
  Phone,
  MapPin,
  Clock,
  Send,
  Headphones,
  FileText,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

export default function ContactPage() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    company: "",
    subject: "",
    message: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    // Simulate form submission
    await new Promise((resolve) => setTimeout(resolve, 1000));

    toast({
      title: "Message sent!",
      description: "We'll get back to you within 24 hours.",
    });

    setFormData({
      name: "",
      email: "",
      company: "",
      subject: "",
      message: "",
    });
    setIsSubmitting(false);
  };

  const contactMethods = [
    {
      icon: Mail,
      title: "Email Us",
      description: "Send us an email and we'll respond within 24 hours",
      contact: "support@leadeternity.com",
      action: "mailto:support@leadeternity.com",
    },
    {
      icon: MessageSquare,
      title: "Live Chat",
      description: "Chat with our support team in real-time",
      contact: "Available 9am-6pm PST",
      action: "#",
    },
    {
      icon: Phone,
      title: "Call Us",
      description: "Speak directly with our sales team",
      contact: "+1 (555) 123-4567",
      action: "tel:+15551234567",
    },
  ];

  const resources = [
    {
      icon: FileText,
      title: "Documentation",
      description: "Browse our comprehensive docs",
    },
    {
      icon: Headphones,
      title: "Support Center",
      description: "Find answers to common questions",
    },
    {
      icon: Users,
      title: "Community",
      description: "Connect with other users",
    },
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
            <Link
              to="/"
              className="text-sm font-medium hover:text-primary transition-colors"
            >
              Home
            </Link>
            <Link
              to="/#features"
              className="text-sm font-medium hover:text-primary transition-colors"
            >
              Features
            </Link>
            <Link
              to="/#pricing"
              className="text-sm font-medium hover:text-primary transition-colors"
            >
              Pricing
            </Link>
            <Link
              to="/about"
              className="text-sm font-medium hover:text-primary transition-colors"
            >
              About
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
          <h1 className="text-4xl md:text-5xl font-bold mb-6">Get in Touch</h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Have questions about Lead Eternity? We're here to help. Reach out to
            our team and we'll get back to you as soon as possible.
          </p>
        </div>
      </section>

      {/* Contact Methods */}
      <section className="py-8 px-4">
        <div className="container mx-auto max-w-5xl">
          <div className="grid md:grid-cols-3 gap-6 mb-12">
            {contactMethods.map((method, index) => (
              <Card key={index}>
                <CardContent className="p-6">
                  <method.icon className="h-10 w-10 text-primary mb-4" />
                  <h3 className="font-semibold mb-2">{method.title}</h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    {method.description}
                  </p>
                  <a
                    href={method.action}
                    className="text-primary hover:underline font-medium"
                  >
                    {method.contact}
                  </a>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Contact Form Section */}
      <section className="py-16 px-4 bg-muted/30">
        <div className="container mx-auto max-w-5xl">
          <div className="grid lg:grid-cols-2 gap-12">
            {/* Contact Form */}
            <div>
              <Card>
                <CardHeader>
                  <CardTitle>Send us a message</CardTitle>
                  <CardDescription>
                    Fill out the form below and we'll get back to you within 24
                    hours.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                      <Label htmlFor="name">Name</Label>
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) =>
                          setFormData({ ...formData, name: e.target.value })
                        }
                        required
                      />
                    </div>

                    <div>
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        value={formData.email}
                        onChange={(e) =>
                          setFormData({ ...formData, email: e.target.value })
                        }
                        required
                      />
                    </div>

                    <div>
                      <Label htmlFor="company">Company</Label>
                      <Input
                        id="company"
                        value={formData.company}
                        onChange={(e) =>
                          setFormData({ ...formData, company: e.target.value })
                        }
                      />
                    </div>

                    <div>
                      <Label htmlFor="subject">Subject</Label>
                      <Select
                        value={formData.subject}
                        onValueChange={(value) =>
                          setFormData({ ...formData, subject: value })
                        }
                      >
                        <SelectTrigger id="subject">
                          <SelectValue placeholder="Select a subject" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sales">Sales Inquiry</SelectItem>
                          <SelectItem value="support">
                            Technical Support
                          </SelectItem>
                          <SelectItem value="billing">
                            Billing Question
                          </SelectItem>
                          <SelectItem value="partnership">
                            Partnership Opportunity
                          </SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="message">Message</Label>
                      <Textarea
                        id="message"
                        rows={5}
                        value={formData.message}
                        onChange={(e) =>
                          setFormData({ ...formData, message: e.target.value })
                        }
                        placeholder="Tell us how we can help..."
                        required
                      />
                    </div>

                    <Button
                      type="submit"
                      className="w-full"
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? (
                        <>Sending...</>
                      ) : (
                        <>
                          <Send className="h-4 w-4 mr-2" />
                          Send Message
                        </>
                      )}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>

            {/* Additional Info */}
            <div className="space-y-6">
              {/* Office Location */}
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <MapPin className="h-6 w-6 text-primary mt-1" />
                    <div>
                      <h3 className="font-semibold mb-2">Our Office</h3>
                      <p className="text-muted-foreground">
                        Lead Eternity, Inc.
                        <br />
                        123 Market Street, Suite 500
                        <br />
                        San Francisco, CA 94105
                        <br />
                        United States
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Business Hours */}
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <Clock className="h-6 w-6 text-primary mt-1" />
                    <div>
                      <h3 className="font-semibold mb-2">Business Hours</h3>
                      <div className="text-muted-foreground space-y-1">
                        <p>Monday - Friday: 9:00 AM - 6:00 PM PST</p>
                        <p>Saturday - Sunday: Closed</p>
                        <p className="text-sm mt-2">
                          Support available 24/7 for Pro and Enterprise
                          customers
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Quick Resources */}
              <div>
                <h3 className="font-semibold mb-4">Quick Resources</h3>
                <div className="grid grid-cols-1 gap-3">
                  {resources.map((resource, index) => (
                    <Card
                      key={index}
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                          <resource.icon className="h-5 w-5 text-primary" />
                          <div>
                            <h4 className="font-medium text-sm">
                              {resource.title}
                            </h4>
                            <p className="text-xs text-muted-foreground">
                              {resource.description}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Preview */}
      <section className="py-16 px-4">
        <div className="container mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold mb-4">
            Frequently Asked Questions
          </h2>
          <p className="text-xl text-muted-foreground mb-8">
            Can't find what you're looking for? Check out our FAQ section for
            quick answers.
          </p>
          <Link to="/faq">
            <Button size="lg" variant="outline">
              View FAQ
            </Button>
          </Link>
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
                <li>
                  <Link to="/#features" className="hover:text-primary">
                    Features
                  </Link>
                </li>
                <li>
                  <Link to="/#pricing" className="hover:text-primary">
                    Pricing
                  </Link>
                </li>
                <li>
                  <Link to="/api" className="hover:text-primary">
                    API
                  </Link>
                </li>
                <li>
                  <Link to="/integrations" className="hover:text-primary">
                    Integrations
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Company</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  <Link to="/about" className="hover:text-primary">
                    About
                  </Link>
                </li>
                <li>
                  <Link to="/blog" className="hover:text-primary">
                    Blog
                  </Link>
                </li>
                <li>
                  <Link to="/careers" className="hover:text-primary">
                    Careers
                  </Link>
                </li>
                <li>
                  <Link to="/contact" className="hover:text-primary">
                    Contact
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Legal</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  <Link to="/privacy" className="hover:text-primary">
                    Privacy Policy
                  </Link>
                </li>
                <li>
                  <Link to="/terms" className="hover:text-primary">
                    Terms of Service
                  </Link>
                </li>
                <li>
                  <Link to="/security" className="hover:text-primary">
                    Security
                  </Link>
                </li>
                <li>
                  <Link to="/gdpr" className="hover:text-primary">
                    GDPR
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-8 pt-8 border-t text-center text-sm text-muted-foreground">
            <p>
              &copy; {new Date().getFullYear()} Lead Eternity. All rights
              reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
