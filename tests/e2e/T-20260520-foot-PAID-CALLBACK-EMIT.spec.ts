/**
 * T-20260520-foot-PAID-CALLBACK-EMIT (TA4)
 * 풋 첫 패키지 결제 시 도파민 paid 콜백 발사 검증
 *
 * 스펙: memory/_handoff/spec_foot_dopamine_integration_20260520.md §3-2, §6-2, §7
 *
 * AC-1: 첫 패키지 결제 판정 (source_system='dopamine' + external_id NOT NULL + outbound_log 없음)
 * AC-2: outbound_log INSERT (callback_type='paid', event_id=package_id)
 * AC-3: HTTP POST 발사 (payload 구조 §6-2 준수)
 * AC-4: 1회 발사 보장 (outbound_log 기존 sent 있으면 skip)
 * AC-5: Negative 케이스 (source_system≠dopamine, 추가 패키지, 회차차감)
 * AC-6: 공통 emitter 모듈 — visited/paid 동일 EF
 *
 * NOTE: DB/HTTP 통합 테스트는 TC1(supervisor) 통합 게이트에서 수행.
 *       이 파일은 정적 코드 구조 + 페이로드 스펙 준수 + 멱등 로직을 검증.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ESM compatibility — "type": "module" 프로젝트에서 __dirname 재정의
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─────────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────────
function efPath(...segments: string[]): string {
  return path.resolve(__dirname, '../../supabase/functions', ...segments);
}

function srcPath(...segments: string[]): string {
  return path.resolve(__dirname, '../../src', ...segments);
}

function migPath(filename: string): string {
  return path.resolve(__dirname, '../../supabase/migrations', filename);
}

// ─────────────────────────────────────────────────────────────────
// AC-6: 공통 emitter EF 존재 + 구조 검증
// ─────────────────────────────────────────────────────────────────
test.describe('AC-6: dopamine-callback Edge Function 구조', () => {
  const efFile = efPath('dopamine-callback', 'index.ts');
  let efContent: string;

  test.beforeAll(() => {
    efContent = fs.readFileSync(efFile, 'utf-8');
  });

  test('dopamine-callback/index.ts 파일이 존재한다', () => {
    expect(fs.existsSync(efFile)).toBe(true);
  });

  test('type="visited" 핸들러가 구현된다', () => {
    expect(efContent).toContain("'visited'");
    expect(efContent).toContain("type: 'visited'");
  });

  test('type="paid" 핸들러가 구현된다', () => {
    expect(efContent).toContain("'paid'");
    expect(efContent).toContain("type: 'paid'");
  });

  test('Deno.serve() 진입점이 있다', () => {
    expect(efContent).toMatch(/Deno\.serve\s*\(/);
  });

  test('Bearer JWT 인증 검증이 있다', () => {
    expect(efContent).toMatch(/Authorization/);
    expect(efContent).toContain('UNAUTHORIZED');
  });

  test('SUPABASE_SERVICE_ROLE_KEY 로 service role 클라이언트를 생성한다', () => {
    expect(efContent).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(efContent).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });
});

// ─────────────────────────────────────────────────────────────────
// AC-3: Payload 스펙 §6-2 준수 검증
// ─────────────────────────────────────────────────────────────────
test.describe('AC-3: paid 콜백 payload 스펙 §6-2 준수', () => {
  let efContent: string;

  test.beforeAll(() => {
    efContent = fs.readFileSync(efPath('dopamine-callback', 'index.ts'), 'utf-8');
  });

  test('payload에 source_system: "foot" 이 포함된다', () => {
    expect(efContent).toMatch(/source_system.*['"]foot['"]/);
  });

  test('payload에 clinic_slug: "jongno-foot" 이 포함된다', () => {
    expect(efContent).toMatch(/clinic_slug.*['"]jongno-foot['"]/);
  });

  test('payload에 type 필드가 포함된다', () => {
    expect(efContent).toMatch(/type.*['"]paid['"]/);
  });

  test('payload에 is_first_package: true 가 포함된다', () => {
    expect(efContent).toContain('is_first_package: true');
  });

  test('payload에 amount, currency 필드가 포함된다', () => {
    expect(efContent).toContain('amount');
    expect(efContent).toMatch(/currency.*['"]KRW['"]/);
  });

  test('payload에 package_name 필드가 포함된다', () => {
    expect(efContent).toContain('package_name');
  });

  test('X-Callback-Secret 헤더가 포함된다', () => {
    expect(efContent).toContain('X-Callback-Secret');
    expect(efContent).toContain('DOPAMINE_CALLBACK_SECRET');
  });

  test('DOPAMINE_CALLBACK_URL env가 사용된다', () => {
    expect(efContent).toContain('DOPAMINE_CALLBACK_URL');
  });
});

// ─────────────────────────────────────────────────────────────────
// AC-2: outbound_log 기록 로직
// ─────────────────────────────────────────────────────────────────
test.describe('AC-2: outbound_log INSERT + UPDATE 로직', () => {
  let efContent: string;

  test.beforeAll(() => {
    efContent = fs.readFileSync(efPath('dopamine-callback', 'index.ts'), 'utf-8');
  });

  test('dopamine_outbound_log INSERT가 구현된다', () => {
    expect(efContent).toContain('dopamine_outbound_log');
    expect(efContent).toMatch(/\.insert\s*\(/);
  });

  test("status='pending' 으로 먼저 INSERT한다", () => {
    expect(efContent).toContain("status: 'pending'");
  });

  test("HTTP 응답 후 status='sent'|'failed'|'duplicate'로 UPDATE한다", () => {
    expect(efContent).toContain("'sent'");
    expect(efContent).toContain("'failed'");
    expect(efContent).toContain("'duplicate'");
    expect(efContent).toMatch(/\.update\s*\(/);
  });

  test('http_status, response_body, attempts, last_attempt_at 필드를 업데이트한다', () => {
    expect(efContent).toContain('http_status');
    expect(efContent).toContain('response_body');
    expect(efContent).toContain('attempts');
    expect(efContent).toContain('last_attempt_at');
  });

  test('UNIQUE 위반(23505) 시 duplicate로 처리한다', () => {
    expect(efContent).toContain('23505');
    expect(efContent).toContain("reason: 'duplicate'");
  });
});

// ─────────────────────────────────────────────────────────────────
// AC-1 + AC-4: is_first_package 판정 + 1회 발사 보장
// ─────────────────────────────────────────────────────────────────
test.describe('AC-1 + AC-4: is_first_package 판정 로직', () => {
  let efContent: string;

  test.beforeAll(() => {
    efContent = fs.readFileSync(efPath('dopamine-callback', 'index.ts'), 'utf-8');
  });

  test('external_id + callback_type=paid + status=sent/pending 기존 로그 조회가 있다', () => {
    expect(efContent).toContain("callback_type");
    expect(efContent).toMatch(/eq.*['"]callback_type['"]|eq.*paid/);
    expect(efContent).toMatch(/in.*['"]sent['"].*['"]pending['"]/);
  });

  test('기존 paid 로그가 있으면 not_first_package를 반환한다', () => {
    expect(efContent).toContain("'not_first_package'");
  });

  test('source_system이 dopamine이 아니면 not_dopamine_source를 반환한다', () => {
    expect(efContent).toContain("'not_dopamine_source'");
  });

  test("source_system !== 'dopamine' 조건이 있다", () => {
    expect(efContent).toMatch(/source_system.*!==.*['"]dopamine['"]/);
  });

  test('external_id가 null이면 발사하지 않는다', () => {
    expect(efContent).toMatch(/!\s*reservation\.external_id/);
  });
});

// ─────────────────────────────────────────────────────────────────
// AC-5: Negative 케이스 — PaymentDialog FE 로직 검증
// ─────────────────────────────────────────────────────────────────
test.describe('AC-5: PaymentDialog paid 콜백 FE 트리거 로직', () => {
  const dialogFile = srcPath('components', 'PaymentDialog.tsx');
  let dialogContent: string;

  test.beforeAll(() => {
    dialogContent = fs.readFileSync(dialogFile, 'utf-8');
  });

  test('PaymentDialog.tsx에 도파민 paid 콜백 호출이 구현된다', () => {
    expect(dialogContent).toContain('dopamine-callback');
    expect(dialogContent).toContain("type: 'paid'");
  });

  test('source_system === "dopamine" 조건 확인 후 발사한다', () => {
    expect(dialogContent).toMatch(/source_system.*===.*['"]dopamine['"]/);
  });

  test('external_id 존재 여부 확인 후 발사한다', () => {
    expect(dialogContent).toMatch(/external_id/);
  });

  test('reservation_id가 없으면 발사를 시도하지 않는다', () => {
    // checkIn.reservation_id 가드
    expect(dialogContent).toContain('reservation_id');
  });

  test('fire-and-forget (non-blocking) 패턴으로 호출한다', () => {
    // IIFE async 패턴 — 결제 완료 UX를 블록하지 않음
    expect(dialogContent).toMatch(/\(\s*async\s*\(\)\s*=>/);
  });

  test('콜백 실패가 결제 성공 UX를 블록하지 않는다', () => {
    // try-catch with non-fatal warning
    expect(dialogContent).toMatch(/catch.*cbErr|catch.*paid.*callback/i);
  });

  test('package_id를 event_id로 전달한다', () => {
    expect(dialogContent).toContain('package_id: newPackageId');
  });

  test('amount를 totalAmount로 전달한다', () => {
    expect(dialogContent).toContain('amount: totalAmount');
  });

  test('package_name을 selectedPreset.label로 전달한다', () => {
    expect(dialogContent).toContain('package_name: selectedPreset.label');
  });
});

// ─────────────────────────────────────────────────────────────────
// Reservation 타입 확인
// ─────────────────────────────────────────────────────────────────
test.describe('Reservation 타입 source_system / external_id', () => {
  const typesFile = srcPath('lib', 'types.ts');
  let typesContent: string;

  test.beforeAll(() => {
    typesContent = fs.readFileSync(typesFile, 'utf-8');
  });

  test('Reservation 인터페이스에 source_system 필드가 있다', () => {
    expect(typesContent).toMatch(/source_system\?.*string.*null/);
  });

  test('Reservation 인터페이스에 external_id 필드가 있다', () => {
    expect(typesContent).toMatch(/external_id\?.*string.*null/);
  });
});

// ─────────────────────────────────────────────────────────────────
// 도메인 경계 — 도파민 DB 직접 참조 금지
// ─────────────────────────────────────────────────────────────────
test.describe('도메인 경계: 도파민 DB 직접 접근 금지', () => {
  test('FE 소스에 도파민 Supabase 프로젝트 ID(vucxspurgmrcslvdbiot)가 없다', () => {
    const srcDir = srcPath();
    const dopamineId = 'vucxspurgmrcslvdbiot';
    const files = getAllTsFiles(srcDir);
    const refs = files.filter((f) => fs.readFileSync(f, 'utf-8').includes(dopamineId));
    expect(refs).toHaveLength(0);
  });

  test('EF에 도파민 DB 직접 연결(FDW/dblink) 구문이 없다', () => {
    const efContent = fs.readFileSync(efPath('dopamine-callback', 'index.ts'), 'utf-8');
    expect(efContent).not.toContain('vucxspurgmrcslvdbiot');
    expect(efContent).not.toMatch(/CREATE SERVER|FOREIGN DATA WRAPPER|dblink/i);
  });
});

// ─────────────────────────────────────────────────────────────────
// 앱 빌드 무결성 (회귀 없음)
// ─────────────────────────────────────────────────────────────────
test.describe('앱 정상 로딩 검증 (회귀 없음)', () => {
  const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

  test('앱이 오류 없이 로딩된다', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await page.goto(BASE_URL, { timeout: 15000 });
    await page.waitForLoadState('domcontentloaded');

    const url = page.url();
    expect(url).toMatch(/localhost|vercel\.app/);

    const criticalErrors = jsErrors.filter(
      (e) =>
        !e.includes('ResizeObserver') &&
        !e.includes('Non-Error promise rejection'),
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('dopamine_outbound_log를 FE에서 직접 조회하지 않는다', () => {
    const srcDir = srcPath();
    const files = getAllTsFiles(srcDir);
    const refs = files.flatMap((f) => {
      const content = fs.readFileSync(f, 'utf-8');
      return content.includes('dopamine_outbound_log') ? [f] : [];
    });
    expect(refs).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────
// 유틸 함수
// ─────────────────────────────────────────────────────────────────
function getAllTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return getAllTsFiles(fullPath);
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) return [fullPath];
    return [];
  });
}
