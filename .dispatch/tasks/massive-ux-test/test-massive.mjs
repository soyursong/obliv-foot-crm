/**
 * Massive UX Test - Multi-browser scenarios for 200-300 patient/day clinic
 * Tests the 종로 롱래스팅센터 with pre-loaded data (25 check-ins, 35 reservations)
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const APP_URL = 'https://happy-flow-queue.lovable.app';
const CHECKIN_URL = `${APP_URL}/jongno-longlasting`;
const ADMIN_URL = `${APP_URL}/admin`;
const LOGIN_EMAIL = 'sh.kim@medibuilder.com';
const LOGIN_PASS = 'sumeter1';
const SCREENSHOT_DIR = join(import.meta.dirname, 'screenshots');

mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function screenshot(page, name) {
  const path = join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log(`  📸 ${name}`);
  return path;
}

async function screenshotFull(page, name) {
  const path = join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  console.log(`  📸 ${name} (full)`);
  return path;
}

async function loginAdmin(page) {
  await page.goto(ADMIN_URL);
  await page.waitForTimeout(2000);

  // Check if already logged in
  const url = page.url();
  if (url.includes('/admin/dashboard') || url.includes('/admin/reservations')) {
    return;
  }

  // Login
  await page.fill('input[type="email"]', LOGIN_EMAIL);
  await page.fill('input[type="password"]', LOGIN_PASS);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
}

async function selectClinic(page) {
  // Select 종로 clinic if dropdown exists
  try {
    const clinicSelect = await page.$('[data-testid="clinic-select"], select, [role="combobox"]');
    if (clinicSelect) {
      // Try to find and click 종로
      await clinicSelect.click();
      await page.waitForTimeout(500);
      const option = await page.$('text=종로');
      if (option) await option.click();
    }
  } catch (e) {
    // Clinic may be auto-selected
  }
}

// ====== SCENARIO 1: Morning Peak ======
async function scenario1_morningPeak(browser) {
  console.log('\n=== SCENARIO 1: Morning Peak (5 concurrent check-ins + coordinator + manager) ===');

  // Create 3 browser contexts
  const adminCtx1 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const adminCtx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const customerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  const admin1 = await adminCtx1.newPage();
  const admin2 = await adminCtx2.newPage();
  const customer = await customerCtx.newPage();

  // Login both admins in parallel
  await Promise.all([loginAdmin(admin1), loginAdmin(admin2)]);

  // Admin1 goes to dashboard (coordinator view)
  await admin1.goto(`${APP_URL}/admin/dashboard`);
  await admin1.waitForTimeout(3000);
  await screenshot(admin1, 's1_dashboard_full_1440x900');

  // Admin2 goes to reservations (TM view)
  await admin2.goto(`${APP_URL}/admin/reservations`);
  await admin2.waitForTimeout(3000);
  await screenshot(admin2, 's1_reservations_1440x900');

  // Customer opens check-in page
  await customer.goto(CHECKIN_URL);
  await customer.waitForTimeout(3000);
  await screenshot(customer, 's1_checkin_page');

  // Take full-page dashboard screenshot
  await screenshotFull(admin1, 's1_dashboard_fullpage');

  // Scroll through dashboard to see all columns
  try {
    // Check horizontal scroll
    const scrollWidth = await admin1.evaluate(() => document.querySelector('main')?.scrollWidth || 0);
    const clientWidth = await admin1.evaluate(() => document.querySelector('main')?.clientWidth || 0);
    console.log(`  Dashboard scroll: ${scrollWidth}w x ${clientWidth}c`);

    // Count visible cards
    const cardCount = await admin1.evaluate(() =>
      document.querySelectorAll('[class*="card"], [class*="Card"]').length
    );
    console.log(`  Visible cards: ${cardCount}`);
  } catch (e) {
    console.log(`  Could not measure: ${e.message}`);
  }

  // Close contexts
  await adminCtx1.close();
  await adminCtx2.close();
  await customerCtx.close();
}

// ====== SCENARIO 2: Lunch Peak ======
async function scenario2_lunchPeak(browser) {
  console.log('\n=== SCENARIO 2: Lunch Peak Dashboard Analysis ===');

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loginAdmin(page);

  await page.goto(`${APP_URL}/admin/dashboard`);
  await page.waitForTimeout(3000);

  // Screenshot the dashboard in its peak state
  await screenshot(page, 's2_lunch_peak_dashboard');
  await screenshotFull(page, 's2_lunch_peak_fullpage');

  // Measure what's visible without scrolling
  const metrics = await page.evaluate(() => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const columns = document.querySelectorAll('[class*="column"], [class*="Column"], [data-status]');
    const cards = document.querySelectorAll('[class*="card"], [class*="Card"]');

    // Check if all content is visible
    const body = document.body;
    const hasHScroll = body.scrollWidth > window.innerWidth;
    const hasVScroll = body.scrollHeight > window.innerHeight;

    return {
      viewport,
      columnCount: columns.length,
      cardCount: cards.length,
      hasHScroll,
      hasVScroll,
      bodyWidth: body.scrollWidth,
      bodyHeight: body.scrollHeight,
    };
  });
  console.log(`  Metrics:`, JSON.stringify(metrics));

  await ctx.close();
}

// ====== SCENARIO 3: TM Double Booking ======
async function scenario3_tmDoubleBooking(browser) {
  console.log('\n=== SCENARIO 3: TM Double Booking Test ===');

  const tm1Ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const tm2Ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  const tm1 = await tm1Ctx.newPage();
  const tm2 = await tm2Ctx.newPage();

  await Promise.all([loginAdmin(tm1), loginAdmin(tm2)]);

  // Both TMs go to reservation page
  await Promise.all([
    tm1.goto(`${APP_URL}/admin/reservations`),
    tm2.goto(`${APP_URL}/admin/reservations`),
  ]);
  await tm1.waitForTimeout(3000);
  await tm2.waitForTimeout(3000);

  await screenshot(tm1, 's3_tm1_reservations');
  await screenshot(tm2, 's3_tm2_reservations');

  // Try to find "new reservation" button on both
  try {
    const addBtn1 = await tm1.$('button:has-text("예약"), button:has-text("새 예약"), button:has-text("추가")');
    if (addBtn1) {
      await addBtn1.click();
      await tm1.waitForTimeout(1000);
      await screenshot(tm1, 's3_tm1_new_reservation_modal');
    }

    const addBtn2 = await tm2.$('button:has-text("예약"), button:has-text("새 예약"), button:has-text("추가")');
    if (addBtn2) {
      await addBtn2.click();
      await tm2.waitForTimeout(1000);
      await screenshot(tm2, 's3_tm2_new_reservation_modal');
    }
  } catch (e) {
    console.log(`  Reservation button: ${e.message}`);
  }

  await tm1Ctx.close();
  await tm2Ctx.close();
}

// ====== SCENARIO 5: Treatment Room Peak ======
async function scenario5_treatmentPeak(browser) {
  console.log('\n=== SCENARIO 5: Treatment Room Peak (12/15 rooms active) ===');

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loginAdmin(page);

  await page.goto(`${APP_URL}/admin/dashboard`);
  await page.waitForTimeout(3000);

  // Focus on treatment column
  await screenshot(page, 's5_treatment_rooms_overview');

  // Check room numbers visible
  const roomInfo = await page.evaluate(() => {
    const allText = document.body.innerText;
    const roomNumbers = [];
    for (let i = 1; i <= 15; i++) {
      if (allText.includes(`${i}번`) || allText.includes(`시술 ${i}`) || allText.includes(`Room ${i}`)) {
        roomNumbers.push(i);
      }
    }
    return { foundRooms: roomNumbers, textSample: allText.substring(0, 2000) };
  });
  console.log(`  Found rooms: ${roomInfo.foundRooms}`);

  await ctx.close();
}

// ====== SCENARIO 7: Customer Waiting Screen ======
async function scenario7_customerWaiting(browser) {
  console.log('\n=== SCENARIO 7: Customer Waiting Screen ===');

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // Go to checkin page and create a new check-in
  await page.goto(CHECKIN_URL);
  await page.waitForTimeout(3000);
  await screenshot(page, 's7_checkin_form');

  // Fill in customer form
  try {
    await page.fill('input[name="name"], input[placeholder*="이름"]', '테스트고객');
    await page.waitForTimeout(500);
    await page.fill('input[name="phone"], input[placeholder*="전화"], input[placeholder*="번호"]', '01099998888');
    await page.waitForTimeout(500);
    await screenshot(page, 's7_checkin_form_filled');

    // Submit
    const submitBtn = await page.$('button[type="submit"], button:has-text("체크인"), button:has-text("접수")');
    if (submitBtn) {
      await submitBtn.click();
      await page.waitForTimeout(5000);
      await screenshot(page, 's7_waiting_screen');

      // Check if redirected to waiting page
      const url = page.url();
      console.log(`  After checkin URL: ${url}`);

      if (url.includes('/wait/')) {
        await page.waitForTimeout(2000);
        await screenshot(page, 's7_waiting_screen_detail');
      }
    }
  } catch (e) {
    console.log(`  Checkin flow: ${e.message}`);
  }

  await ctx.close();
}

// ====== SCENARIO 8: Tablet View ======
async function scenario8_tablet(browser) {
  console.log('\n=== SCENARIO 8: Tablet 1024x768 Full Flow ===');

  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await ctx.newPage();
  await loginAdmin(page);

  // Dashboard
  await page.goto(`${APP_URL}/admin/dashboard`);
  await page.waitForTimeout(3000);
  await screenshot(page, 's8_tablet_dashboard');
  await screenshotFull(page, 's8_tablet_dashboard_full');

  // Reservations
  await page.goto(`${APP_URL}/admin/reservations`);
  await page.waitForTimeout(3000);
  await screenshot(page, 's8_tablet_reservations');

  // Customers
  await page.goto(`${APP_URL}/admin/customers`);
  await page.waitForTimeout(3000);
  await screenshot(page, 's8_tablet_customers');

  // Staff
  await page.goto(`${APP_URL}/admin/staff`);
  await page.waitForTimeout(3000);
  await screenshot(page, 's8_tablet_staff');

  // Closing
  await page.goto(`${APP_URL}/admin/closing`);
  await page.waitForTimeout(3000);
  await screenshot(page, 's8_tablet_closing');

  // Check room visibility
  await page.goto(`${APP_URL}/admin/dashboard`);
  await page.waitForTimeout(3000);

  const tabletMetrics = await page.evaluate(() => {
    return {
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
      bodyW: document.body.scrollWidth,
      bodyH: document.body.scrollHeight,
      overflowX: document.body.scrollWidth > window.innerWidth,
      overflowY: document.body.scrollHeight > window.innerHeight,
    };
  });
  console.log(`  Tablet metrics:`, JSON.stringify(tabletMetrics));

  await ctx.close();
}

// ====== SCENARIO 4: Consultation Flow ======
async function scenario4_consultation(browser) {
  console.log('\n=== SCENARIO 4: Manager Consecutive Consultations ===');

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loginAdmin(page);

  await page.goto(`${APP_URL}/admin/dashboard`);
  await page.waitForTimeout(3000);

  // Find and try to interact with waiting patient cards
  await screenshot(page, 's4_consultation_start');

  // Try right-clicking on a card
  try {
    const cards = await page.$$('[class*="card"], [class*="Card"], [data-check-in-id]');
    console.log(`  Found ${cards.length} cards`);

    if (cards.length > 0) {
      // Right-click first card
      await cards[0].click({ button: 'right' });
      await page.waitForTimeout(1000);
      await screenshot(page, 's4_context_menu');

      // Close context menu
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      // Try clicking first card
      await cards[0].click();
      await page.waitForTimeout(1000);
      await screenshot(page, 's4_card_clicked');
    }
  } catch (e) {
    console.log(`  Card interaction: ${e.message}`);
  }

  await ctx.close();
}

// ====== SCENARIO 6: Payment Rush ======
async function scenario6_paymentRush(browser) {
  console.log('\n=== SCENARIO 6: Payment Rush ===');

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loginAdmin(page);

  await page.goto(`${APP_URL}/admin/dashboard`);
  await page.waitForTimeout(3000);

  await screenshot(page, 's6_payment_waiting_view');

  // Look for payment_waiting section
  const paymentInfo = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      hasPaymentWaiting: text.includes('결제대기') || text.includes('payment'),
      paymentWaitingCount: (text.match(/결제대기/g) || []).length,
    };
  });
  console.log(`  Payment info:`, JSON.stringify(paymentInfo));

  await ctx.close();
}

// ====== MAIN ======
async function main() {
  console.log('Starting Massive UX Test...');
  console.log(`App: ${APP_URL}`);
  console.log(`Screenshots: ${SCREENSHOT_DIR}\n`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox'],
  });

  try {
    // Run scenarios sequentially for stability
    await scenario1_morningPeak(browser);
    await scenario2_lunchPeak(browser);
    await scenario3_tmDoubleBooking(browser);
    await scenario4_consultation(browser);
    await scenario5_treatmentPeak(browser);
    await scenario6_paymentRush(browser);
    await scenario7_customerWaiting(browser);
    await scenario8_tablet(browser);
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await browser.close();
  }

  console.log('\n=== ALL SCENARIOS COMPLETE ===');
  console.log(`Screenshots saved to: ${SCREENSHOT_DIR}`);
}

main();
