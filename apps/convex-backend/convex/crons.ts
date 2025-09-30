import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// LangGraph Worker Health Check - Every 2 minutes
crons.interval(
  "check_langgraph_health",
  { minutes: 2 },
  internal.langgraph.health.checkLangGraphHealth,
);

export default crons;
