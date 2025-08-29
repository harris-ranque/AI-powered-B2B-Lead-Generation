// Mock Convex generated files for Railway build
const fs = require('fs');
const path = require('path');

// Create directories for both locations
const genDir = path.join(__dirname, 'convex', '_generated');
const srcGenDir = path.join(__dirname, 'src', 'convex', '_generated');
fs.mkdirSync(genDir, { recursive: true });
fs.mkdirSync(srcGenDir, { recursive: true });

// Create mock api.ts for TypeScript
const apiTsContent = `/* eslint-disable */
/**
 * Generated \`api\` utility mock for Railway build.
 *
 * This mock file allows the frontend to build without the Convex backend running.
 * The actual API will be connected at runtime via environment variables.
 */

// Convex uses a proxy-based API that creates function references dynamically
// We need to replicate this structure for the build to succeed

const anyApi = new Proxy({} as any, {
  get(_, moduleName: string) {
    return new Proxy({}, {
      get(_, functionName: string) {
        return \`\${moduleName}:\${functionName}\`;
      }
    });
  }
});

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * \`\`\`js
 * const myFunctionReference = api.myModule.myFunction;
 * \`\`\`
 */
export const api = anyApi;
export const internal = anyApi;
`;

// Create mock api.js for JavaScript
const apiJsContent = `/* eslint-disable */
/**
 * Generated \`api\` utility mock for Railway build.
 *
 * This mock file allows the frontend to build without the Convex backend running.
 * The actual API will be connected at runtime via environment variables.
 */

// Convex uses a proxy-based API that creates function references dynamically
// We need to replicate this structure for the build to succeed

const anyApi = new Proxy({}, {
  get(_, moduleName) {
    return new Proxy({}, {
      get(_, functionName) {
        return \`\${moduleName}:\${functionName}\`;
      }
    });
  }
});

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * \`\`\`js
 * const myFunctionReference = api.myModule.myFunction;
 * \`\`\`
 */
export const api = anyApi;
export const internal = anyApi;
`;

// Create mock dataModel.ts
const dataModelContent = `
// Auto-generated mock for Railway build
export type Id<TableName extends string = string> = string & { __tableName: TableName };
export type Doc<TableName extends string = string> = any;
`;

// Write files to both locations
fs.writeFileSync(path.join(genDir, 'api.ts'), apiTsContent);
fs.writeFileSync(path.join(genDir, 'api.js'), apiJsContent);
fs.writeFileSync(path.join(genDir, 'dataModel.ts'), dataModelContent);
fs.writeFileSync(path.join(genDir, 'dataModel.js'), dataModelContent);

fs.writeFileSync(path.join(srcGenDir, 'api.ts'), apiTsContent);
fs.writeFileSync(path.join(srcGenDir, 'api.js'), apiJsContent);
fs.writeFileSync(path.join(srcGenDir, 'dataModel.ts'), dataModelContent);
fs.writeFileSync(path.join(srcGenDir, 'dataModel.js'), dataModelContent);

console.log('Created mock Convex files for build');