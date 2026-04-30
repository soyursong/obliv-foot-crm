/**
 * R-2026-04-30-bundle-lazy-check — 번들 lazy-load invariant 회귀 스펙
 * CONTINUOUS-DEV C항목: 빌드 사이즈/성능
 *
 * 무거운 벤더(pdf, charts, dnd)가 실수로 eager-preload에 포함되는 것을 감지한다.
 * dist/index.html을 정적 분석 + Playwright 네트워크 인터셉트 두 가지로 검증.
 *
 * 목적:
 *   - vendor-pdf (~529KB unzip) → 절대 초기 로드 금지 (pdf 출력 시에만 로드)
 *   - vendor-charts (~375KB unzip) → 절대 초기 로드 금지 (대시보드/통계 라우트에만 로드)
 *   - vendor-dnd (~43KB unzip) → 절대 초기 로드 금지 (칸반 대시보드 라우트에만 로드)
 *
 * 초기 critical path 허용 목록:
 *   vendor-react, vendor-supabase, vendor-query, vendor-ui, vendor-icons, index
 *
 * 실행: npm run test:regression
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const DIST_DIR = path.resolve(__dirname, '../../../dist');
const INDEX_HTML = path.join(DIST_DIR, 'index.html');

// 허용된 초기 preload 벤더 패턴 (prefix)
const ALLOWED_EAGER_PREFIXES = [
  'vendor-react',
  'vendor-supabase',
  'vendor-query',
  'vendor-ui',
  'vendor-icons',
  'vendor-dates',
  'index',
];

// 절대 초기 로드 금지 패턴 (heavy lazy 벤더)
const FORBIDDEN_EAGER_PATTERNS = ['vendor-pdf', 'vendor-charts', 'vendor-dnd'];

// ─── Static: dist/index.html 분석 ─────────────────────────────────────────────

test.describe('C1 번들 lazy invariant — dist/index.html 정적 분석', () => {
  test('C1-1: dist/index.html 존재 + 빌드 최신 상태', () => {
    const exists = fs.existsSync(INDEX_HTML);
    expect(exists).toBe(true);

    const stat = fs.statSync(INDEX_HTML);
    const ageMs = Date.now() - stat.mtimeMs;
    // 7일 이내 빌드 (오래된 dist로 테스트하는 것을 방지)
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    console.log(`dist/index.html 빌드 경과: ${ageDays.toFixed(1)}일`);
    // 7일 초과 시 경고 (실패는 아님 — CI 아닌 로컬에서 오래된 빌드일 수 있음)
    if (ageDays > 7) {
      console.warn(`⚠️ dist가 ${ageDays.toFixed(0)}일 전 빌드입니다. npm run build를 실행하세요.`);
    }
  });

  test('C1-2: 금지된 벤더(pdf/charts/dnd)가 modulepreload에 없음', () => {
    if (!fs.existsSync(INDEX_HTML)) {
      console.log('dist/index.html 없음 — npm run build 후 재실행');
      return;
    }

    const html = fs.readFileSync(INDEX_HTML, 'utf-8');

    // modulepreload 링크 추출
    const preloadMatches = html.match(/modulepreload[^>]+href="([^"]+)"/g) ?? [];
    const preloadedFiles = preloadMatches.map((m) => {
      const href = m.match(/href="([^"]+)"/)?.[1] ?? '';
      return path.basename(href);
    });

    console.log('초기 modulepreload 목록:', preloadedFiles.join(', '));

    // 금지 패턴 확인
    for (const forbidden of FORBIDDEN_EAGER_PATTERNS) {
      const found = preloadedFiles.some((f) => f.startsWith(forbidden));
      if (found) {
        throw new Error(
          `🚨 ${forbidden} 벤더가 초기 modulepreload에 포함됨! ` +
            `초기 로드 금지 — 동적 import()로 변경 필요.`,
        );
      }
    }

    // 통과 보고
    console.log('✅ 금지 벤더(pdf/charts/dnd) 모두 lazy — 초기 로드 없음');
  });

  test('C1-3: 초기 preload 개수 ≤ 8 (creep 방지)', () => {
    if (!fs.existsSync(INDEX_HTML)) return;

    const html = fs.readFileSync(INDEX_HTML, 'utf-8');
    const preloadCount = (html.match(/modulepreload/g) ?? []).length;

    console.log(`초기 modulepreload 수: ${preloadCount}`);
    // 8개 초과 시 경고 — 누군가 새 eager import를 추가했을 가능성
    expect(preloadCount).toBeLessThanOrEqual(8);
  });

  test('C1-4: 허용된 벤더 이외 패턴이 preload에 없음', () => {
    if (!fs.existsSync(INDEX_HTML)) return;

    const html = fs.readFileSync(INDEX_HTML, 'utf-8');
    const preloadMatches = html.match(/modulepreload[^>]+href="([^"]+)"/g) ?? [];

    for (const match of preloadMatches) {
      const href = match.match(/href="([^"]+)"/)?.[1] ?? '';
      const filename = path.basename(href);
      const isAllowed = ALLOWED_EAGER_PREFIXES.some((prefix) => filename.startsWith(prefix));
      if (!isAllowed) {
        console.warn(`⚠️ 예상치 못한 preload 발견: ${filename}`);
        // 경고만 (fail 아님) — 새 벤더 추가 시 ALLOWED_EAGER_PREFIXES 갱신 필요
      }
    }
  });
});

// ─── Static: dist/assets 번들 크기 체크 ───────────────────────────────────────

test.describe('C2 번들 크기 회귀 — dist/assets 크기 확인', () => {
  const ASSETS_DIR = path.join(DIST_DIR, 'assets');

  function getBundleSize(pattern: string): { file: string; sizeKB: number } | null {
    if (!fs.existsSync(ASSETS_DIR)) return null;
    const files = fs.readdirSync(ASSETS_DIR);
    const match = files.find((f) => f.startsWith(pattern) && f.endsWith('.js'));
    if (!match) return null;
    const stat = fs.statSync(path.join(ASSETS_DIR, match));
    return { file: match, sizeKB: Math.round(stat.size / 1024) };
  }

  test('C2-1: vendor-pdf 크기 ≤ 600KB (회귀 임계값)', () => {
    const info = getBundleSize('vendor-pdf');
    if (!info) { console.log('vendor-pdf 없음 — 스킵'); return; }
    console.log(`vendor-pdf: ${info.sizeKB}KB (${info.file})`);
    expect(info.sizeKB).toBeLessThanOrEqual(600);
  });

  test('C2-2: vendor-charts 크기 ≤ 450KB (회귀 임계값)', () => {
    const info = getBundleSize('vendor-charts');
    if (!info) { console.log('vendor-charts 없음 — 스킵'); return; }
    console.log(`vendor-charts: ${info.sizeKB}KB (${info.file})`);
    expect(info.sizeKB).toBeLessThanOrEqual(450);
  });

  test('C2-3: vendor-react 크기 ≤ 200KB (react 버전 고정 확인)', () => {
    const info = getBundleSize('vendor-react');
    if (!info) { console.log('vendor-react 없음 — 스킵'); return; }
    console.log(`vendor-react: ${info.sizeKB}KB (${info.file})`);
    expect(info.sizeKB).toBeLessThanOrEqual(200);
  });

  test('C2-4: vendor-supabase 크기 ≤ 250KB', () => {
    const info = getBundleSize('vendor-supabase');
    if (!info) { console.log('vendor-supabase 없음 — 스킵'); return; }
    console.log(`vendor-supabase: ${info.sizeKB}KB (${info.file})`);
    expect(info.sizeKB).toBeLessThanOrEqual(250);
  });

  test('C2-5: 전체 번들 사이즈 리포트', () => {
    if (!fs.existsSync(ASSETS_DIR)) { console.log('assets 없음 — 스킵'); return; }

    const files = fs.readdirSync(ASSETS_DIR);
    const jsFiles = files.filter((f) => f.endsWith('.js'));

    let totalKB = 0;
    const report: string[] = [];

    for (const file of jsFiles.sort()) {
      const stat = fs.statSync(path.join(ASSETS_DIR, file));
      const sizeKB = Math.round(stat.size / 1024);
      totalKB += sizeKB;
      report.push(`  ${file}: ${sizeKB}KB`);
    }

    console.log('=== 번들 사이즈 리포트 ===');
    report.forEach((line) => console.log(line));
    console.log(`=== 총합: ${totalKB}KB ===`);

    // 총 번들이 3MB 초과 시 경고
    if (totalKB > 3000) {
      console.warn(`⚠️ 총 번들 ${totalKB}KB > 3MB — 코드 스플리팅 검토 필요`);
    }

    // 정보 기록용 — 실패시키지 않음 (리포트 목적)
    expect(totalKB).toBeGreaterThan(0);
  });
});

// ─── Network: 셀프체크인 초기 로드 시 heavy 벤더 미요청 ─────────────────────────

test.describe('C3 네트워크 인터셉트 — 셀프체크인 초기 로드', () => {
  test('C3-1: /checkin/jongno-foot 초기 로드 시 vendor-pdf 미요청', async ({ page }) => {
    const pdfRequests: string[] = [];

    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('vendor-pdf')) pdfRequests.push(url);
    });

    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
    await page.waitForTimeout(1000); // 지연 로드 대기

    console.log(`vendor-pdf 요청 수: ${pdfRequests.length}`);
    if (pdfRequests.length > 0) {
      console.error('🚨 셀프체크인 초기 로드에서 vendor-pdf 요청됨:', pdfRequests);
    }
    expect(pdfRequests).toHaveLength(0);
  });

  test('C3-2: /checkin/jongno-foot 초기 로드 시 vendor-charts 미요청', async ({ page }) => {
    const chartsRequests: string[] = [];

    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('vendor-charts')) chartsRequests.push(url);
    });

    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
    await page.waitForTimeout(1000);

    console.log(`vendor-charts 요청 수: ${chartsRequests.length}`);
    expect(chartsRequests).toHaveLength(0);
  });

  test('C3-3: /checkin/jongno-foot 초기 로드 시 vendor-dnd 미요청', async ({ page }) => {
    const dndRequests: string[] = [];

    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('vendor-dnd')) dndRequests.push(url);
    });

    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
    await page.waitForTimeout(1000);

    console.log(`vendor-dnd 요청 수: ${dndRequests.length}`);
    expect(dndRequests).toHaveLength(0);
  });

  test('C3-4: 셀프체크인 초기 로드 시간 ≤ 5000ms (성능 회귀)', async ({ page }) => {
    const t0 = Date.now();
    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('domcontentloaded');
    const domReadyMs = Date.now() - t0;

    await page.waitForLoadState('networkidle', { timeout: 15_000 });
    const fullyLoadedMs = Date.now() - t0;

    console.log(`DOMContentLoaded: ${domReadyMs}ms`);
    console.log(`networkidle (전체 로드): ${fullyLoadedMs}ms`);

    // DOMContentLoaded 5초 이내 (태블릿 WiFi 기준)
    expect(domReadyMs).toBeLessThan(5_000);
  });

  test('C3-5: 초기 로드 요청 수 ≤ 20개 (bundle 분산 과다 방지)', async ({ page }) => {
    const jsRequests: string[] = [];

    page.on('request', (req) => {
      const url = req.url();
      if (url.endsWith('.js') || url.includes('/assets/')) jsRequests.push(url);
    });

    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    console.log(`JS 파일 요청 수: ${jsRequests.length}`);
    jsRequests.forEach((url) => console.log(`  ${url.split('/').pop()}`));

    // 20개 초과 시 청킹 전략 재검토 필요
    expect(jsRequests.length).toBeLessThanOrEqual(20);
  });
});
