/**
 * T-20260520-foot-DOPAMINE-SCHEMA (TA1)
 * 풋CRM ↔ 도파민 양방향 연동 스키마 마이그레이션 검증
 *
 * 스펙: memory/_handoff/spec_foot_dopamine_integration_20260520.md §9
 *
 * 변경 내용:
 *   1) reservations.source_system TEXT (null | 'dopamine' | 'foot-walkin')
 *   2) reservations.external_id UUID (도파민 cue_card.id, NULL 허용)
 *   3) payments.external_id UUID (carry-over, NULL 허용)
 *   4) UNIQUE partial index on reservations(source_system, external_id) — 멱등성
 *   5) dopamine_outbound_log 테이블 (visited/paid 콜백 멱등 + 재시도 추적)
 *
 * AC-1: reservations.source_system / external_id 컬럼 존재 + UUID 타입
 * AC-2: payments.external_id 컬럼 존재 + UUID 타입
 * AC-3: dopamine_outbound_log 테이블 전체 스키마 정합
 * AC-4: UNIQUE(callback_type, event_id) 멱등 제약 존재
 * AC-5: SQL 파일 + 롤백 SQL 파일 쌍 존재
 * AC-6: upsert_reservation_from_source() RPC 존재 (source_system/external_id 활용)
 * AC-7: RLS — dopamine_outbound_log는 service_role만 접근
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const MIGRATION_FILE = '20260520000040_dopamine_integration_schema.sql';
const ROLLBACK_FILE = '20260520000040_dopamine_integration_schema.down.sql';
const PREV_MIGRATION = '20260513000050_reservations_source_system.sql';

function migrationPath(filename: string): string {
  return path.resolve(__dirname, '../../supabase/migrations', filename);
}

// ─────────────────────────────────────────────────────────────────
// AC-5: SQL 파일 쌍 존재 검증 (정적 파일 검사)
// ─────────────────────────────────────────────────────────────────
test.describe('AC-5: 마이그레이션 SQL 파일 쌍 존재', () => {
  test('TA1 마이그레이션 SQL 파일이 존재한다', () => {
    expect(fs.existsSync(migrationPath(MIGRATION_FILE))).toBe(true);
  });

  test('TA1 롤백 SQL 파일이 존재한다', () => {
    expect(fs.existsSync(migrationPath(ROLLBACK_FILE))).toBe(true);
  });

  test('선행 마이그레이션(reservations_source_system)이 존재한다', () => {
    expect(fs.existsSync(migrationPath(PREV_MIGRATION))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────
// SQL 내용 검증 — 스펙 §9 항목 전수 체크
// ─────────────────────────────────────────────────────────────────
test.describe('마이그레이션 SQL 내용 검증', () => {
  let sqlContent: string;
  let rollbackContent: string;

  test.beforeAll(() => {
    sqlContent = fs.readFileSync(migrationPath(MIGRATION_FILE), 'utf-8');
    rollbackContent = fs.readFileSync(migrationPath(ROLLBACK_FILE), 'utf-8');
  });

  // AC-1: reservations 컬럼
  test('AC-1: reservations.source_system 컬럼 ADD COLUMN이 포함된다', () => {
    expect(sqlContent).toMatch(/source_system/i);
    // IF NOT EXISTS 로 멱등 처리
    expect(sqlContent).toContain('ADD COLUMN IF NOT EXISTS source_system');
  });

  test('AC-1: reservations.external_id UUID 타입 변환이 포함된다', () => {
    expect(sqlContent).toContain('external_id');
    // TEXT → UUID 변환
    expect(sqlContent).toMatch(/ALTER COLUMN external_id TYPE uuid/i);
  });

  // AC-2: payments.external_id
  test('AC-2: payments.external_id uuid 컬럼 추가가 포함된다', () => {
    expect(sqlContent).toMatch(/ALTER TABLE public\.payments/i);
    expect(sqlContent).toMatch(/ADD COLUMN IF NOT EXISTS external_id uuid/i);
  });

  // AC-3: dopamine_outbound_log 테이블 구조
  test('AC-3: dopamine_outbound_log CREATE TABLE이 포함된다', () => {
    expect(sqlContent).toMatch(/CREATE TABLE IF NOT EXISTS public\.dopamine_outbound_log/i);
  });

  test('AC-3: dopamine_outbound_log에 external_id uuid NOT NULL 컬럼이 있다', () => {
    expect(sqlContent).toMatch(/external_id\s+uuid\s+NOT NULL/i);
  });

  test('AC-3: dopamine_outbound_log에 callback_type CHECK(visited|paid)가 있다', () => {
    expect(sqlContent).toMatch(/callback_type/i);
    expect(sqlContent).toContain("'visited'");
    expect(sqlContent).toContain("'paid'");
  });

  test('AC-3: dopamine_outbound_log에 status CHECK(pending|sent|duplicate|failed)가 있다', () => {
    expect(sqlContent).toContain("'pending'");
    expect(sqlContent).toContain("'sent'");
    expect(sqlContent).toContain("'duplicate'");
    expect(sqlContent).toContain("'failed'");
  });

  test('AC-3: dopamine_outbound_log에 attempts, last_attempt_at, payload, http_status 컬럼이 있다', () => {
    expect(sqlContent).toContain('attempts');
    expect(sqlContent).toContain('last_attempt_at');
    expect(sqlContent).toContain('payload');
    expect(sqlContent).toContain('http_status');
  });

  // AC-4: 멱등 UNIQUE 제약
  test('AC-4: UNIQUE(callback_type, event_id) 멱등 제약이 포함된다', () => {
    expect(sqlContent).toMatch(/UNIQUE\s*\(\s*callback_type,\s*event_id\s*\)/i);
  });

  // AC-7: RLS
  test('AC-7: dopamine_outbound_log에 ENABLE ROW LEVEL SECURITY가 설정된다', () => {
    expect(sqlContent).toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });

  test('AC-7: service_role 전용 RLS 정책이 정의된다', () => {
    expect(sqlContent).toMatch(/service_role/i);
  });

  // 인덱스
  test('idx_dopamine_outbound_log_external_id 인덱스가 포함된다', () => {
    expect(sqlContent).toContain('idx_dopamine_outbound_log_external_id');
  });

  test('idx_dopamine_outbound_log_status_created 인덱스가 포함된다', () => {
    expect(sqlContent).toContain('idx_dopamine_outbound_log_status_created');
  });

  // 롤백 SQL 검증
  test('롤백 SQL에 dopamine_outbound_log DROP TABLE이 포함된다', () => {
    expect(rollbackContent).toMatch(/DROP TABLE IF EXISTS public\.dopamine_outbound_log/i);
  });

  test('롤백 SQL에 payments.external_id DROP COLUMN이 포함된다', () => {
    expect(rollbackContent).toMatch(/DROP COLUMN IF EXISTS external_id/i);
  });
});

// ─────────────────────────────────────────────────────────────────
// AC-6: upsert_reservation_from_source() RPC SQL 검증
// ─────────────────────────────────────────────────────────────────
test.describe('AC-6: upsert_reservation_from_source RPC', () => {
  let rpcContent: string;

  test.beforeAll(() => {
    rpcContent = fs.readFileSync(migrationPath(PREV_MIGRATION), 'utf-8');
  });

  test('AC-6: upsert_reservation_from_source() 함수가 정의된다', () => {
    expect(rpcContent).toContain('upsert_reservation_from_source');
  });

  test('AC-6: source_system + external_id ON CONFLICT 멱등 upsert가 구현된다', () => {
    expect(rpcContent).toContain('ON CONFLICT (source_system, external_id)');
  });

  test('AC-6: SECURITY DEFINER로 선언된다', () => {
    expect(rpcContent).toContain('SECURITY DEFINER');
  });
});

// ─────────────────────────────────────────────────────────────────
// AC-1~3: 앱 빌드 무결성 검증 (DB-only 변경이라 FE 영향 없음)
// ─────────────────────────────────────────────────────────────────
test.describe('앱 정상 로딩 검증 (회귀 없음)', () => {
  const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

  test('앱이 오류 없이 로딩된다', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await page.goto(BASE_URL, { timeout: 15000 });
    await page.waitForLoadState('domcontentloaded');

    // 로그인 페이지나 대시보드로 도달해야 함
    const url = page.url();
    expect(url).toMatch(/localhost|vercel\.app/);

    // JS 에러 없음 (도파민 스키마와 무관한 앱 로딩)
    const criticalErrors = jsErrors.filter(
      (e) =>
        !e.includes('ResizeObserver') && // 무시 가능
        !e.includes('Non-Error promise rejection') // 무시 가능
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('dopamine_outbound_log 관련 타입이 FE 번들에 없거나 안전하게 undefined 처리된다', () => {
    // DB-only 변경: FE 코드에는 dopamine_outbound_log 직접 참조 없음
    // (Edge Function이 service_role로만 접근하는 구조)
    const srcDir = path.resolve(__dirname, '../../src');
    const srcFiles = getAllTsxFiles(srcDir);

    const dopamineRefs = srcFiles.flatMap((file) => {
      const content = fs.readFileSync(file, 'utf-8');
      // FE에서 dopamine_outbound_log 직접 쿼리하면 안 됨 (RLS 차단)
      const lines = content.split('\n');
      return lines
        .filter((line) => line.includes('dopamine_outbound_log'))
        .map((line) => `${file}:${line.trim()}`);
    });

    expect(dopamineRefs).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────
// 도메인 경계 검증 — 풋CRM이 도파민 DB를 직접 참조하지 않음
// ─────────────────────────────────────────────────────────────────
test.describe('도메인 경계 — 도파민 DB 직접 참조 금지', () => {
  test('FE 소스에 도파민 Supabase 프로젝트 ID(vucxspurgmrcslvdbiot)가 없다', () => {
    const srcDir = path.resolve(__dirname, '../../src');
    const srcFiles = getAllTsxFiles(srcDir);
    const dopamineProjectId = 'vucxspurgmrcslvdbiot';

    const refs = srcFiles.flatMap((file) => {
      const content = fs.readFileSync(file, 'utf-8');
      return content.includes(dopamineProjectId) ? [file] : [];
    });

    expect(refs).toHaveLength(0);
  });

  test('마이그레이션 SQL에 도파민 DB 직접 연결 구문이 없다', () => {
    const sqlContent = fs.readFileSync(migrationPath(MIGRATION_FILE), 'utf-8');
    // FDW / dblink / foreign server 금지
    expect(sqlContent).not.toMatch(/CREATE SERVER|FOREIGN DATA WRAPPER|dblink|postgres_fdw/i);
    // 도파민 project ID 직접 참조 금지
    expect(sqlContent).not.toContain('vucxspurgmrcslvdbiot');
  });
});

// ─────────────────────────────────────────────────────────────────
// 유틸 — src 디렉토리 재귀 .ts/.tsx 파일 목록
// ─────────────────────────────────────────────────────────────────
function getAllTsxFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return getAllTsxFiles(fullPath);
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) return [fullPath];
    return [];
  });
}
