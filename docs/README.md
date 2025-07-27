# Lead Eternity

🚀 **AI-Powered Lead Generation Platform** with 5-Agent Personalization System

A sophisticated lead generation platform that combines intelligent lead discovery with AI-powered personalized email creation using CrewAI multi-agent systems.

## ✨ What Makes Lead Eternity Unique

- **5-Agent AI System**: Comprehensive lead analysis and email personalization
- **Real-time Lead Discovery**: Intelligent search with instant AI analysis
- **Personalization at Scale**: Each email crafted specifically for the target lead
- **Full-Stack Integration**: Frontend + AI Worker + Backend (Convex) architecture
- **Production Ready**: Built with modern stack and deployment-ready configuration

## 🏗️ Architecture

This monorepo contains:

- **Frontend**: React 18 + TypeScript + Vite with shadcn/ui components
- **CrewAI Worker**: Python FastAPI service with 5-agent AI system
- **Backend**: Convex real-time database (separate repository: `lead-eternity-convex`)
- **API Client**: Full TypeScript integration between frontend and AI worker

## 📁 Project Structure

```
lead-eternity-app/
├── apps/
│   ├── web/                     # Next.js frontend
│   └── crewai-worker/           # Python CrewAI service
├── packages/
│   └── shared-types/            # Shared TypeScript types
├── scripts/                     # Setup and deployment scripts
├── package.json                 # Root package.json
├── pnpm-workspace.yaml         # PNPM workspace config
└── turbo.json                  # Turborepo config
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ 
- Python 3.11+
- pnpm (`npm install -g pnpm`)
- OpenAI API key

### One-Command Setup

```bash
git clone <repository-url>
cd lead-eternity-app
chmod +x scripts/start-development.sh
./scripts/start-development.sh
```

**That's it!** The script will:
1. Install all dependencies (Node.js + Python)
2. Create environment files from examples
3. Start both frontend and CrewAI worker

### Manual Setup (Alternative)

1. **Install dependencies:**
   ```bash
   pnpm install
   cd apps/crewai-worker && pip install -r requirements.txt && cd ../..
   ```

2. **Configure environment:**
   ```bash
   cp apps/web/.env.example apps/web/.env
   cp apps/crewai-worker/.env.example apps/crewai-worker/.env
   # Edit apps/crewai-worker/.env and add your OpenAI API key
   ```

3. **Start development:**
   ```bash
   pnpm dev
   ```

### Access Points

- **Frontend**: http://localhost:3000 (React app with AI email generator)
- **CrewAI API**: http://localhost:8080 (FastAPI with 5-agent system)
- **API Docs**: http://localhost:8080/docs (Interactive API documentation)

## 🛠️ Development

### Available Scripts

- `pnpm dev` - Start all development servers
- `pnpm build` - Build all apps for production
- `pnpm lint` - Run linting across all apps
- `pnpm type-check` - Run TypeScript checks
- `pnpm clean` - Clean all build artifacts

### Project-Specific Scripts

**Frontend (apps/web):**
```bash
cd apps/web
pnpm dev      # Start Next.js dev server
pnpm build    # Build for production
pnpm lint     # Run ESLint
```

**CrewAI Worker (apps/crewai-worker):**
```bash
cd apps/crewai-worker
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8080
```

## 🧠 AI System Architecture

### CrewAI Multi-Agent System

The CrewAI worker implements a 5-agent system for intelligent email generation:

1. **Relevance Analyzer** - Determines lead relevance
2. **Pain Point Researcher** - Identifies customer pain points
3. **Value Matcher** - Matches solutions to problems
4. **Email Writer** - Crafts personalized emails
5. **Follow-up Strategist** - Plans email sequences

### Agent Workflow

```
Lead Data → Relevance Analyzer → Pain Point Researcher → Value Matcher → Email Writer → Follow-up Strategist → Email Sequence
```

## 🔧 Configuration

### Environment Variables

**Frontend (.env.local):**
```env
NEXT_PUBLIC_CONVEX_URL=your_convex_url
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
NEXT_PUBLIC_POSTHOG_KEY=phc_...
```

**CrewAI Worker (.env):**
```env
API_KEY=your_secure_api_key
OPENAI_API_KEY=sk-...
WEBHOOK_URL=your_convex_webhook_url
PORT=8080
```

### Convex Backend Setup

The backend is in a separate repository. See `lead-eternity-convex` for:
- Database schema
- Authentication
- API endpoints
- Real-time subscriptions
- Billing integration

## 🚀 Deployment

### Railway Deployment

1. **Deploy frontend and CrewAI worker:**
   ```bash
   ./scripts/deploy.sh
   ```

2. **Deploy Convex backend separately:**
   ```bash
   cd ../lead-eternity-convex
   npx convex deploy
   ```

### Environment Setup

Ensure all environment variables are configured in your deployment platform:

- Railway: Set environment variables in project settings
- Convex: Use `npx convex env set` for environment variables

## 🎯 Key Features

- **AI-Powered Lead Generation**: Multi-agent system for intelligent lead analysis
- **Personalized Email Sequences**: Custom email campaigns based on lead analysis
- **Real-time Dashboard**: Live updates on search progress and results
- **Credit-Based Billing**: Stripe integration with usage tracking
- **Admin Dashboard**: User management and system metrics
- **Royalty System**: Developer revenue sharing system

## 🔒 Security

- API key authentication for CrewAI worker
- Role-based access control (RBAC)
- Rate limiting on API endpoints
- Input validation and sanitization
- Environment variable protection

## 📊 Monitoring

- Real-time system health monitoring
- User activity tracking
- Performance metrics
- Error logging and alerting

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📄 License

This project is proprietary software. All rights reserved.

## 🆘 Support

For technical support or questions:
- Create an issue in the repository
- Contact the development team
- Check the documentation in `/docs`

---

Built with ❤️ using Next.js, CrewAI, and Convex.