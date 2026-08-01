/**
 * E2E spec — T-20260801-foot-ALT-LASERBLOCK-PAYMINI-PARITY (P1)
 *
 * 배경: ALT(보험 반려 대상) 활성 고객에게 레이저코드를 삽입하면 보험 반려 사고.
 *   서류패널(DocumentPrintPanel)에는 origin T-20260522-foot-ALT-BADGE 로 차단이 있었으나
 *   결제 미니창(PaymentMiniWindow)에는 처음부터 없었음(개편 회귀 아님). 본 티켓은 파리티 이식.
 *
 * 핵심 delta(2026-08-01 김주연 총괄 확정):
 *   1. [LASER-CODE-DEFINITION] 레이저코드 = SZ035(가열성/비가열성 진균증 레이저 치료).
 *      실 DB 확인(dev, 2026-08-01): service_code 'SZ035'(진균증 레이저 치료 2종) + 'SZ035-OL/TL/FL'(비가열레이저 변형) 실재.
 *      기존 isLaserService 는 MM prefix·category·name 기준이라 SZ035 를 코드-prefix 로는 미포섭 →
 *      startsWith('SZ035') 를 OR 결합 추가(reporter-authoritative, silent-failure hazard 봉합).
 *      code↔현장정의 divergence 없음 확인(FOLLOWUP 불요).
 *   2. AC-6 — 2번차트 ALT 활성 → 대시보드 → 결제미니창 alt_status 읽기경로 도달(데이터 토대).
 *   3. AC-7 — 결제 미니창 패키지 항목 맨 우측 ALT 배지(코디팀 인지용, 메탈릭 실버).
 *
 * AC:
 *   AC-1: PMW props 에 altStatus, Dashboard 호출부에서 alt_status(altHolderSet) 전달.
 *   AC-2: ALT 활성 고객 결제 미니창에서 레이저 서비스(SZ035 포함) 선택 시 toast.error + 삽입 차단.
 *   AC-3: ALT 활성 시 상단 경고 배너 표시.
 *   AC-4: ALT 비활성 고객은 정상(배너·배지 미표시, 레이저 선택 가능) — 회귀 없음.
 *   AC-5: isLaserService 판별이 DocumentPrintPanel 과 동일(공용 lib SSOT — 중복 정의 금지).
 *   AC-6: 2번차트→대시보드→결제미니창 alt_status 읽기경로 도달(altHolderSet + PMW self-source).
 *   AC-7: 결제 미니창 패키지 항목 맨 우측 ALT 배지(effectiveAltStatus gated, 메탈릭 실버).
 *
 * ⚠ DOM 시나리오(ALT 활성 고객 + 레이저 서비스 seed)는 실 seed 의존이 커 레포 관례대로
 *   graceful skip. 회귀 앵커는 소스 계약(판별식·배선·차단·배너·배지) 정적 단언으로 seed-무관 결정론 보장.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

test.describe('T-20260801 ALT-LASERBLOCK-PAYMINI-PARITY — 결제 미니창 ALT 레이저코드 차단·배지·연동', () => {
  // ── C1: 공용 판별 SSOT — SZ035 RECONCILE(delta #1) ─────────────────────────
  test('C1: laserService.ts — isLaserService 가 SZ035 + MM + category + 이름 OR 결합', () => {
    const src = read('src/lib/laserService.ts');

    // 단일 export(공용 SSOT).
    expect(src).toMatch(/export\s+function\s+isLaserService/);

    // delta #1: SZ035 prefix 판별 명시 추가(reporter-authoritative). code 대문자화 후 startsWith.
    expect(src).toMatch(/startsWith\(\s*['"]SZ035['"]\s*\)/);
    // 기존 판별 유지(포섭 회귀 0): MM prefix / category laser·heated_laser / 이름 '레이저'.
    expect(src).toMatch(/startsWith\(\s*['"]MM['"]\s*\)/);
    expect(src).toMatch(/===\s*['"]laser['"]/);
    expect(src).toMatch(/===\s*['"]heated_laser['"]/);
    expect(src).toMatch(/includes\(\s*['"]레이저['"]\s*\)/);
  });

  // ── C2: DocumentPrintPanel — 로컬 중복정의 제거 + 공용 lib 소비(AC-5) ──────
  test('C2: DocumentPrintPanel — isLaserService 를 @/lib/laserService 에서 import(중복정의 금지)', () => {
    const src = read('src/components/DocumentPrintPanel.tsx');

    // 공용 lib import.
    expect(src).toMatch(/import\s*\{[^}]*isLaserService[^}]*\}\s*from\s*['"]@\/lib\/laserService['"]/);
    // 로컬 재정의(function isLaserService) 제거 — SSOT 1곳.
    expect(src).not.toMatch(/function\s+isLaserService\s*\(/);
    // 서류패널도 altStatus 계약 유지.
    expect(src).toMatch(/altStatus\?\s*:\s*boolean/);
  });

  // ── C3: PaymentMiniWindow — 차단·배너·self-source·세트필터(AC-2/3/5/6) ─────
  test('C3: PaymentMiniWindow — altStatus 수신 + 레이저 차단 + 경고 배너 + self-source', () => {
    const src = read('src/components/PaymentMiniWindow.tsx');

    // 공용 lib 소비(서류패널과 동일 판별식 — AC-5).
    expect(src).toMatch(/import\s*\{[^}]*isLaserService[^}]*\}\s*from\s*['"]@\/lib\/laserService['"]/);
    // 로컬 중복정의 없음.
    expect(src).not.toMatch(/function\s+isLaserService\s*\(/);

    // Props: altStatus?: boolean (AC-1).
    expect(src).toMatch(/altStatus\?\s*:\s*boolean/);

    // AC-6 데이터 토대: PMW self-source(customers.alt_status) — 부모 미전달 대비 fail-safe.
    expect(src).toMatch(/custAltStatus/);
    expect(src).toMatch(/\.select\(\s*['"]alt_status['"]\s*\)/);
    // effectiveAltStatus = altStatus || custAltStatus (OR 결합, 어느 소스든 ALT 면 차단).
    expect(src).toMatch(/effectiveAltStatus\s*=\s*altStatus\s*\|\|\s*custAltStatus/);

    // AC-2: 단일 서비스 선택 경로 차단 — effectiveAltStatus && isLaserService → toast.error + early return.
    expect(src).toMatch(/if\s*\(\s*effectiveAltStatus\s*&&\s*isLaserService\(\s*svc\s*\)\s*\)/);
    expect(src).toMatch(/toast\.error\([^)]*레이저/);

    // AC-2(세트): 수가세트 append 경로도 레이저 항목 필터(단일 차단과 동일 불변식).
    expect(src).toMatch(/effectiveAltStatus[\s\S]{0,80}filter\([\s\S]{0,40}!isLaserService/);

    // AC-3: 경고 배너 — effectiveAltStatus gated.
    expect(src).toMatch(/pmw-alt-laserblock-banner/);
    const bannerIdx = src.indexOf('pmw-alt-laserblock-banner');
    expect(bannerIdx).toBeGreaterThan(0);
    expect(src.slice(Math.max(0, bannerIdx - 200), bannerIdx)).toMatch(/effectiveAltStatus\s*&&/);
  });

  // ── C4: AC-7 — 패키지 항목 맨 우측 ALT 배지(메탈릭 실버) ────────────────────
  test('C4: PaymentMiniWindow — 패키지 ALT 배지(맨 우측, effectiveAltStatus gated, 메탈릭 실버)', () => {
    const src = read('src/components/PaymentMiniWindow.tsx');

    // 배지 testid.
    expect(src).toMatch(/pmw-pkg-alt-badge/);
    const badgeIdx = src.indexOf('pmw-pkg-alt-badge');
    expect(badgeIdx).toBeGreaterThan(0);

    // effectiveAltStatus 로 gating(ALT 비활성 미표시 — AC-4).
    const before = src.slice(Math.max(0, badgeIdx - 300), badgeIdx);
    expect(before).toMatch(/effectiveAltStatus\s*&&/);

    // 메탈릭 실버(origin 배지 패턴 재사용) — linear-gradient + inset boxShadow.
    const badgeBlock = src.slice(badgeIdx, badgeIdx + 700);
    expect(badgeBlock).toMatch(/linear-gradient/);
    expect(badgeBlock).toMatch(/inset 0 1px 1px/);
    // 배지 텍스트 ALT.
    expect(badgeBlock).toMatch(/ALT/);
  });

  // ── C5: Dashboard — altStatus 호출부 전달(AC-1/AC-6) ───────────────────────
  test('C5: Dashboard — PaymentMiniWindow 에 altStatus(altHolderSet 기반) 주입', () => {
    const src = read('src/pages/Dashboard.tsx');

    // PMW 렌더부에 altStatus prop 전달 — altHolderSet(customers.alt_status=true 집합, 대시보드 배지 SSOT).
    expect(src).toMatch(/altStatus=\{[^}]*altHolderSet\.has\(/);
    // null-safe(customer_id: string|null 가드).
    expect(src).toMatch(/miniPayTarget\?\.customer_id\s*\?\s*altHolderSet\.has/);
  });
});
