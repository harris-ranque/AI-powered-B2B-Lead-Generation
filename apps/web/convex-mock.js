// Mock Convex generated files for Railway build
const fs = require('fs');
const path = require('path');

// Create directories
const genDir = path.join(__dirname, 'convex', '_generated');
fs.mkdirSync(genDir, { recursive: true });

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
  royalty: {},
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

fs.writeFileSync(path.join(genDir, 'api.ts'), apiContent);
fs.writeFileSync(path.join(genDir, 'api.js'), apiContent);
fs.writeFileSync(path.join(genDir, 'dataModel.ts'), dataModelContent);
fs.writeFileSync(path.join(genDir, 'dataModel.js'), dataModelContent);

console.log('Created mock Convex files for build');