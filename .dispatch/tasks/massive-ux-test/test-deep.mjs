/**
 * Deep UX inspection tests - focused on specific issues found in round 1
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';

const APP_URL = 'https://happy-flow-queue.lovable.app';
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

async function loginAdmin(page) {
  await page.goto(`${APP_URL}/admin`);
  await page.waitForTimeout(2000);
  if (page.url().includes('/admin/dashboard') || page.url().includes('/admin/reservations')) return;
  await page.fill('input[type="email"]', LOGIN_EMAIL);
  await page.fill('input[type="password"]', LOGIN_PASS);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  // ===== TEST A: Clinic selector - ensure 종로 is selected =====
  console.log('\n=== TEST A: Clinic selector behavior ===');
  const ctx1 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page1 = await ctx1.newPage();
  await loginAdmin(page1);
  await page1.goto(`${APP_URL}/admin/dashboard`);
  await page1.waitForTimeout(3000);

  // Check current clinic
  const clinicName = await page1.evaluate(() => {
    const select = document.querySelector('select');
    if (select) return { tag: 'select', value: select.value, text: select.options[select.selectedIndex]?.text };
    const trigger = document.querySelector('[role="combobox"], [class*="select"]');
    if (trigger) return { tag: 'trigger', text: trigger.textContent };
    return { tag: 'none' };
  });
  console.log(`  Current clinic:`, JSON.stringify(clinicName));

  // Try switching to 종로
  try {
    const select = await page1.$('select');
    if (select) {
      const options = await page1.evaluate(() => {
        const s = document.querySelector('select');
        return Array.from(s.options).map(o => ({ value: o.value, text: o.text }));
      });
      console.log(`  Options:`, JSON.stringify(options));

      // Find 종로 option
      const jongnoOpt = options.find(o => o.text.includes('종로'));
      if (jongnoOpt) {
        await select.selectOption(jongnoOpt.value);
        await page1.waitForTimeout(3000);
        await screenshot(page1, 'deep_a_jongno_selected');
      }
    }
  } catch (e) {
    console.log(`  Clinic switch: ${e.message}`);
  }

  await screenshot(page1, 'deep_a_clinic_check');

  // ===== TEST B: Context menu and actions on cards =====
  console.log('\n=== TEST B: Card context menu deep inspection ===');
  await page1.goto(`${APP_URL}/admin/dashboard`);
  await page1.waitForTimeout(3000);

  // Find all interactive elements in dashboard
  const dashElements = await page1.evaluate(() => {
    const results = {
      statusHeaders: [],
      cards: [],
      buttons: [],
      badges: [],
    };

    // Status column headers
    document.querySelectorAll('h2, h3, [class*="header"], [class*="Header"]').forEach(el => {
      results.statusHeaders.push(el.textContent.trim().substring(0, 50));
    });

    // Cards with data
    document.querySelectorAll('[class*="card"], [class*="Card"]').forEach(el => {
      results.cards.push({
        text: el.textContent.trim().substring(0, 100),
        classes: el.className.substring(0, 100),
      });
    });

    // Buttons
    document.querySelectorAll('button').forEach(el => {
      if (el.textContent.trim()) {
        results.buttons.push(el.textContent.trim().substring(0, 50));
      }
    });

    // Badges
    document.querySelectorAll('[class*="badge"], [class*="Badge"]').forEach(el => {
      results.badges.push(el.textContent.trim());
    });

    return results;
  });
  console.log(`  Status headers: ${JSON.stringify(dashElements.statusHeaders.slice(0, 10))}`);
  console.log(`  Cards count: ${dashElements.cards.length}`);
  console.log(`  Buttons: ${JSON.stringify(dashElements.buttons.slice(0, 15))}`);
  console.log(`  Badges: ${JSON.stringify(dashElements.badges.slice(0, 10))}`);

  // Try right-click on different card types
  const allCards = await page1.$$('[class*="border"][class*="rounded"], [data-check-in-id]');
  console.log(`  Found card elements: ${allCards.length}`);

  for (let i = 0; i < Math.min(allCards.length, 3); i++) {
    try {
      await allCards[i].click({ button: 'right' });
      await page1.waitForTimeout(800);
      await screenshot(page1, `deep_b_contextmenu_card${i}`);

      // Check context menu items
      const menuItems = await page1.evaluate(() => {
        const items = document.querySelectorAll('[role="menuitem"], [class*="menu-item"], [class*="MenuItem"]');
        return Array.from(items).map(i => i.textContent.trim());
      });
      console.log(`  Card ${i} menu items: ${JSON.stringify(menuItems)}`);

      await page1.keyboard.press('Escape');
      await page1.waitForTimeout(300);
    } catch (e) {
      console.log(`  Card ${i} right-click failed: ${e.message}`);
    }
  }

  // ===== TEST C: Scroll and overflow analysis =====
  console.log('\n=== TEST C: Scroll and overflow analysis ===');
  const scrollAnalysis = await page1.evaluate(() => {
    const main = document.querySelector('main') || document.querySelector('[class*="content"]');
    const sidebar = document.querySelector('[class*="sidebar"], [class*="Sidebar"], aside');

    // Check each column for overflow
    const columns = document.querySelectorAll('[class*="column"], [class*="col-"]');

    return {
      mainScroll: main ? {
        scrollW: main.scrollWidth,
        clientW: main.clientWidth,
        scrollH: main.scrollHeight,
        clientH: main.clientHeight,
        overflowX: main.scrollWidth > main.clientWidth,
        overflowY: main.scrollHeight > main.clientHeight,
      } : null,
      sidebarExists: !!sidebar,
      sidebarWidth: sidebar ? sidebar.getBoundingClientRect().width : 0,
      columnCount: columns.length,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  console.log(`  Scroll analysis:`, JSON.stringify(scrollAnalysis));

  // ===== TEST D: Font sizes and touch targets =====
  console.log('\n=== TEST D: Font sizes and touch targets ===');
  const uiMetrics = await page1.evaluate(() => {
    const results = {
      smallFonts: [],
      smallButtons: [],
      lowContrast: [],
    };

    // Check all text elements for small fonts
    document.querySelectorAll('*').forEach(el => {
      const style = window.getComputedStyle(el);
      const fontSize = parseFloat(style.fontSize);
      if (fontSize > 0 && fontSize < 12 && el.textContent.trim().length > 0 && el.children.length === 0) {
        results.smallFonts.push({
          text: el.textContent.trim().substring(0, 30),
          size: fontSize,
          tag: el.tagName,
        });
      }
    });

    // Check buttons/clickable for small touch targets
    document.querySelectorAll('button, a, [role="button"], [onclick]').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && (rect.width < 32 || rect.height < 32)) {
        results.smallButtons.push({
          text: el.textContent.trim().substring(0, 30),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }
    });

    return {
      smallFonts: results.smallFonts.slice(0, 15),
      smallButtons: results.smallButtons.slice(0, 10),
    };
  });
  console.log(`  Small fonts (<12px): ${uiMetrics.smallFonts.length}`);
  uiMetrics.smallFonts.forEach(f => console.log(`    "${f.text}" - ${f.size}px (${f.tag})`));
  console.log(`  Small touch targets (<32px): ${uiMetrics.smallButtons.length}`);
  uiMetrics.smallButtons.forEach(b => console.log(`    "${b.text}" - ${b.width}x${b.height}`));

  // ===== TEST E: Reservation page - time slot availability =====
  console.log('\n=== TEST E: Reservation page details ===');
  await page1.goto(`${APP_URL}/admin/reservations`);
  await page1.waitForTimeout(3000);
  await screenshot(page1, 'deep_e_reservations');

  // Click + 예약 button
  try {
    const addBtn = await page1.$('button:has-text("예약")');
    if (addBtn) {
      await addBtn.click();
      await page1.waitForTimeout(1500);
      await screenshot(page1, 'deep_e_reservation_modal');

      // Analyze modal content
      const modalContent = await page1.evaluate(() => {
        const modal = document.querySelector('[role="dialog"], [class*="modal"], [class*="Modal"], [class*="dialog"]');
        if (!modal) return { found: false };
        return {
          found: true,
          text: modal.textContent.substring(0, 500),
          inputs: Array.from(modal.querySelectorAll('input, select, textarea')).map(i => ({
            type: i.type || i.tagName,
            name: i.name || i.placeholder || '',
            label: i.getAttribute('aria-label') || '',
          })),
          buttons: Array.from(modal.querySelectorAll('button')).map(b => b.textContent.trim()),
        };
      });
      console.log(`  Modal:`, JSON.stringify(modalContent));
    }
  } catch (e) {
    console.log(`  Reservation modal: ${e.message}`);
  }

  // ===== TEST F: Customer search functionality =====
  console.log('\n=== TEST F: Customer search ===');
  await page1.goto(`${APP_URL}/admin/dashboard`);
  await page1.waitForTimeout(3000);

  try {
    const searchInput = await page1.$('input[placeholder*="검색"], input[placeholder*="고객"]');
    if (searchInput) {
      await searchInput.fill('김');
      await page1.waitForTimeout(2000);
      await screenshot(page1, 'deep_f_search_results');

      const searchResults = await page1.evaluate(() => {
        const results = document.querySelectorAll('[class*="search-result"], [class*="SearchResult"], [class*="dropdown"] li, [class*="popover"] [class*="item"]');
        return {
          count: results.length,
          texts: Array.from(results).slice(0, 5).map(r => r.textContent.trim().substring(0, 50)),
        };
      });
      console.log(`  Search results:`, JSON.stringify(searchResults));
    }
  } catch (e) {
    console.log(`  Search: ${e.message}`);
  }

  // ===== TEST G: Sidebar reservation list scroll =====
  console.log('\n=== TEST G: Sidebar reservation list ===');
  await page1.goto(`${APP_URL}/admin/dashboard`);
  await page1.waitForTimeout(3000);

  const sidebarInfo = await page1.evaluate(() => {
    // Find the sidebar/left panel with reservations
    const sidebar = document.querySelector('[class*="sidebar"], aside, [class*="reservation-list"]');
    const leftPanel = document.querySelector('[class*="left"], [class*="Left"]');
    const target = sidebar || leftPanel;

    if (!target) return { found: false };

    const items = target.querySelectorAll('[class*="card"], [class*="item"], li');
    return {
      found: true,
      scrollH: target.scrollHeight,
      clientH: target.clientHeight,
      overflow: target.scrollHeight > target.clientHeight,
      itemCount: items.length,
      width: target.getBoundingClientRect().width,
    };
  });
  console.log(`  Sidebar:`, JSON.stringify(sidebarInfo));

  // ===== TEST H: NoShow button behavior =====
  console.log('\n=== TEST H: NoShow / Restore buttons ===');
  // Check for noshow buttons
  const noshowBtns = await page1.$$('button:has-text("노쇼")');
  console.log(`  NoShow buttons found: ${noshowBtns.length}`);

  if (noshowBtns.length > 0) {
    // Screenshot showing noshow button locations
    await screenshot(page1, 'deep_h_noshow_buttons');
  }

  // ===== TEST I: 3-column treatment room layout =====
  console.log('\n=== TEST I: Treatment room layout analysis ===');
  const treatmentLayout = await page1.evaluate(() => {
    const text = document.body.innerText;

    // Find treatment section
    const treatmentSections = [];
    document.querySelectorAll('[class*="grid"], [class*="flex"]').forEach(el => {
      if (el.textContent.includes('시술') && el.children.length > 2) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 200) {
          treatmentSections.push({
            children: el.children.length,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            className: el.className.substring(0, 80),
            display: window.getComputedStyle(el).display,
            gridTemplate: window.getComputedStyle(el).gridTemplateColumns,
          });
        }
      }
    });

    return {
      sections: treatmentSections.slice(0, 5),
      hasRoom1: text.includes('1번') || text.includes('시술 1'),
      hasRoom15: text.includes('15번') || text.includes('시술 15'),
      roomNumbersFound: Array.from({ length: 15 }, (_, i) => i + 1).filter(n =>
        text.includes(`${n}번`) || text.includes(`시술${n}`) || text.includes(`시술 ${n}`)
      ),
    };
  });
  console.log(`  Treatment layout:`, JSON.stringify(treatmentLayout));

  await ctx1.close();

  // ===== TEST J: Simultaneous multi-browser stress =====
  console.log('\n=== TEST J: 3 browsers simultaneous operation ===');
  const contexts = await Promise.all([
    browser.newContext({ viewport: { width: 1440, height: 900 } }),
    browser.newContext({ viewport: { width: 1440, height: 900 } }),
    browser.newContext({ viewport: { width: 1024, height: 768 } }),
  ]);

  const pages = await Promise.all(contexts.map(c => c.newPage()));
  await Promise.all(pages.map(p => loginAdmin(p)));

  // All three go to dashboard simultaneously
  await Promise.all(pages.map(p => p.goto(`${APP_URL}/admin/dashboard`)));
  await pages[0].waitForTimeout(3000);

  await Promise.all([
    screenshot(pages[0], 'deep_j_multi1_dashboard'),
    screenshot(pages[1], 'deep_j_multi2_dashboard'),
    screenshot(pages[2], 'deep_j_multi3_tablet'),
  ]);

  // Check data consistency
  const counts = await Promise.all(pages.map(p => p.evaluate(() => {
    const text = document.body.innerText;
    return {
      checkinMatch: text.match(/체크인\s*(\d+)/)?.[1],
      waitingMatch: text.match(/대기\s*(\d+)/)?.[1],
    };
  })));
  console.log(`  Data consistency:`, JSON.stringify(counts));

  await Promise.all(contexts.map(c => c.close()));
  await browser.close();

  console.log('\n=== DEEP TESTS COMPLETE ===');
}

main();
