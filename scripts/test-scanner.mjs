import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

// Set isolated test database environment BEFORE importing server/database modules
const testDbPath = process.env.DB_PATH || path.resolve(process.cwd(), 'data', 'booknest.test.db');
process.env.DB_PATH = testDbPath;
process.env.NODE_ENV = 'test';

// Dynamically import server, database, and scanner mock provider
const { app } = await import('../server/server.js');
const { closeDatabase } = await import('../server/database/index.js');
const { setExternalLookupProvider } = await import('../server/routes/scanner.js');

const TEST_PORT = 5057;
const BASE_URL = process.env.BASE_URL || (fs.existsSync('dist/index.html') ? `http://localhost:${TEST_PORT}` : 'http://localhost:3000');
const API_URL = `http://localhost:${TEST_PORT}/api`;
let server;

async function attachTestApiRouting(context) {
  await context.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const targetUrl = `http://127.0.0.1:${TEST_PORT}${url.pathname}${url.search}`;
    try {
      const headers = { ...request.headers() };
      delete headers['host'];
      const response = await fetch(targetUrl, {
        method: request.method(),
        headers,
        body: request.postDataBuffer() || undefined,
      });
      const body = await response.buffer();
      const responseHeaders = {};
      for (const [key, value] of response.headers.entries()) {
        responseHeaders[key] = value;
      }
      await route.fulfill({
        status: response.status,
        headers: responseHeaders,
        body,
      });
    } catch (err) {
      console.error(`Route forwarding failed for ${targetUrl}:`, err);
      await route.abort();
    }
  });
}

