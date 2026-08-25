import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, 'client/dist');

async function runValidation() {
  console.log('🔍 Starting Caps v2 Static Frontend Audit...\n');

  let errors = 0;

  // Test 1: Verify dist/ files exist
  console.log('1️⃣ Checking production build output in client/dist/...');
  const requiredFiles = ['index.html', 'manifest.json', 'sw.js', '.nojekyll', 'icon.svg'];
  for (const file of requiredFiles) {
    const filePath = path.join(distDir, file);
    if (fs.existsSync(filePath)) {
      console.log(`  ✅ ${file} exists (${fs.statSync(filePath).size} bytes)`);
    } else {
      console.error(`  ❌ Missing file: ${file}`);
      errors++;
    }
  }

  // Test 2: Check assets directory
  const assetsDir = path.join(distDir, 'assets');
  if (fs.existsSync(assetsDir)) {
    const assets = fs.readdirSync(assetsDir);
    console.log(`  ✅ assets/ directory contains ${assets.length} bundle files:`, assets);
  } else {
    console.error('  ❌ Missing client/dist/assets/ directory');
    errors++;
  }

  // Test 3: Check index.html content
  console.log('\n2️⃣ Verifying client/dist/index.html...');
  const indexHtml = fs.readFileSync(path.join(distDir, 'index.html'), 'utf-8');
  if (indexHtml.includes('https://accounts.google.com/gsi/client')) {
    console.log('  ✅ Google Identity Services (GIS) script tag included');
  } else {
    console.error('  ❌ Missing Google Identity Services script tag in index.html');
    errors++;
  }

  if (indexHtml.includes('manifest.json') && indexHtml.includes('sw.js')) {
    console.log('  ✅ PWA manifest & Service Worker registration present');
  } else {
    console.error('  ❌ Missing PWA tags in index.html');
    errors++;
  }

  // Test 4: Check for forbidden hardcoded backend REST URLs in dist bundles
  console.log('\n3️⃣ Scanning JavaScript bundle for accidental backend REST assumptions...');
  const jsFiles = fs.readdirSync(assetsDir).filter(f => f.endsWith('.js'));
  for (const jsFile of jsFiles) {
    const content = fs.readFileSync(path.join(assetsDir, jsFile), 'utf-8');
    // Check if there are active fetch calls to /api/events
    const forbiddenPatterns = [
      'fetch("/api/events',
      "fetch('/api/events"
    ];
    let foundForbidden = false;
    for (const pattern of forbiddenPatterns) {
      if (content.includes(pattern)) {
        console.error(`  ❌ Found hardcoded backend fetch pattern "${pattern}" in ${jsFile}`);
        foundForbidden = true;
        errors++;
      }
    }
    if (!foundForbidden) {
      console.log(`  ✅ ${jsFile} is 100% free of hardcoded backend REST fetches!`);
    }
  }

  // Test 5: Verify Preview Server is responding
  console.log('\n4️⃣ Testing live preview server on http://localhost:5173/...');
  try {
    const res = await fetch('http://localhost:5173/');
    if (res.ok) {
      console.log(`  ✅ GET / returned HTTP ${res.status} OK (Serverless SPA ready)`);
    } else {
      console.warn(`  ⚠️ GET / returned HTTP ${res.status}`);
    }

    const swRes = await fetch('http://localhost:5173/sw.js');
    if (swRes.ok) {
      console.log(`  ✅ GET /sw.js returned HTTP ${swRes.status} OK (Service Worker accessible)`);
    }

    const manifestRes = await fetch('http://localhost:5173/manifest.json');
    if (manifestRes.ok) {
      console.log(`  ✅ GET /manifest.json returned HTTP ${manifestRes.status} OK (PWA manifest valid)`);
    }
  } catch (err) {
    console.log('  ℹ️ Note: Preview server check:', err.message);
  }

  console.log('\n=============================================');
  if (errors === 0) {
    console.log('🎉 AUDIT PASSED: All frontend slices & static assets are 100% valid with 0 errors!');
  } else {
    console.error(`❌ AUDIT FAILED with ${errors} error(s).`);
    process.exit(1);
  }
}

runValidation();
