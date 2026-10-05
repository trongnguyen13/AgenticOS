import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorkspaceConfig } from './workspace-config.mjs';
const file=path.join(path.dirname(fileURLToPath(import.meta.url)),'config.json');
const config=await loadWorkspaceConfig(file);
console.log(`Local configuration ready: ${file}\nClaude executable: ${config.claudeExecutable}\nRun npm start, then add your project folders in the dashboard.`);
