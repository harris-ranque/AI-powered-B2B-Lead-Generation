# Email service providers for multi-tenant Convex applications

Based on comprehensive research of Resend, SendGrid, Postmark, AWS SES, and Mailgun, this report provides detailed technical analysis and implementation guidance for integrating email services into your multi-tenant Convex application.

## Comparison matrix across key criteria

### API integration and Convex compatibility

**Resend** stands out with its **official Convex component** (`@convex-dev/resend`), providing built-in features like automatic queueing, batching, durable execution, and rate limiting. The integration requires minimal setup:

```typescript
// Resend - Simplest Convex integration
import { Resend } from "@convex-dev/resend";

export const resend = new Resend(components.resend, {
  testMode: false,
});

export const sendTenantEmail = internalMutation({
  handler: async (ctx) => {
    await resend.sendEmail(
      ctx,
      `${tenant.name} <noreply@${tenant.domain}>`,
      recipient,
      subject,
      htmlContent
    );
  },
});
```

**SendGrid** offers mature Node.js SDK with TypeScript support but requires more boilerplate:

```typescript
// SendGrid - Standard integration
import sgMail from '@sendgrid/mail';

export const sendEmail = action({
  handler: async (ctx, args) => {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    const msg = {
      to: args.to,
      from: `noreply@${args.tenantDomain}`,
      subject: args.subject,
      html: args.html,
    };
    return await sgMail.send(msg);
  },
});
```

**AWS SES** provides the most flexibility but requires more complex setup with IAM policies and configuration sets. **Postmark** and **Mailgun** offer clean APIs with good TypeScript support but lack Convex-specific optimizations.

### Multi-tenant capabilities and domain management

| Provider | Domain Limits | Tenant Isolation Method | White-labeling Support |
|----------|--------------|------------------------|----------------------|
| **Resend** | 1 (Free), 10 (Pro), 1,000 (Scale) | API keys + domains | Excellent - full DNS customization |
| **SendGrid** | 3,000 per account/subuser | Subusers (15 max on Pro) | Strong - link branding included |
| **Postmark** | Unlimited servers | Server-based isolation | Good - per-server domains |
| **AWS SES** | 10,000 per region | Configuration sets | Excellent - cross-account support |
| **Mailgun** | 1,000 on paid plans | Subaccounts (unlimited) | Excellent - complete isolation |

**Resend** excels with simple domain management:
```typescript
// Programmatic domain setup for tenant
await resend.domains.create({
  name: 'tenant1.yoursaas.com',
  region: 'us-east-1'
});
```

**Mailgun's subaccounts** provide the strongest isolation:
```bash
# Create isolated tenant environment
curl -X POST https://api.mailgun.net/v4/accounts/subaccounts \
  -u 'api:PRIMARY_KEY' \
  -F name='tenant-name'
```

### Pricing comparison for multi-tenant scenarios

For a typical multi-tenant SaaS with **50 tenants sending 20,000 emails/month each** (1M total):

| Provider | Base Cost | Multi-domain Cost | Dedicated IPs | Total Monthly |
|----------|-----------|------------------|---------------|---------------|
| **Resend** | $85 (Scale) | Included (1,000 domains) | Add-on pricing | **$85-135** |
| **SendGrid** | $89.95 (Pro) | Included | 1 included | **$89.95** |
| **Postmark** | $799 (1M emails) | Included | $50/IP | **$799-849** |
| **AWS SES** | $100 (1M × $0.10/1k) | Free | $24.95/IP | **$100-250** |
| **Mailgun** | $750 (Scale + overages) | Included | $59/IP | **$750-809** |

**AWS SES** offers the lowest base cost but requires more infrastructure management. **Resend** provides the best value for Convex applications considering the built-in integration features.

### Deliverability and reputation management

**Postmark** leads with a **93.8% delivery rate** and strict transactional-only policy. **SendGrid** offers mature IP warming and reputation tools. **AWS SES** provides extensive reputation dashboard but requires manual monitoring. **Resend** maintains pristine shared IP pools with automatic reputation management. **Mailgun** offers dynamic IP pools with automatic assignment based on domain health.

