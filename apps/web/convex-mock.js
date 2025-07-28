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
  users: {},
  profile: {},
  search: {},
  leads: {},
  crewai: {},
  billing: {},
  royalty: {
    config: {
      getDeveloperConfig: ""
    },
    dashboard: {
      getStats: "",
      getPayments: ""
    }
  },
  admin: {},
  notifications: {}
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