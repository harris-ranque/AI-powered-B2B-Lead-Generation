import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// Initialize global error handling
import './lib/error-handler';

// Log environment status in development
import { logEnvironmentStatus } from './lib/env-validation';
logEnvironmentStatus();

// Trigger redeploy
createRoot(document.getElementById("root")!).render(<App />);