### Developer experience rankings

1. **Resend** - Official Convex component, excellent docs, React Email integration
2. **Postmark** - Clean API, comprehensive testing tools, 100 templates per server
3. **SendGrid** - Mature ecosystem, extensive SDKs, interactive documentation
4. **Mailgun** - Great API design, sandbox domain, template builder
5. **AWS SES** - Powerful but complex, requires AWS expertise

## Implementation architecture for Convex

### Recommended multi-tenant email architecture

```typescript
// convex/email/config.ts
export const emailConfig = {
  provider: 'resend', // or your chosen provider
  multiTenantStrategy: 'domain-per-tenant',
  isolation: 'configuration-sets',
};

// convex/email/tenant.ts
export const setupTenantEmail = internalMutation({
  args: { 
    tenantId: v.string(), 
    domainName: v.string(),
    tier: v.union(v.literal('free'), v.literal('pro'), v.literal('enterprise'))
  },
  handler: async (ctx, args) => {
    // 1. Create domain for tenant
    const domain = await createTenantDomain(args.domainName);
    
    // 2. Store configuration
    await ctx.db.insert("tenant_email_config", {
      tenantId: args.tenantId,
      domainId: domain.id,
      domainName: args.domainName,
      dnsRecords: domain.dnsRecords,
      verificationStatus: 'pending',
      tier: args.tier,
      dedicatedIp: args.tier === 'enterprise',
    });
    
    // 3. Setup webhooks
    await configureWebhooks(args.tenantId, domain.id);
    
    return domain;
  },
});

// convex/email/send.ts
export const sendTenantEmail = internalMutation({
  args: {
    tenantId: v.string(),
    recipients: v.array(v.string()),
    template: v.string(),
    data: v.any(),
  },
  handler: async (ctx, args) => {
    const config = await ctx.db
      .query("tenant_email_config")
      .withIndex("by_tenant", q => q.eq("tenantId", args.tenantId))
      .first();
    
    if (!config || config.verificationStatus !== 'verified') {
      throw new Error("Domain not verified");
    }
    
    // Apply tenant-specific configuration
    const emailOptions = {
      from: `${config.brandName} <noreply@${config.domainName}>`,
      configurationSet: `tenant-${args.tenantId}`,
      tags: [
        { name: 'tenant', value: args.tenantId },
        { name: 'tier', value: config.tier }
      ],
    };
    
    // Send with chosen provider
    return await sendWithProvider(emailOptions, args.recipients, args.template, args.data);
  },
});
```

### DNS automation workflow

```typescript
// convex/email/verification.ts
export const verifyTenantDomain = internalAction({
  args: { tenantId: v.string() },
  handler: async (ctx, args) => {
    const config = await ctx.runQuery(internal.email.getTenantConfig, { 
      tenantId: args.tenantId 
    });
    
    // Check DNS records
    const dnsValid = await checkDnsRecords(config.domainName, config.dnsRecords);
    
    if (dnsValid) {
      // Verify with provider
      const verified = await verifyWithProvider(config.domainId);
      
      if (verified) {
        await ctx.runMutation(internal.email.updateVerificationStatus, {
          tenantId: args.tenantId,
          status: 'verified'
        });
        
        // Enable sending
        await enableTenantSending(args.tenantId);
      }
    }
    
    return { verified: dnsValid && verified };
  },
});
```

### Webhook handling for multi-tenant events

```typescript
// convex/http.ts
import { httpRouter } from "convex/server";

const http = httpRouter();

http.route({
  path: "/webhooks/email/:tenantId",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const tenantId = req.params.tenantId;
    const signature = req.headers.get('x-webhook-signature');
    
    // Verify webhook authenticity
    if (!verifyWebhookSignature(signature, await req.text())) {
      return new Response("Unauthorized", { status: 401 });
    }
    
    const events = await req.json();
    
    for (const event of events) {
      await ctx.runMutation(internal.email.processEvent, {
        tenantId,
        eventType: event.type,
        messageId: event.messageId,
        recipient: event.recipient,
        timestamp: event.timestamp,
        metadata: event.metadata,
      });
    }
    
    return new Response("OK", { status: 200 });
  }),
});

export default http;
```

