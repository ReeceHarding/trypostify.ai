#!/usr/bin/env node

/**
 * Kill Port Utility
 * 
 * This script kills any process listening on a specified port.
 * Used to ensure clean restarts of development servers.
 */

const { execSync } = require('child_process');

// Get port from command line or default to 3000
const port = process.argv[2] || '3000';

try {
  // Get PIDs of processes listening on the port
  const pids = execSync(`lsof -n -P -tiTCP:${port} -sTCP:LISTEN 2>/dev/null || true`, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'] // Suppress stderr
  }).trim();

  if (pids) {
    const pidArray = pids.split('\n').filter(pid => pid);
    console.log(`[kill-port] Found ${pidArray.length} process(es) on port ${port}: ${pidArray.join(', ')}`);
    
    // Kill each PID
    pidArray.forEach(pid => {
      try {
        execSync(`kill -9 ${pid}`);
        console.log(`[kill-port] Killed process ${pid}`);
      } catch (error) {
        console.warn(`[kill-port] Failed to kill process ${pid}: ${error.message}`);
      }
    });
    
    console.log(`[kill-port] Port ${port} is now free`);
  } else {
    console.log(`[kill-port] No process found on port ${port}`);
  }
} catch (error) {
  console.error(`[kill-port] Error: ${error.message}`);
  process.exit(1);
}
