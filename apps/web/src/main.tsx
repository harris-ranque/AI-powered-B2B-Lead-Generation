import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// Initialize global error handling
import './lib/error-handler';

// Initialize logging utility
import { logger } from './utils/logger';

// Log environment status in development
import { logEnvironmentStatus } from './lib/env-validation';
logEnvironmentStatus();

// Log application startup
logger.info('Application starting up', {
  timestamp: new Date().toISOString(),
  environment: import.meta.env.MODE,
  nodeEnv: import.meta.env.NODE_ENV,
  isDevelopment: import.meta.env.MODE === 'development'
});

// Trigger redeploy
createRoot(document.getElementById("root")!).render(<App />);
