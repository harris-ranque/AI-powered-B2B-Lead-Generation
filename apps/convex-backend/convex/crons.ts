import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Health checks are now performed on-demand when lead generation starts.

export default crons;
