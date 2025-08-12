// Mock Convex generated files for Railway build
const fs = require('fs');
const path = require('path');

// Create directories for both locations
const genDir = path.join(__dirname, 'convex', '_generated');
const srcGenDir = path.join(__dirname, 'src', 'convex', '_generated');
fs.mkdirSync(genDir, { recursive: true });
fs.mkdirSync(srcGenDir, { recursive: true });

// Create mock api.ts
const apiContent = `
// Auto-generated mock for Railway build
export const api = {
  users: {
    queries: {
      getCurrentUser: "users:queries:getCurrentUser",
      getUserById: "users:queries:getUserById", 
      getUserStats: "users:queries:getUserStats",
      getUserActivity: "users:queries:getUserActivity",
      getUserByEmail: "users:queries:getUserByEmail",
      getUserPreferences: "users:queries:getUserPreferences"
    },
    mutations: {
      updateUser: "users:mutations:updateUser",
      deleteUser: "users:mutations:deleteUser",
      addCredits: "users:mutations:addCredits"
    }
  },
  profile: {
    queries: {
      getProfile: "profile:queries:getProfile"
    },
    mutations: {
      updateProfile: "profile:mutations:updateProfile"
    }
  },
  search: {
    queries: {
      getSearch: "search:queries:getSearch",
      listSearches: "search:queries:listSearches"
    },
    mutations: {
      createSearch: "search:mutations:createSearch"
    },
    actions: {
      startSearch: "search:actions:startSearch"
    }
  },
  leads: {
    queries: {
      getLead: "leads:queries:getLead",
      getLeads: "leads:queries:getLeads"
    },
    mutations: {
      updateLead: "leads:mutations:updateLead"
    }
  },
  crewai: {
    actions: {
      generateEmail: "crewai:actions:generateEmail"
    }
  },
  billing: {
    queries: {
      getBilling: "billing:queries:getBilling"
    },
    mutations: {
      updateBilling: "billing:mutations:updateBilling"
    }
  },
  royalty: {
    config: {
      getDeveloperConfig: "royalty:config:getDeveloperConfig"
    },
    dashboard: {
      getStats: "royalty:dashboard:getStats",
      getPayments: "royalty:dashboard:getPayments"
    }
  },
  admin: {
    queries: {
      getMetrics: "admin:queries:getMetrics"
    }
  },
  notifications: {
    queries: {
      getNotifications: "notifications:queries:getNotifications"
    }
  }
};
`;

// Create mock dataModel.ts
const dataModelContent = `
// Auto-generated mock for Railway build
export type Id<TableName extends string = string> = string & { __tableName: TableName };
export type Doc<TableName extends string = string> = any;
`;

// Write files to both locations
fs.writeFileSync(path.join(genDir, 'api.ts'), apiContent);
fs.writeFileSync(path.join(genDir, 'api.js'), apiContent);
fs.writeFileSync(path.join(genDir, 'dataModel.ts'), dataModelContent);
fs.writeFileSync(path.join(genDir, 'dataModel.js'), dataModelContent);

fs.writeFileSync(path.join(srcGenDir, 'api.ts'), apiContent);
fs.writeFileSync(path.join(srcGenDir, 'api.js'), apiContent);
fs.writeFileSync(path.join(srcGenDir, 'dataModel.ts'), dataModelContent);
fs.writeFileSync(path.join(srcGenDir, 'dataModel.js'), dataModelContent);

console.log('Created mock Convex files for build');