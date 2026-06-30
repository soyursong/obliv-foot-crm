/**
 * T-20260630-foot-INGEST-REGISTRAR-CREATEDBY (RE-SCOPED, RECONCILE-FINAL)
 * reservation-ingest-from-dopamine → registrar_name provenance 표시축 + visit_route 착지 정적 검증
 *
 * ─ 권위 spec ──────────────────────────────────────────────────────
 *   DA-20260630-RESV-REGISTRAR-RECONCILE-FINAL (§416 governing, t91v).
 *   7vts(registrar_email→created_by 착지) = WITHDRAWN(§416 이중계상).
 *
 * ─ 확정 스코프 (3 + KEEP 1) ───────────────────────────────────────
 *   (a) created_via='dopamine' same write-path (旣존 — 회귀 확인).
 *   (b) registrar_name → reservation_registrars(group_name='TM'·clinic·active) name 조회 →
 *       매칭 시 registrar_id(FK)+name 스냅샷, 무매칭 → registrar_id=NULL + '[도파민TM] {name}' 라벨.
 *   (c) created_by = NULL graceful 유지(착지 시도 제거).
 *   (KEEP) visit_route='TM'(旣존 enum) — source_system='dopamine'과 직교 독립 set.
 *
 * ─ ⛔ 방화벽(필수) ─────────────────────────────────────────────────
 *   registrar_name/registrar_id 는 어떤 stats/aggregation/인센티브 산식으로도 승격 금지 — 표시 전용.
 *
 * 스펙: 티켓 §✅ RECONCILE-FINAL AC1~AC5 + §현장 클릭 시나리오.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EF_PATH = path.resolve(
  __dirname,
  '../../supabase/functions/reservation-ingest-from-dopamine/index.ts',
);

function readEf(): string {
  return fs.readFileSync(EF_PATH, 'utf-8');
}

// rsvPayload 블록 추출: 객체 리터럴 선언 ~ insert 직전
function rsvPayloadBlock(src: string): string {
  const start = src.indexOf('const rsvPayload: Record<string, unknown> = {');
  const end = src.indexOf(".from('reservations')\n      .insert(rsvPayload)", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

// registrar 해소 블록 추출: registrarId 선언 ~ VISIT_ROUTE_ENUM 직전
function registrarBlock(src: string): string {
  const start = src.indexOf('let registrarId: string | null = null;');
  const end = src.indexOf('const VISIT_ROUTE_ENUM', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

// ── AC-1(FINAL): created_via='dopamine' same write-path (旣존 회귀) ─────────────
test("AC-1: created_via 매핑 + dopamine 인입 created_via='dopamine' 착지(旣존 회귀)", () => {
  const src = readEf();
  // CREATED_VIA_BY_SOURCE map + dopamine 기본값
  expect(src).toContain('CREATED_VIA_BY_SOURCE');
  expect(src).toMatch(/dopamine:\s*'dopamine'/);
  // rsvPayload 에 created_via 키 유지
  expect(rsvPayloadBlock(src)).toContain('created_via:');
});

// ── (c) created_by = NULL graceful — 착지 시도 제거(§416) ──────────────────────
test('(c): created_by 착지 시도 없음 — rsvPayload 에 created_by 키 부재', () => {
  const block = rsvPayloadBlock(readEf());
  // RE-SCOPE: registrar→created_by 착지 WITHDRAWN. 어떤 형태로도 created_by 를 INSERT 하지 않는다.
  // (주석 단어가 아닌) 실제 페이로드 키 'created_by:' 가 없어야 한다.
  const codeOnly = block
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
  expect(codeOnly).not.toMatch(/created_by\s*:/);
});

// ── AC-2(표시): registrar_name → reservation_registrars(TM그룹·clinic·active) name 매칭 ──
test('AC-2: registrar 해소는 reservation_registrars name 매칭(TM·clinic·active)', () => {
  const block = registrarBlock(readEf());
  expect(block).toContain("from('reservation_registrars')");
  expect(block).toContain("eq('clinic_id', clinicId)");
  expect(block).toContain("eq('group_name', 'TM')");
  expect(block).toContain("eq('active', true)");
  expect(block).toContain("eq('name', rn)");
});

// ── AC-2(매칭 성공): registrar_id(FK) + 마스터 name 스냅샷 ─────────────────────
test('AC-2: 매칭 시 registrar_id(FK)+마스터 name 스냅샷 착지', () => {
  const block = registrarBlock(readEf());
  expect(block).toMatch(/registrarId\s*=\s*regRow\.id/);
  // 스냅샷 = 마스터 name (리네임/삭제 대비)
  expect(block).toMatch(/registrarNameLanded\s*=\s*\(regRow\.name/);
});

// ── AC-2(무매칭): provenance 라벨 TEXT, registrar_id=NULL ──────────────────────
test('AC-2: 무매칭 → registrar_id=NULL + "[도파민TM] {name}" provenance 라벨', () => {
  const block = registrarBlock(readEf());
  expect(block).toContain('[도파민TM] ');
  // 무매칭 분기에서 registrarId 는 null
  expect(block).toMatch(/registrarId\s*=\s*null;/);
});

// ── ⛔ email/staff_id 매칭 금지(컬럼 부재 — 정정-1) ────────────────────────────
test('⛔ email/staff_id 매칭 시도 없음(reservation_registrars 컬럼 부재)', () => {
  const block = registrarBlock(readEf());
  expect(block).not.toContain("eq('email'");
  expect(block).not.toContain("eq('staff_id'");
  expect(block).not.toContain('registrar_email');
});

// ── AC-3(KEEP): visit_route='TM' 旣존 enum 검증 후 착지, source_system과 직교 ──
test('AC-3: visit_route 旣존 enum 검증 착지 + source_system 직교', () => {
  const src = readEf();
  // 旣존 CHECK enum 4값으로 검증(신규 enum 신설 금지)
  expect(src).toContain("const VISIT_ROUTE_ENUM = ['TM', '워크인', '인바운드', '지인소개']");
  expect(src).toMatch(/VISIT_ROUTE_ENUM\.includes\(visitRoute\)/);
  // source_system 은 별도로 'dopamine' 유지(직교 독립 set)
  const block = rsvPayloadBlock(src);
  expect(block).toContain('visit_route:');
  expect(block).toMatch(/source_system:\s*sourceSystem\s*\?\?\s*'dopamine'/);
});

// ── AC-4(FK-safety·forward-only): 표시 컬럼은 조건부 spread(미해소→미삽입) ──────
test('AC-4: registrar/visit_route 는 조건부 착지(미해소→미삽입, 예약 INSERT 항상 성공)', () => {
  const block = rsvPayloadBlock(readEf());
  // null 이면 키 미삽입 → DEFAULT NULL 유지, FK 위반/orphan 0
  expect(block).toMatch(/\.\.\.\(registrarId\s*\?\s*\{\s*registrar_id:\s*registrarId\s*\}\s*:\s*\{\}\)/);
  expect(block).toMatch(/\.\.\.\(registrarNameLanded\s*\?\s*\{\s*registrar_name:\s*registrarNameLanded\s*\}\s*:\s*\{\}\)/);
  expect(block).toMatch(/\.\.\.\(visitRouteLanded\s*\?\s*\{\s*visit_route:\s*visitRouteLanded\s*\}\s*:\s*\{\}\)/);
});

// ── AC-4(비차단): registrar lookup 에러도 ingest 비차단(provenance 라벨 fallback) ──
test('AC-4: registrar 조회 에러 비차단 — provenance 라벨 fallback', () => {
  const block = registrarBlock(readEf());
  expect(block).toContain('non-fatal');
  // 에러 분기에서도 500 return 없이 라벨 fallback
  expect(block).not.toMatch(/regLookupErr[\s\S]*return json\([^)]*500/);
});

// ── AC-5(방화벽): registrar 가 stats/created_by 로 승격되지 않음(표시 전용) ──────
test('AC-5(방화벽): registrar_name/registrar_id 가 created_by/stats 산식에 미유입', () => {
  const src = readEf();
  // registrarId/registrarNameLanded 가 created_by 에 할당되는 경로가 없어야 함
  expect(src).not.toMatch(/created_by[\s:]*=?\s*registrar/i);
  expect(src).not.toMatch(/registrar(Id|NameLanded)[\s\S]{0,40}created_by/);
});

// ── 회귀: 인접 핵심 불변식 유지 ────────────────────────────────────────────────
test('회귀: rsvPayload 인접 컬럼·멱등·응답 분기 불변', () => {
  const block = rsvPayloadBlock(readEf());
  expect(block).toContain('customer_id:');
  expect(block).toContain('customer_name:');
  expect(block).toContain('clinic_id:');
  expect(block).toContain('source_system:');
  expect(block).toContain('reservation_date:');
  expect(block).toContain('reservation_time:');

  const src = readEf();
  expect(src).toContain('applied: true');
  expect(src).toContain('applied: false');
  expect(src).toContain('23505');
});
