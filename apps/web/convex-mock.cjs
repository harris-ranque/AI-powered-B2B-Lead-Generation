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
      getCurrentUserData: "users:queries:getCurrentUserData",
      getUserById: "users:queries:getUserById", 
      getUserStats: "users:queries:getUserStats",
      getUserActivity: "users:queries:getUserActivity",
      getUserByEmail: "users:queries:getUserByEmail",
      getUserPreferences: "users:queries:getUserPreferences",
      getUserCredits: "users:queries:getUserCredits",
      listUsers: "users:queries:listUsers"
    },
    mutations: {
      updateProfile: "users:mutations:updateProfile",
      deleteAccount: "users:mutations:deleteAccount",
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
      getUserSearches: "search:queries:getUserSearches",
      getSearchById: "search:queries:getSearchById",
      getSearchResults: "search:queries:getSearchResults",
      getSearchAnalytics: "search:queries:getSearchAnalytics"
    },
    mutations: {
      createSearch: "search:mutations:createSearch",
      updateSearchStatus: "search:mutations:updateSearchStatus",
      updateSearchProgress: "search:mutations:updateSearchProgress",
      cancelSearch: "search:mutations:cancelSearch",
      deleteSearch: "search:mutations:deleteSearch",
      duplicateSearch: "search:mutations:duplicateSearch"
    },
    actions: {
      startSearch: "search:actions:startSearch",
      searchGoogleMaps: "search:actions:searchGoogleMaps"
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
      updateSubscription: "billing:mutations:updateSubscription",
      purchaseCredits: "billing:mutations:purchaseCredits",
      createCheckoutSession: "billing:mutations:createCheckoutSession"
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
      getUserNotifications: "notifications:queries:getUserNotifications",
      getNotificationCounts: "notifications:queries:getNotificationCounts"
    },
    mutations: {
      markAsRead: "notifications:mutations:markAsRead",
      markAllAsRead: "notifications:mutations:markAllAsRead",
      deleteNotification: "notifications:mutations:deleteNotification"
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