## Security and compliance considerations

### API key management best practices

```typescript
// Store provider-specific keys as Convex environment variables
npx convex env set RESEND_API_KEY "re_xxxxxxxxx"
npx convex env set RESEND_WEBHOOK_SECRET "whsec_xxxxxxxxx"

// For multi-provider support
npx convex env set EMAIL_PROVIDER "resend"
npx convex env set EMAIL_API_KEY_RESEND "re_xxxxxxxxx"
npx convex env set EMAIL_API_KEY_SENDGRID "SG.xxxxxxxxx"
```

### Rate limiting implementation

```typescript
export const rateLimitedSend = internalMutation({
  handler: async (ctx, args) => {
    const tenantLimits = {
      free: { hourly: 100, daily: 1000 },
      pro: { hourly: 1000, daily: 10000 },
      enterprise: { hourly: 10000, daily: 100000 },
    };
    
    const usage = await ctx.db
      .query("email_usage")
      .withIndex("by_tenant_hour", q => 
        q.eq("tenantId", args.tenantId)
         .gte("hour", Date.now() - 3600000)
      )
      .collect();
    
    const tier = await getTenantTier(ctx, args.tenantId);
    const limit = tenantLimits[tier];
    
    if (usage.length >= limit.hourly) {
      throw new Error("Hourly email limit exceeded");
    }
    
    // Proceed with sending
    await sendEmail(ctx, args);
    
    // Track usage
    await ctx.db.insert("email_usage", {
      tenantId: args.tenantId,
      hour: Math.floor(Date.now() / 3600000),
      timestamp: Date.now(),
    });
  },
});
```

### GDPR and data retention

All providers offer GDPR compliance, but implementation varies:

- **Resend**: Configurable retention (1-7 days), automatic cleanup
- **SendGrid**: 30-day standard retention, EU data residency available
- **Postmark**: Extended retention add-on ($5-14/month)
- **AWS SES**: CloudWatch logs retention configurable
- **Mailgun**: EU infrastructure with no cross-border transfer

## Support team requirements

Your support team will need to handle:

1. **DNS configuration assistance** - Provide clear documentation with provider-specific DNS records
2. **Domain verification troubleshooting** - Common issues include propagation delays (up to 72 hours)
3. **Deliverability monitoring** - Track bounce rates (<10%), complaint rates (<0.1%)
4. **DMARC policy setup** - Start with `p=none`, gradually move to `p=quarantine`
5. **Suppression list management** - Handle unsubscribes and bounces per tenant

## Final recommendation

For a **multi-tenant Convex application**, I recommend **Resend** as the primary choice for these reasons:

### Why Resend wins:

1. **Official Convex component** eliminates integration complexity and provides production-ready features (queueing, batching, rate limiting)
2. **Excellent multi-domain support** with 1,000 domains on Scale plan covers most multi-tenant needs
3. **Competitive pricing** at $85/month for 100K emails with extensive domain support
4. **Developer-first approach** aligns with Convex's philosophy
5. **Modern React Email integration** simplifies template management
6. **Built-in reliability features** through the Convex component (durable execution, idempotency)

### Alternative recommendations:

- **Choose AWS SES** if you need the absolute lowest cost at high volume (>1M emails/month) and have AWS expertise
- **Choose SendGrid** if you need mature enterprise features and extensive third-party integrations
- **Choose Mailgun** if you need the strongest tenant isolation with unlimited subaccounts
- **Choose Postmark** if deliverability is your absolute top priority (transactional only)

### Implementation timeline:

**Week 1**: Set up Resend with Convex component, implement basic sending
**Week 2**: Add multi-tenant domain management and verification
**Week 3**: Implement webhook handling and bounce management  
**Week 4**: Add template system and testing
**Week 5**: Deploy monitoring and analytics
**Week 6**: Production deployment and documentation

The combination of Resend's official Convex integration, competitive pricing, and robust multi-tenant features makes it the optimal choice for your application's email infrastructure.