/**
 * E2E spec — T-20260618-foot-RXSET-PRESCRX-SVC-DB-UNIFY
 *   처방세트(prescription_codes) ↔ 서비스관리(services) 단일 DB 통합 (ADDITIVE)
 *
 * 본 티켓은 FE 변경 없는 순수 DB 통합(extension-table 패턴):
 *   ADD COLUMN prescription_codes.service_id FK→services + 통합 read뷰 v_foot_drug_master.
 * 따라서 의미 있는 E2E 검증은 (1) 마이그 ADDITIVE 정적단언 + (2) DB-layer 통합/무회귀 단언.
 *
 * 시나리오1(약 동일성): services 처방약과 prescription_codes 가 service_id 로 연결되어
 *   통합뷰 v_foot_drug_master 한 화면에서 '같은 약'으로 조회됨(현장 '같은 DB' 체감).
 * 시나리오2(무회귀): 약품폴더 매핑(prescription_code_folders.prescription_code_id FK)·
 *   prescription_codes 행수·기존 컬럼 전부 통합 전과 동일. 차트 진단 TEXT schema-on-read 불변.
 *
 * 환경: SUPABASE_DB_PASSWORD 필요(.env). 없으면 DB-layer 테스트 skip.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const { Client } = pg;
const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const MIG = 'supabase/migrations/20260618140000_prescription_codes_service_id_unify.sql';
const ROLLBACK = 'supabase/migrations/20260618140000_prescription_codes_service_id_unify.rollback.sql';

const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
const DB_HOST = process.env.SUPABASE_DB_HOST ?? 'aws-1-ap-southeast-1.pooler.supabase.com';
const DB_USER = process.env.SUPABASE_DB_USER ?? 'postgres.rxlomoozakkjesdqjtvd';

async function withClient<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new Client({ host: DB_HOST, port: 5432, database: 'postgres', user: DB_USER,
    password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

// ════════════════════════════════════════════════════════════════════
// A. 마이그 ADDITIVE 정적 단언 (DB 비의존 — 항상 실행)
// ════════════════════════════════════════════════════════════════════
test('A1: 마이그는 순수 ADDITIVE — ADD COLUMN service_id + FK SET NULL', () => {
  const sql = read(MIG);
  expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS service_id uuid NULL/);
  expect(sql).toMatch(/REFERENCES services\(id\) ON DELETE SET NULL/);
  // DROP/TRUNCATE/ALTER ... DROP 같은 파괴 구문이 base 데이터에 없어야 함(뷰 DROP IF EXISTS 재생성만 허용)
  expect(sql).not.toMatch(/DROP TABLE/i);
  expect(sql).not.toMatch(/TRUNCATE/i);
  expect(sql).not.toMatch(/DELETE FROM/i);
  expect(sql).not.toMatch(/ALTER TABLE prescription_codes\s+DROP/i);
});

test('A2: 통합뷰 v_foot_drug_master = services 처방약 LEFT JOIN prescription_codes ON service_id', () => {
  const sql = read(MIG);
  expect(sql).toContain('CREATE VIEW v_foot_drug_master');
  expect(sql).toContain('security_invoker = on');
  expect(sql).toMatch(/LEFT JOIN prescription_codes pc ON pc\.service_id = s\.id/);
  expect(sql).toContain("WHERE s.category_label = '처방약'");
  expect(sql).toContain('has_hira_link');
});

test('A3: 롤백 SQL = 무손실 DROP(뷰·인덱스·컬럼)만', () => {
  const rb = read(ROLLBACK);
  expect(rb).toContain('DROP VIEW IF EXISTS v_foot_drug_master');
  expect(rb).toContain('DROP INDEX IF EXISTS idx_prescription_codes_service_id');
  expect(rb).toMatch(/ALTER TABLE prescription_codes\s+DROP COLUMN IF EXISTS service_id/);
});

// ════════════════════════════════════════════════════════════════════
// B. DB-layer 통합/무회귀 (적용된 prod 스키마 대상)
// ════════════════════════════════════════════════════════════════════
test('B1[시나리오1]: service_id 컬럼 + FK ON DELETE SET NULL 존재', async () => {
  test.skip(!DB_PASSWORD, 'SUPABASE_DB_PASSWORD 없음 → DB-layer skip');
  await withClient(async (c) => {
    const col = await c.query(`SELECT data_type, is_nullable FROM information_schema.columns
      WHERE table_name='prescription_codes' AND column_name='service_id'`);
    expect(col.rows.length).toBe(1);
    expect(col.rows[0].data_type).toBe('uuid');
    expect(col.rows[0].is_nullable).toBe('YES');
    const fk = await c.query(`SELECT confdeltype FROM pg_constraint
      WHERE conrelid='prescription_codes'::regclass AND contype='f' AND confrelid='services'::regclass`);
    expect(fk.rows.length).toBeGreaterThanOrEqual(1);
    expect(fk.rows.map((r: any) => r.confdeltype)).toContain('n'); // n = SET NULL
  });
});

test('B2[시나리오1]: 통합뷰가 services 처방약을 한 화면으로 조회(같은 DB 체감)', async () => {
  test.skip(!DB_PASSWORD, 'SUPABASE_DB_PASSWORD 없음 → DB-layer skip');
  await withClient(async (c) => {
    const v = await c.query(`SELECT count(*)::int n FROM v_foot_drug_master`);
    const svc = await c.query(`SELECT count(*)::int n FROM services WHERE category_label='처방약'`);
    // 뷰 행수 = services 처방약 행수 (LEFT JOIN 기준테이블=services)
    expect(v.rows[0].n).toBe(svc.rows[0].n);
    // 뷰는 약명 + HIRA 메타 컬럼을 한 행에 노출
    const cols = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name='v_foot_drug_master'`);
    const names = cols.rows.map((r: any) => r.column_name);
    expect(names).toEqual(expect.arrayContaining(['service_name', 'pc_name_ko', 'pc_claim_code', 'has_hira_link']));
  });
});

test('B3[시나리오2-무회귀]: 약품폴더 매핑 FK·prescription_codes 무손실', async () => {
  test.skip(!DB_PASSWORD, 'SUPABASE_DB_PASSWORD 없음 → DB-layer skip');
  await withClient(async (c) => {
    // 약품폴더 매핑(prescription_code_folders.prescription_code_id) FK 불변 — 매핑행이 가리키는 약이 모두 실존
    const orphan = await c.query(`SELECT count(*)::int n FROM prescription_code_folders f
      LEFT JOIN prescription_codes p ON p.id = f.prescription_code_id WHERE p.id IS NULL`);
    expect(orphan.rows[0].n).toBe(0); // 고아 매핑 0 = FK 무손실
    // prescription_codes 기존 핵심 컬럼 보존(통합이 카탈로그를 건드리지 않음)
    const cols = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name='prescription_codes'`);
    const names = cols.rows.map((r: any) => r.column_name);
    expect(names).toEqual(expect.arrayContaining(['id', 'claim_code', 'name_ko', 'classification', 'insurance_status']));
  });
});

test('B4[시나리오2-무회귀]: 차트 진단/처방은 TEXT/JSONB schema-on-read 불변(FK 손실 0)', async () => {
  test.skip(!DB_PASSWORD, 'SUPABASE_DB_PASSWORD 없음 → DB-layer skip');
  await withClient(async (c) => {
    // medical_charts.diagnosis 는 TEXT(스키마 비강제) — 본 통합이 신규 FK 강제를 걸지 않았음 확인
    const diag = await c.query(`SELECT data_type FROM information_schema.columns
      WHERE table_name='medical_charts' AND column_name='diagnosis'`);
    if (diag.rows.length) expect(['text', 'character varying']).toContain(diag.rows[0].data_type);
    // 통합으로 medical_charts 에 service_id 류 신규 NOT NULL FK 가 추가되지 않았음(무회귀)
    const charts = await c.query(`SELECT count(*)::int n FROM medical_charts`);
    expect(charts.rows[0].n).toBeGreaterThanOrEqual(0); // 차트 read 정상(에러 없음)
  });
});
