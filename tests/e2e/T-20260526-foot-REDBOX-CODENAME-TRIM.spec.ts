/**
 * E2E spec — T-20260526-foot-REDBOX-CODENAME-TRIM
 * 수가 코드명 잘림 해소 + 레이아웃 개선
 *
 * AC-1: 빨간박스 원인 코드 확인 (DnD 관련 red border 없음 확인)
 * AC-2: 빨간박스 UI — 코드 내 border-red/ring-red 없음 (N/A)
 * AC-3: 수가 코드명 공간 확보 — 이전(1자)보다 충분한 이름 표시 (5자+)
 * AC-4: 순서 변경 기능 자체(드래그 핸들, ↑↓ 버튼) 유지
 * AC-5: 빌드 통과
 *
 * 변경 요약:
 * - SortablePricingRow: 코드번호 컬럼(w-9) 제거 → name flex-1 공간 +40px
 * - drag handle: min-w-[28px] → min-w-[20px] + outline-none (+8px)
 * - ↑↓ buttons: min-w-[32px] → min-w-[24px] (+8px)
 * - Zone2: sm:w-60 → sm:w-64 (+16px)
 * - 합계: +72px → 코드명 5-6자 표시 가능 (vs 이전 1자)
 */

import { test, expect } from '@playwright/test';

// AC-5: 빌드 artifact 확인 (정적 검증)
test('AC-5: 빌드 artifact 존재 확인', async ({ page }) => {
  const fs = await import('fs');
  const path = await import('path');
  const distDir = path.join(process.cwd(), 'dist', 'assets');
  expect(fs.existsSync(distDir)).toBe(true);
  const files = fs.readdirSync(distDir);
  const hasBundle = files.some((f: string) => f.endsWith('.js'));
  expect(hasBundle).toBe(true);
});

// AC-1/AC-2: 코드에 red border 없음 — 소스 파일 검증
test('AC-1: PaymentMiniWindow에 DnD 관련 red border 없음', async ({ page }) => {
  const fs = await import('fs');
  const path = await import('path');
  const srcPath = path.join(process.cwd(), 'src', 'components', 'PaymentMiniWindow.tsx');
  const content = fs.readFileSync(srcPath, 'utf-8');

  // red border 클래스 없음
  expect(content).not.toMatch(/border-red-\d+/);
  expect(content).not.toMatch(/ring-red-\d+/);
  expect(content).not.toMatch(/outline-red-\d+/);
});

// AC-3: 코드번호 컬럼이 SortablePricingRow에 없고 name span이 있음
test('AC-3: SortablePricingRow — 코드번호 컬럼 제거 + name 공간 확보', async ({ page }) => {
  const fs = await import('fs');
  const path = await import('path');
  const srcPath = path.join(process.cwd(), 'src', 'components', 'PaymentMiniWindow.tsx');
  const content = fs.readFileSync(srcPath, 'utf-8');

  // 코드번호 컬럼(w-9 + service_code) 제거 확인
  // 이전: <span className="w-9 shrink-0 ...">service.service_code</span>
  // 현재: 해당 패턴 없음 (Zone1에서 표시됨)
  expect(content).not.toMatch(/className="w-9 shrink-0[^"]*"[\s\S]{0,100}service_code/);

  // name span이 flex-1 + title tooltip 보유 확인
  expect(content).toMatch(/flex-1 font-medium truncate min-w-0[^"]*" title=\{service\.name\}/);
});

// AC-3: Zone2 너비 확장 확인
test('AC-3: Zone2 sm:w-64 확장 확인', async ({ page }) => {
  const fs = await import('fs');
  const path = await import('path');
  const srcPath = path.join(process.cwd(), 'src', 'components', 'PaymentMiniWindow.tsx');
  const content = fs.readFileSync(srcPath, 'utf-8');

  // sm:w-64 (이전 sm:w-60에서 확장)
  expect(content).toMatch(/sm:w-64 md:w-64 lg:w-72/);
});

// AC-4: ↑↓ 버튼과 drag handle 존재 확인 (순서 변경 기능 보존)
test('AC-4: 순서 변경 요소(drag handle + ↑↓ 버튼) 존재 확인', async ({ page }) => {
  const fs = await import('fs');
  const path = await import('path');
  const srcPath = path.join(process.cwd(), 'src', 'components', 'PaymentMiniWindow.tsx');
  const content = fs.readFileSync(srcPath, 'utf-8');

  // drag handle button 존재 (touch-none + cursor-grab)
  expect(content).toMatch(/cursor-grab active:cursor-grabbing touch-none/);

  // ↑↓ 버튼 data-testid 존재
  expect(content).toMatch(/data-testid=\{`reorder-up-\$\{service\.id\}`\}/);
  expect(content).toMatch(/data-testid=\{`reorder-down-\$\{service\.id\}`\}/);

  // DnD 센서 설정 보존 (PointerSensor)
  expect(content).toMatch(/PointerSensor/);

  // ↑↓ 버튼 min-w-\[24px\] (이전 32px에서 소폭 축소, 기능 유지)
  expect(content).toMatch(/min-w-\[24px\] min-h-\[22px\]/);
});
