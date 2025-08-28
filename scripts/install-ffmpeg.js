#!/usr/bin/env node

/**
 * Install FFmpeg binary for Vercel deployment
 * This script downloads and sets up FFmpeg for serverless functions
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const FFMPEG_VERSION = '6.0';
const FFMPEG_URL = 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz';
const INSTALL_DIR = path.join(process.cwd(), 'node_modules', '.bin');

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }
      
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', reject);
  });
}

async function installFFmpeg() {
  console.log('Installing FFmpeg for Vercel deployment...');
  
  // Skip if FFmpeg already exists
  const ffmpegPath = path.join(INSTALL_DIR, 'ffmpeg');
  if (fs.existsSync(ffmpegPath)) {
    console.log('FFmpeg already installed, skipping...');
    return;
  }
  
  try {
    // For Vercel, we'll use a lightweight approach
    // Create a wrapper script that will download FFmpeg on first use
    const wrapperScript = `#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ffmpegPath = '/tmp/ffmpeg';

// Check if FFmpeg exists in /tmp
if (!fs.existsSync(ffmpegPath)) {
  console.log('[FFmpeg] Downloading FFmpeg binary...');
  try {
    // Download static FFmpeg binary
    execSync('cd /tmp && curl -L https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz | tar xJ --strip-components=1', { stdio: 'inherit' });
  } catch (error) {
    console.error('[FFmpeg] Failed to download FFmpeg:', error.message);
    process.exit(1);
  }
}

// Execute FFmpeg with passed arguments
const args = process.argv.slice(2);
try {
  execSync(\`\${ffmpegPath} \${args.join(' ')}\`, { stdio: 'inherit' });
} catch (error) {
  process.exit(error.status || 1);
}
`;

    // Ensure directory exists
    if (!fs.existsSync(INSTALL_DIR)) {
      fs.mkdirSync(INSTALL_DIR, { recursive: true });
    }
    
    // Write wrapper script
    fs.writeFileSync(ffmpegPath, wrapperScript);
    fs.chmodSync(ffmpegPath, '755');
    
    console.log('FFmpeg wrapper installed successfully');
    
  } catch (error) {
    console.error('Failed to install FFmpeg:', error);
    // Don't fail the build if FFmpeg installation fails
    // The app will fall back to Coconut.io
  }
}

// Run installation
if (require.main === module) {
  installFFmpeg().catch(console.error);
}

module.exports = { installFFmpeg };
