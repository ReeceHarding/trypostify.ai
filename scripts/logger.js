#!/usr/bin/env node

/**
 * Terminal Logger Utility
 * 
 * This script captures all terminal output and logs it to log.txt with timestamps.
 * It handles both stdout and stderr, preserves original output, and adds proper formatting.
 * 
 * Usage: node scripts/logger.js [options] "command to run"
 * Options:
 *   --clear    Clear log.txt before starting (useful for dev sessions)
 * 
 * Examples: 
 *   node scripts/logger.js "npm run build"
 *   node scripts/logger.js --clear "npm run dev"
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Import log rotation functionality
const { shouldRotate, rotateLogFiles, getFileSizeMB } = require('./log-rotator.js');

// Path to log file
const LOG_FILE = path.join(process.cwd(), 'log.txt');

/**
 * Get formatted timestamp
 */
function getTimestamp() {
  return new Date().toISOString();
}

/**
 * Write to log file with timestamp
 */
function writeToLog(message, type = 'INFO') {
  const timestamp = getTimestamp();
  const logEntry = `[${timestamp}] [${type}] ${message}\n`;
  
  // Append to log file
  fs.appendFileSync(LOG_FILE, logEntry, 'utf8');
}

/**
 * Initialize log file with session header
 */
async function initializeLog(shouldClear = false, command = '') {
  const timestamp = getTimestamp();
  
  // Clear log file if requested (for dev sessions)
  if (shouldClear) {
    console.log(`[LOGGER] Clearing previous log content...`);
    fs.writeFileSync(LOG_FILE, '', 'utf8');
  } else {
    // Check if log rotation is needed before starting new session (only when not clearing)
    try {
      const currentSize = getFileSizeMB(LOG_FILE);
      if (shouldRotate(10)) { // Rotate if file is larger than 10MB
        console.log(`[LOGGER] Log file size (${currentSize.toFixed(2)}MB) exceeds limit. Rotating logs...`);
        await rotateLogFiles(5);
        console.log(`[LOGGER] Log rotation completed.`);
      }
    } catch (error) {
      console.warn(`[LOGGER] Warning: Log rotation failed: ${error.message}`);
    }
  }
  
  const separator = '='.repeat(80);
  const header = `
${separator}
NEW TERMINAL SESSION STARTED${shouldClear ? ' (FRESH LOG)' : ''}
${separator}
Session started at: ${timestamp}
Working directory: ${process.cwd()}
Command: ${command}
Node version: ${process.version}
Platform: ${process.platform}
Log cleared: ${shouldClear ? 'YES' : 'NO'}
${separator}

`;
  
  fs.appendFileSync(LOG_FILE, header, 'utf8');
  console.log(`[LOGGER] Logging session started${shouldClear ? ' (fresh log)' : ''}. All output will be captured to log.txt`);
}

/**
 * Log session end
 */
function finalizeLog(exitCode = 0) {
  const timestamp = getTimestamp();
  const separator = '='.repeat(80);
  const footer = `
${separator}
TERMINAL SESSION ENDED
${separator}
Session ended at: ${timestamp}
Exit code: ${exitCode}
${separator}

`;
  
  fs.appendFileSync(LOG_FILE, footer, 'utf8');
  console.log(`[LOGGER] Session ended. Check log.txt for complete output.`);
}

/**
 * Main logging function
 */
async function runWithLogging() {
  // Parse arguments
  const args = process.argv.slice(2);
  let shouldClear = false;
  let command = '';
  
  // Check for flags
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--clear') {
      shouldClear = true;
    } else if (args[i] === '--help') {
      console.log(`
Terminal Logger Utility

Usage: node scripts/logger.js [options] "command to run"

Options:
  --clear    Clear log.txt before starting (useful for dev sessions)
  --help     Show this help message

Examples:
  node scripts/logger.js "npm run build"
  node scripts/logger.js --clear "npm run dev"
`);
      process.exit(0);
    } else {
      // This should be the command
      command = args[i];
      break;
    }
  }
  
  if (!command) {
    console.error('Usage: node scripts/logger.js [options] "command to run"');
    console.error('Use --help for more information');
    process.exit(1);
  }

  // Initialize log (now async for rotation check)
  await initializeLog(shouldClear, command);

  // Log the command being executed
  writeToLog(`Executing command: ${command}`, 'COMMAND');

  // Parse command and arguments
  const [cmd, ...cmdArgs] = command.split(' ');

  // Spawn the process
  const child = spawn(cmd, cmdArgs, {
    stdio: 'pipe',
    shell: true,
    env: {
      ...process.env,
      // Suppress font warnings
      TERM: 'xterm',
      LC_ALL: 'C'
    }
  });

  // Handle stdout
  child.stdout.on('data', (data) => {
    const output = data.toString();
    
    // Write to log file
    writeToLog(output.trim(), 'STDOUT');
    
    // Also display in console (preserve original behavior)
    process.stdout.write(output);
  });

  // Handle stderr
  child.stderr.on('data', (data) => {
    const output = data.toString();
    
    // Filter out font private use area warnings and binary data to prevent log spam
    if (!output.includes('Warning: Ran out of space in font private use area')) {
      // Additional check for binary data - if output contains mostly non-printable characters, skip it
      const printableRatio = output.replace(/[^\x20-\x7E\n\r\t]/g, '').length / output.length;
      
      if (printableRatio > 0.9) { // Only log if at least 90% printable characters
        // Write to log file
        writeToLog(output.trim(), 'STDERR');
        
        // Also display in console (preserve original behavior)
        process.stderr.write(output);
      }
    }
  });

  // Handle process exit
  child.on('close', (code) => {
    writeToLog(`Process exited with code: ${code}`, 'EXIT');
    finalizeLog(code);
    process.exit(code);
  });

  // Handle process error
  child.on('error', (error) => {
    writeToLog(`Process error: ${error.message}`, 'ERROR');
    console.error(`Process error: ${error.message}`);
    finalizeLog(1);
    process.exit(1);
  });

  // Handle CTRL+C and other signals
  process.on('SIGINT', () => {
    writeToLog('Process interrupted by user (SIGINT)', 'SIGNAL');
    child.kill('SIGINT');
    finalizeLog(130);
    process.exit(130);
  });

  process.on('SIGTERM', () => {
    writeToLog('Process terminated (SIGTERM)', 'SIGNAL');
    child.kill('SIGTERM');
    finalizeLog(143);
    process.exit(143);
  });
}

// Ensure log directory exists
const logDir = path.dirname(LOG_FILE);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Run the logger (async)
runWithLogging().catch(error => {
  console.error(`[LOGGER] Fatal error: ${error.message}`);
  process.exit(1);
});
