import { cronJobs } from "convex/server";

const crons = cronJobs();

// Only include crons for modules that still exist
// All other crons commented out until modules are restored

export default crons;