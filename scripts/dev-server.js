#!/usr/bin/env node

/**
 * Development Server Wrapper
 * 
 * This script ensures clean startup of the Next.js development server by:
 * 1. Killing any existing process on port 3000
 * 2. Starting the Next.js dev server
 */

const { spawn, execSync } = require('child_process');
const path = require('path');

const PORT = 3000;

// Kill any existing process on the port
console.log(`[dev-server] Checking for processes on port ${PORT}...`);
try {
  execSync(`node ${path.join(__dirname, 'kill-port.js')} ${PORT}`, {
    stdio: 'inherit'
  });
} catch (error) {
  console.error(`[dev-server] Warning: Failed to kill port: ${error.message}`);
}

// Add a small delay to ensure port is fully released
console.log(`[dev-server] Starting Next.js on port ${PORT}...`);

// Start Next.js dev server
const nextProcess = spawn('next', ['dev', '-p', PORT], {
  stdio: 'inherit',
  env: { 
    ...process.env,
    NEXT_TELEMETRY_DISABLED: '1'
  },
  shell: true
});

// Handle process exit
nextProcess.on('exit', (code) => {
  console.log(`[dev-server] Next.js exited with code ${code}`);
  process.exit(code);
});

// Handle errors
nextProcess.on('error', (error) => {
  console.error(`[dev-server] Error: ${error.message}`);
  process.exit(1);
});

// Forward signals to Next.js process
['SIGINT', 'SIGTERM'].forEach(signal => {
  process.on(signal, () => {
    console.log(`[dev-server] Received ${signal}, shutting down...`);
    nextProcess.kill(signal);
  });
});
