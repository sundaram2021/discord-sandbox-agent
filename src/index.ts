import { loadEnvFile } from 'node:process';
import { startServer } from './server.ts';

try {
  loadEnvFile();
} catch {
  // Ignore if .env is missing or loaded via environment
}

startServer();
