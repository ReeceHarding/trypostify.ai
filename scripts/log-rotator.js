#!/usr/bin/env node

/**
 * Log Rotation Utility
 * 
 * This script handles log rotation to prevent log.txt from growing too large.
 * It creates numbered backup files and compresses old logs.
 * 
 * Usage: node scripts/log-rotator.js [options]
 * Options:
 *   --max-size <size>    Maximum file size in MB before rotation (default: 10)
 *   --max-files <count>  Maximum number of rotated files to keep (default: 5)
 *   --force              Force rotation regardless of file size
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Configuration
const LOG_FILE = path.join(process.cwd(), 'log.txt');
const DEFAULT_MAX_SIZE_MB = 10;
const DEFAULT_MAX_FILES = 5;

/**
 * Get file size in MB
 */
function getFileSizeMB(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.size / (1024 * 1024);
  } catch (error) {
    return 0;
  }
}

/**
 * Get formatted timestamp for log rotation
 */
function getTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Compress a file using gzip
 */
function compressFile(sourcePath, targetPath) {
  return new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(sourcePath);
    const writeStream = fs.createWriteStream(targetPath);
    const gzipStream = zlib.createGzip();

    readStream
      .pipe(gzipStream)
      .pipe(writeStream)
      .on('finish', resolve)
      .on('error', reject);
  });
}

/**
 * Rotate log files
 */
async function rotateLogFiles(maxFiles = DEFAULT_MAX_FILES) {
  const timestamp = getTimestamp();
  const logDir = path.dirname(LOG_FILE);
  
  try {
    // Create logs directory if it doesn't exist
    const logsDir = path.join(logDir, 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // Move current log to timestamped backup
    const backupPath = path.join(logsDir, `log-${timestamp}.txt`);
    fs.renameSync(LOG_FILE, backupPath);
    
    console.log(`[LOG-ROTATOR] Rotated log.txt to ${backupPath}`);

    // Compress the backup file
    const compressedPath = backupPath + '.gz';
    await compressFile(backupPath, compressedPath);
    fs.unlinkSync(backupPath); // Remove uncompressed backup
    
    console.log(`[LOG-ROTATOR] Compressed backup to ${compressedPath}`);

    // Clean up old log files (keep only maxFiles)
    const logFiles = fs.readdirSync(logsDir)
      .filter(file => file.startsWith('log-') && file.endsWith('.gz'))
      .map(file => ({
        name: file,
        path: path.join(logsDir, file),
        mtime: fs.statSync(path.join(logsDir, file)).mtime
      }))
      .sort((a, b) => b.mtime - a.mtime); // Sort by modification time (newest first)

    // Remove excess files
    if (logFiles.length > maxFiles) {
      const filesToDelete = logFiles.slice(maxFiles);
      for (const file of filesToDelete) {
        fs.unlinkSync(file.path);
        console.log(`[LOG-ROTATOR] Deleted old log file: ${file.name}`);
      }
    }

    // Create new empty log file with header
    const newLogHeader = `================================================================================
LOG FILE ROTATED AT ${new Date().toISOString()}
================================================================================
Previous log archived to: logs/log-${timestamp}.txt.gz
Continuing logging in new file...
================================================================================

`;
    
    fs.writeFileSync(LOG_FILE, newLogHeader, 'utf8');
    console.log(`[LOG-ROTATOR] Created new log.txt file`);

  } catch (error) {
    console.error(`[LOG-ROTATOR] Error during rotation: ${error.message}`);
    throw error;
  }
}

/**
 * Check if log rotation is needed
 */
function shouldRotate(maxSizeMB = DEFAULT_MAX_SIZE_MB, force = false) {
  if (force) return true;
  if (!fs.existsSync(LOG_FILE)) return false;
  
  const sizeMB = getFileSizeMB(LOG_FILE);
  return sizeMB >= maxSizeMB;
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  
  // Parse command line arguments
  let maxSizeMB = DEFAULT_MAX_SIZE_MB;
  let maxFiles = DEFAULT_MAX_FILES;
  let force = false;
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--max-size':
        maxSizeMB = parseInt(args[++i]) || DEFAULT_MAX_SIZE_MB;
        break;
      case '--max-files':
        maxFiles = parseInt(args[++i]) || DEFAULT_MAX_FILES;
        break;
      case '--force':
        force = true;
        break;
      case '--help':
        console.log(`
Log Rotation Utility

Usage: node scripts/log-rotator.js [options]

Options:
  --max-size <size>    Maximum file size in MB before rotation (default: ${DEFAULT_MAX_SIZE_MB})
  --max-files <count>  Maximum number of rotated files to keep (default: ${DEFAULT_MAX_FILES})
  --force              Force rotation regardless of file size
  --help               Show this help message

Examples:
  node scripts/log-rotator.js --max-size 5 --max-files 10
  node scripts/log-rotator.js --force
`);
        process.exit(0);
    }
  }

  try {
    const currentSize = getFileSizeMB(LOG_FILE);
    console.log(`[LOG-ROTATOR] Current log file size: ${currentSize.toFixed(2)}MB`);
    console.log(`[LOG-ROTATOR] Maximum allowed size: ${maxSizeMB}MB`);
    
    if (shouldRotate(maxSizeMB, force)) {
      console.log(`[LOG-ROTATOR] ${force ? 'Forced rotation' : 'Size threshold exceeded'}, rotating log files...`);
      await rotateLogFiles(maxFiles);
      console.log(`[LOG-ROTATOR] Log rotation completed successfully`);
    } else {
      console.log(`[LOG-ROTATOR] No rotation needed`);
    }
  } catch (error) {
    console.error(`[LOG-ROTATOR] Error: ${error.message}`);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = {
  rotateLogFiles,
  shouldRotate,
  getFileSizeMB
};