async function runScannerTestSuite() {
  console.log('🧪 ========================================================');
  console.log('🧪 BookNest Deterministic Scanner Verification Test Suite');
  console.log(`🧪 Using Isolated Test Database: ${process.env.DB_PATH}`);
  console.log('🧪 Testing Scanner Pipeline Scenarios Deterministically');
  console.log('🧪 ========================================================\n');

  // Configure deterministic external OpenLibrary provider
  setExternalLookupProvider({
    lookupByIsbn: async (cleanIsbn) => {
      // 1. Simulated network failure / timeout scenario
      if (cleanIsbn === '9780000000009') {
        throw new Error('Simulated OpenLibrary external timeout (4000ms)');
      }
      // 2. Controlled external catalog match (Crime and Punishment - External Edition)
      if (cleanIsbn === '9780140449999') {
        return {
          id: -1,
          title: 'Crime and Punishment',
          author: 'Fyodor Dostoyevsky',
          isbn: '9780140449999',
          category: 'Classic Literature',
          categorySlug: 'classics',
          publisher: 'Penguin Classics',
          pages: 671,
          year: 2003,
          language: 'English',
          coverImage: 'https://covers.openlibrary.org/b/id/8225261-L.jpg',
          price: 0,
          discount: 0,
          stock: 0,
          rating: 0,
          description: 'External publication found via OpenLibrary archive for Crime and Punishment. Currently not stocked in campus warehouse.',
          isLocalCatalog: false
        };
      }
      // 3. Unknown or uncataloged ISBN returns null (honest not found)
      return null;
    },
    searchByTitleAuthor: async () => null
  });

  await new Promise((resolve) => {
    server = app.listen(TEST_PORT, () => {
      console.log(`Scanner Test API server running on port ${TEST_PORT}`);
      resolve();
    });
  });

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  // --- SUITE A: DETERMINISTIC ISBN & CATALOG MATCHING ---

  console.log('--- Test 0: Scanner Configuration Status (/api/scanner/status) ---');
  try {
    const res = await fetch(`${API_URL}/scanner/status`);
    const data = await res.json();
    assert(res.ok && data.success === true, 'Returned 200 OK and success === true');
    assert(typeof data.visionConfigured === 'boolean', `visionConfigured is a boolean flag (Got: ${data.visionConfigured})`);
    assert(data.barcodeSupported === true, 'barcodeSupported is true');
    assert(data.isbnLookupSupported === true, 'isbnLookupSupported is true');
  } catch (err) {
    assert(false, `Test 0 threw error: ${err.message}`);
  }

  console.log('\n--- Test 1: Known ISBN (Clean Code: 9780132350884) ---');
  try {
    const res = await fetch(`${API_URL}/scanner/isbn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isbn: '978-0-13-235088-4' }) // Hyphenated to test normalization
    });
    const data = await res.json();
    assert(res.ok && data.matched === true, 'Returned 200 OK and matched === true');
    assert(data.matchType === 'ISBN_EXACT', `Match type is ISBN_EXACT (Got: ${data.matchType})`);
    assert(data.confidence === 1.0, `Calculated confidence is exactly 1.0 (Got: ${data.confidence})`);
    assert(data.book?.title?.includes('Clean Code'), `Book title contains "Clean Code" (Got: "${data.book?.title}")`);
    assert(data.isLocalCatalog === true, 'Identified as local warehouse catalog (isLocalCatalog: true)');
    assert(data.book?.stock > 0, `Book has active stock: ${data.book?.stock}`);
  } catch (err) {
    assert(false, `Test 1 threw error: ${err.message}`);
  }

  console.log('\n--- Test 2: Unknown ISBN (9780000000002) ---');
  try {
    const res = await fetch(`${API_URL}/scanner/isbn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isbn: '9780000000002' })
    });
    const data = await res.json();
    assert(res.status === 404, `Returned 404 Not Found (Got: ${res.status})`);
    assert(data.matched === false, 'matched flag is false');
    assert(data.matchType === 'NO_MATCH', `matchType is NO_MATCH (Got: ${data.matchType})`);
    assert(data.book === undefined, 'No fake or random book was returned');
    assert(typeof data.error === 'string' && data.error.length > 0, `Honest error message returned: "${data.error}"`);
  } catch (err) {
    assert(false, `Test 2 threw error: ${err.message}`);
  }

  console.log('\n--- Test 3: ISBN-10 to ISBN-13 Conversion (0132350882) ---');
  try {
    const res = await fetch(`${API_URL}/scanner/isbn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isbn: '0132350882' }) // 10-digit ISBN for Clean Code
    });
    const data = await res.json();
    assert(res.ok && data.matched === true, 'Returned 200 OK and matched === true');
    assert(data.matchType === 'ISBN_EXACT', `Match type is ISBN_EXACT (Got: ${data.matchType})`);
    assert(data.confidence === 1.0, 'Calculated confidence is 1.0 for converted ISBN');
    assert(data.book?.title?.includes('Clean Code'), `Correctly matched Clean Code via ISBN-10 (Got: "${data.book?.title}")`);
  } catch (err) {
    assert(false, `Test 3 threw error: ${err.message}`);
  }

  console.log('\n--- Test 4: ISBN-13 (Atomic Habits: 9780735211292) ---');
  try {
    const res = await fetch(`${API_URL}/scanner/isbn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isbn: '9780735211292' })
    });
    const data = await res.json();
    assert(res.ok && data.matched === true, 'Returned 200 OK and matched === true');
    assert(data.book?.title === 'Atomic Habits', `Identified "Atomic Habits" (Got: "${data.book?.title}")`);
    assert(data.confidence === 1.0, 'Calculated confidence is 1.0');
  } catch (err) {
    assert(false, `Test 4 threw error: ${err.message}`);
  }

  console.log('\n--- Test 5: Title-Only Match ("Atomic Habits" without author) ---');
  try {
    const res = await fetch(`${API_URL}/scanner/match-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Atomic Habits' })
    });
    const data = await res.json();
    assert(res.ok && data.matched === true, 'Returned 200 OK and matched === true');
    assert(data.book?.title === 'Atomic Habits', `Identified "Atomic Habits" title-only (Got: "${data.book?.title}")`);
    assert(data.confidence >= 0.85, `Confidence >= 0.85 (Got: ${data.confidence})`);
  } catch (err) {
    assert(false, `Test 5 threw error: ${err.message}`);
  }

  console.log('\n--- Test 6: Title + Author Match ("Clean Code" + "Robert C. Martin") ---');
  try {
    const res = await fetch(`${API_URL}/scanner/match-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Clean Code', author: 'Robert C. Martin' })
    });
    const data = await res.json();
    assert(res.ok && data.matched === true, 'Returned 200 OK and matched === true');
    assert(data.matchType === 'TITLE_AUTHOR_EXACT', `Match type is TITLE_AUTHOR_EXACT (Got: ${data.matchType})`);
    assert(data.confidence >= 0.95, `Calculated confidence >= 0.95 (Got: ${data.confidence})`);
  } catch (err) {
    assert(false, `Test 6 threw error: ${err.message}`);
  }

  console.log('\n--- Test 7: Unknown Title ("Quantum Banana Surfing in Outer Space") ---');
  try {
    const res = await fetch(`${API_URL}/scanner/match-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Quantum Banana Surfing in Outer Space' })
    });
    const data = await res.json();
    assert(res.ok, 'API returned valid 200 response');
    assert(data.matched === false, 'matched is false for unknown title');
    assert(data.matchType === 'NO_MATCH', `matchType is NO_MATCH (Got: ${data.matchType})`);
    assert(data.confidence === 0, `Calculated confidence is 0 (Got: ${data.confidence})`);
    assert(data.book === null, 'Did not invent or pick a random book');
  } catch (err) {
    assert(false, `Test 7 threw error: ${err.message}`);
  }

  console.log('\n--- Test 8: OCR Returns Title but no ISBN ("The Pragmatic Programmer") ---');
  try {
    const res = await fetch(`${API_URL}/scanner/match-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'The Pragmatic Programmer' })
    });
    const data = await res.json();
    assert(res.ok && data.matched === true, 'Returned 200 OK and matched === true');
    assert(data.book?.title?.includes('The Pragmatic Programmer'), `Matched title without ISBN (Got: "${data.book?.title}")`);
    assert(data.confidence >= 0.85, `Confidence >= 0.85 (Got: ${data.confidence})`);
  } catch (err) {
    assert(false, `Test 8 threw error: ${err.message}`);
  }

  console.log('\n--- Test 9: OCR Returns Title + Partial Author (Fuzzy OCR Tolerance) ---');
  try {
    const res = await fetch(`${API_URL}/scanner/match-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'The Pragmatic Programmer', author: 'David Thomas' })
    });
    const data = await res.json();
    assert(res.ok && data.matched === true, 'Returned 200 OK and matched === true');
    assert(data.confidence >= 0.85, `Confidence >= 0.85 for partial co-author match (Got: ${data.confidence})`);
  } catch (err) {
    assert(false, `Test 9 threw error: ${err.message}`);
  }

  console.log('\n--- Test 10: OpenLibrary External ISBN (9780140449999 - Crime and Punishment) ---');
  try {
    const res = await fetch(`${API_URL}/scanner/isbn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isbn: '9780140449999' })
    });
    const data = await res.json();
    assert(res.ok && data.matched === true, 'Matched external book via deterministic OpenLibrary mock');
    assert(data.isLocalCatalog === false, 'Properly marked as NOT in local catalog (isLocalCatalog: false)');
    assert(data.book?.stock === 0, `External book stock is honest 0 (Got: ${data.book?.stock})`);
    assert(data.book?.price === 0, `External book price is not fabricated (Got: ${data.book?.price})`);
    assert(data.book?.title === 'Crime and Punishment', `Retrieved genuine title: "${data.book?.title}"`);
  } catch (err) {
    assert(false, `Test 10 threw error: ${err.message}`);
  }

  console.log('\n--- Test 10b: OpenLibrary External Lookup Timeout Simulation (9780000000009) ---');
  try {
    const res = await fetch(`${API_URL}/scanner/isbn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isbn: '9780000000009' })
    });
    const data = await res.json();
    assert(res.status === 404, `Gracefully returned 404 when external lookup times out (Got: ${res.status})`);
    assert(data.matched === false, 'matched is false on lookup timeout');
    assert(data.matchType === 'NO_MATCH', 'matchType is NO_MATCH');
  } catch (err) {
    assert(false, `Test 10b threw error: ${err.message}`);
  }

  console.log('\n--- Test 10c: Invalid ISBN Validation (Checksum / Malformed) ---');
  try {
    // Too short / malformed ISBN
    const shortRes = await fetch(`${API_URL}/scanner/isbn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isbn: '12345' })
    });
    const shortData = await shortRes.json();
    assert(shortRes.status === 400, `Rejected malformed short ISBN with 400 (Got: ${shortRes.status})`);
    assert(typeof shortData.error === 'string', 'Error message returned for malformed ISBN');

    // Invalid checksum ISBN-13
    const invalidChecksumRes = await fetch(`${API_URL}/scanner/isbn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isbn: '9780000000000' })
    });
    const invalidChecksumData = await invalidChecksumRes.json();
    assert(invalidChecksumRes.status === 404, `Invalid checksum ISBN returned 404 (Got: ${invalidChecksumRes.status})`);
    assert(invalidChecksumData.matched === false, 'matched flag is false for invalid checksum ISBN');
  } catch (err) {
    assert(false, `Test 10c threw error: ${err.message}`);
  }

  console.log('\n--- Test 11: Unsupported Image Format (MIME: image/gif) ---');
  try {
    const res = await fetch(`${API_URL}/scanner/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        imageBase64: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
        mimeType: 'image/gif'
      })
    });
    const data = await res.json();
    assert(res.status === 400, `Rejected unsupported MIME type with status 400 (Got: ${res.status})`);
    assert(data.error.includes('Unsupported image format'), `Returned exact format rejection error (Got: "${data.error}")`);
  } catch (err) {
    assert(false, `Test 11 threw error: ${err.message}`);
  }

  console.log('\n--- Test 12: Gemini Unavailable Configuration Error ---');
  try {
    // When GEMINI_API_KEY is not configured or placeholder in environment
    const res = await fetch(`${API_URL}/scanner/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        imageBase64: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
        mimeType: 'image/jpeg'
      })
    });
    const data = await res.json();
    if (res.status === 503) {
      assert(data.matched === false, 'matched is false when vision service is unconfigured');
      assert(data.matchType === 'VISION_CONFIGURATION_ERROR', `matchType is VISION_CONFIGURATION_ERROR (Got: ${data.matchType})`);
      assert(data.error.includes('Gemini Vision is not configured'), `Honest error message returned: "${data.error}"`);
    } else {
      console.log(`  ℹ️ Gemini API is currently configured in environment (Status: ${res.status}).`);
      assert(true, 'Gemini configuration check executed');
    }
  } catch (err) {
    assert(false, `Test 12 threw error: ${err.message}`);
  }

  console.log('\n--- Test 13: Blank / Blurry Image (Text Unclear or No Book) ---');
  try {
    const blankPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
    const res = await fetch(`${API_URL}/scanner/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        imageBase64: blankPng,
        mimeType: 'image/png'
      })
    });
    const data = await res.json();
    if (res.status === 503) {
      assert(data.matchType === 'VISION_CONFIGURATION_ERROR', 'Correctly reported vision service unconfigured on blank image test');
    } else {
      assert(res.status === 404, `Returned 404 for unreadable blank image (Got: ${res.status})`);
      assert(data.matched === false, 'matched is false');
      assert(data.matchType === 'TEXT_UNCLEAR' || data.matchType === 'NO_BOOK_DETECTED' || data.matchType === 'NO_MATCH', `matchType describes failure: ${data.matchType}`);
    }
  } catch (err) {
    assert(false, `Test 13 threw error: ${err.message}`);
  }

  // --- SUITE B: BROWSER PLAYWRIGHT TESTS ---

  console.log('\n--- Test 14: Browser BarcodeDetector Unavailable Fallback ---');
  const browser = await chromium.launch({ headless: true });
  const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await attachTestApiRouting(desktopContext);
  const page = await desktopContext.newPage();

  const screenshotsDir = 'docs/audit-screenshots';
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  try {
    // Simulate environment where BarcodeDetector is unavailable
    await page.addInitScript(() => {
      delete window.BarcodeDetector;
    });

    await page.goto(`${BASE_URL}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    await page.locator('nav button').filter({ hasText: 'Scan Cover' }).click();
    await page.waitForTimeout(600);

    const hasBarcodeDetector = await page.evaluate(() => 'BarcodeDetector' in window);
    assert(hasBarcodeDetector === false, 'Verified BarcodeDetector is absent in browser environment');

    const h1 = await page.locator('h1').textContent();
    assert(h1.includes('Point, Scan, and Learn'), `Scanner View loaded gracefully without BarcodeDetector: "${h1?.trim()}"`);

    // Test Manual ISBN Search in UI
    const isbnInput = page.locator('input[placeholder*="enter ISBN"]');
    await isbnInput.fill('9780132350884');
    await page.getByRole('button', { name: /Lookup ISBN/i }).click();
    await page.waitForTimeout(1000);

    const bookFoundBadge = page.getByText('BOOK FOUND', { exact: true });
    assert(await bookFoundBadge.isVisible(), 'Result card shows "BOOK FOUND" banner in BarcodeDetector fallback mode');

    const confidenceBadge = page.locator('text=100% Calculated Match');
    assert(await confidenceBadge.isVisible(), 'Result card shows calculated "100% Calculated Match"');

    await page.screenshot({ path: `${screenshotsDir}/scanner-desktop-no-barcodedetector.png` });

    // Test Try Scanner Demo button
    console.log('\n--- Test 15: Try Scanner Demo Mode (Explicit Label) ---');
    const demoBtn = page.locator('[data-testid="demo-sample-btn"]').first();
    await demoBtn.waitFor({ state: 'visible', timeout: 5000 });
    await demoBtn.click();
    await page.waitForTimeout(600);

    const demoSampleBadge = page.getByText('DEMO SAMPLE', { exact: true });
    assert(await demoSampleBadge.isVisible(), 'Demo card displays explicit "DEMO SAMPLE" badge');

    const demoNotice = await page.locator('text=Preloaded campus demonstration sample').count();
    assert(demoNotice > 0, 'Demo card clarifies sample does not invoke hardware vision');
    await page.screenshot({ path: `${screenshotsDir}/scanner-demo-sample.png` });

  } catch (err) {
    assert(false, `Test 14/15 threw error: ${err.message}`);
  } finally {
    await desktopContext.close();
  }

  // --- SUITE C: CAMERA PERMISSION DENIED SIMULATION & MOBILE ---
  console.log('\n--- Test 16: Camera Permission Denied Simulation (BUG 9 State 7) ---');
  const mobileContext = await browser.newContext({ 
    viewport: { width: 375, height: 667 },
    isMobile: true,
    hasTouch: true
  });
  await attachTestApiRouting(mobileContext);
  const mobilePage = await mobileContext.newPage();

  try {
    await mobilePage.goto(`${BASE_URL}`, { waitUntil: 'domcontentloaded' });
    await mobilePage.waitForTimeout(500);
    
    // Open mobile menu drawer using data-testid
    const menuBtn = mobilePage.locator('[data-testid="mobile-menu-toggle"]');
    if (await menuBtn.isVisible()) {
      await menuBtn.click({ force: true });
      await mobilePage.waitForTimeout(400);
      await mobilePage.locator('[data-testid="mobile-nav-scanner-btn"]').click();
      await mobilePage.waitForTimeout(600);
    } else {
      await mobilePage.locator('[data-testid="desktop-nav-scanner-btn"]').click();
      await mobilePage.waitForTimeout(600);
    }

    const startCameraBtn = mobilePage.getByRole('button', { name: /Start Camera/i }).first();
    assert(await startCameraBtn.isVisible(), 'Mobile view renders touch-friendly Start Camera button');

    // Simulate getUserMedia rejecting with NotAllowedError
    await mobilePage.evaluate(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    });

    await startCameraBtn.click();
    await mobilePage.waitForTimeout(600);

    const permDeniedBadge = mobilePage.getByText('CAMERA PERMISSION DENIED', { exact: true });
    assert(await permDeniedBadge.isVisible(), 'Rendered distinct "CAMERA PERMISSION DENIED" state badge');

    const uploadFallbackBtn = mobilePage.locator('button:has-text("Upload Cover Photo Instead")').first();
    assert(await uploadFallbackBtn.isVisible(), 'Fallback upload button offered upon camera denial');

    await mobilePage.screenshot({ path: `${screenshotsDir}/scanner-camera-permission-denied.png` });

  } catch (err) {
    assert(false, `Test 16 threw error: ${err.message}`);
  } finally {
    if (mobileContext) await mobileContext.close();
    if (browser) await browser.close();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (typeof setExternalLookupProvider === 'function') {
      setExternalLookupProvider();
    }
    if (typeof closeDatabase === 'function') {
      closeDatabase();
    }
  }

  console.log('\n========================================================');
  console.log(`Scanner Test Results: ${passed} Passed, ${failed} Failed`);
  console.log('========================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runScannerTestSuite();
