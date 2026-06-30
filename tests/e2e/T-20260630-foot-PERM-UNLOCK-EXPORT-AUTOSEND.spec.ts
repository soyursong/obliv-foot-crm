import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * E2E Spec — T-20260630-foot-PERM-UNLOCK-EXPORT-AUTOSEND
 *
 * 풋 ④ 고객목록 내보내기(PII egress) + ⑨ 자동발송·수신거부(opt-out) 권한확대 + sub-gate.
 * DA CONSULT-REPLY DA-20260701 (CR-20260701-foot-PERM-UNLOCK-EXPORT-AUTOSEND) GO 조건부(C1~C4).
 *
 * 현장 클릭 시나리오(티켓 §현장 클릭 시나리오)의 정적-소스/계약 검증 변환:
 *   시나리오1 ④ 직원 export + audit  → AC1·AC2·AC3
 *   시나리오2 ⑨ opt-out soft-delete    → AC4·AC5·AC6
 *   시나리오3 scope 가드               → AC7
 *
 * ── AC 매핑 ──
 * AC1. customer_export 게이트 = 직원 3역할(coordinator/consultant/therapist) ADDITIVE 확대 + admin/manager/director 무회귀.
 * AC2. export 성공 시 fn_log_customer_export(DEFINER RPC) 감사호출 (두 경로 모두). [C1]
 * AC3. filter_context = 구조메타만(has_query/has_staff_filter bool) — 검색어 원문(전화/이름) 미전달. [C1②]
 * AC4. customer_export_audit = actor_user_id FK 없음(cascade 금지) + DEFINER 서버파생 + SELECT admin/manager/director. [C1①·Q2]
 * AC5. opt-out '삭제' = hard-delete(.delete()) 아님 → soft-delete UPDATE(deleted_at/deleted_by). [Q8]
 * AC6. opt-out RLS = partial-unique(WHERE deleted_at IS NULL) + DELETE 정책 미생성 + clinic_id INVARIANT(USING+WITH CHECK). [C2·C3·Q8]
 * AC7. scope 가드 — rrn export 영구제외 + send/Solapi 키 신설 0 + 롤백SQL 동반. [C4]
 *
 * 본 spec 은 auth 불요(unit 프로젝트 — 정적 소스/계약 검증). 실서버 불필요.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const PERMS = read('src/lib/permissions.ts');
const CUSTOMERS = read('src/pages/Customers.tsx');
const ADMIN = read('src/pages/AdminSettings.tsx');
const CUSTEXPORT = read('src/lib/customerExport.ts');
const CUSTCSV = read('src/lib/customerCsv.ts');

const MIG_DIR = 'supabase/migrations';
const AUDIT_MIG = read(`${MIG_DIR}/20260701030000_customer_export_audit.sql`);
const AUDIT_RB = read(`${MIG_DIR}/20260701030000_customer_export_audit.rollback.sql`);
const OPTOUT_MIG = read(`${MIG_DIR}/20260701031000_optout_soft_delete_legal_guard.sql`);
const OPTOUT_RB = read(`${MIG_DIR}/20260701031000_optout_soft_delete_legal_guard.rollback.sql`);

// ── AC1: customer_export 3역할 ADDITIVE 확대 + 무회귀 ────────────────────────
test('AC1 customer_export 게이트 = 6역할(3 ADDITIVE + 3 escape 무회귀)', () => {
  const m = PERMS.match(/customer_export:\s*\[([^\]]*)\]/);
  expect(m, 'customer_export 배열 존재').toBeTruthy();
  const arr = m![1];
  // ADDITIVE 3역할
  for (const r of ['coordinator', 'consultant', 'therapist']) {
    expect(arr.includes(`'${r}'`), `customer_export += ${r}`).toBeTruthy();
  }
  // escape(기존) 무회귀
  for (const r of ['admin', 'manager', 'director']) {
    expect(arr.includes(`'${r}'`), `customer_export 기존 ${r} 무회귀`).toBeTruthy();
  }
  // 최소권한: 전직원 무제한 개방 아님 — part_lead/staff/tm 미포함(보수적 범위)
  for (const r of ['part_lead', 'staff', 'tm']) {
    expect(arr.includes(`'${r}'`), `customer_export 에 ${r} 미포함(보수적)`).toBeFalsy();
  }
});

// ── AC2: export 성공 시 audit RPC 호출 (두 경로) ─────────────────────────────
test('AC2 두 export 경로 모두 fn_log_customer_export 감사호출', () => {
  expect(CUSTOMERS.includes('fn_log_customer_export'), 'audit RPC 호출 존재').toBeTruthy();
  expect(CUSTOMERS.includes(`logExportAudit('selected'`), 'selected 경로 audit').toBeTruthy();
  expect(CUSTOMERS.includes(`logExportAudit('filter_all'`), 'filter_all 경로 audit').toBeTruthy();
  // best-effort(비차단): 실패가 다운로드를 막지 않도록 try/catch + 경고
  expect(/catch[\s\S]{0,120}non-blocking/i.test(CUSTOMERS), 'audit 실패 비차단(best-effort)').toBeTruthy();
});

// ── AC3: filter_context = 구조메타만(PII 평문 미전달) ─────────────────────────
test('AC3 filter_context 는 구조메타 bool 만 — 검색어 원문 미전달', () => {
  const blk = CUSTOMERS.match(/p_filter_context:\s*\{[\s\S]*?\}/);
  expect(blk, 'p_filter_context 페이로드 존재').toBeTruthy();
  const payload = blk![0];
  expect(payload.includes('has_query'), 'has_query bool').toBeTruthy();
  expect(payload.includes('has_staff_filter'), 'has_staff_filter bool').toBeTruthy();
  // 검색어 원문(query 값)·전화번호를 그대로 실어보내지 않음
  expect(/query\s*[,}]/.test(payload), 'query 원문 값 미전달').toBeFalsy();
  expect(payload.includes('phone'), 'phone 미전달').toBeFalsy();
});

// ── AC4: 감사테이블 — actor FK 없음 + DEFINER 서버파생 + SELECT 제한 ─────────
test('AC4 customer_export_audit DEFINER/actor-no-FK/SELECT 제한', () => {
  expect(/CREATE TABLE IF NOT EXISTS public\.customer_export_audit/.test(AUDIT_MIG)).toBeTruthy();
  // C1①: actor_user_id 는 FK·cascade 금지 → REFERENCES 없이 평 uuid
  const actorLine = AUDIT_MIG.split('\n').find((l) => l.includes('actor_user_id') && l.includes('UUID'));
  expect(actorLine, 'actor_user_id 컬럼 존재').toBeTruthy();
  expect(/REFERENCES/i.test(actorLine!), 'actor_user_id 에 FK(REFERENCES) 없음').toBeFalsy();
  // Q2: DEFINER RPC 가 서버파생
  expect(AUDIT_MIG.includes('SECURITY DEFINER'), 'DEFINER RPC').toBeTruthy();
  expect(AUDIT_MIG.includes('auth.uid()'), 'actor 서버파생').toBeTruthy();
  expect(AUDIT_MIG.includes('get_user_role()'), 'role 서버파생').toBeTruthy();
  expect(AUDIT_MIG.includes('get_user_clinic_id()'), 'clinic 서버파생').toBeTruthy();
  // client write 차단: INSERT 정책 미생성 (SELECT 정책만)
  expect(/FOR SELECT/i.test(AUDIT_MIG), 'SELECT 정책').toBeTruthy();
  expect(/CREATE POLICY[^;]*FOR INSERT[\s\S]*customer_export_audit/i.test(AUDIT_MIG), 'client INSERT 정책 없음').toBeFalsy();
  // SELECT = admin/manager/director 한정
  const sel = AUDIT_MIG.match(/custexport_audit_select[\s\S]*?USING\s*\(([\s\S]*?)\);/);
  expect(sel, 'SELECT 정책 USING').toBeTruthy();
  expect(sel![1].includes("'admin'") && sel![1].includes("'manager'") && sel![1].includes("'director'")).toBeTruthy();
  expect(sel![1].includes("'staff'") || sel![1].includes("'coordinator'"), 'audit SELECT 직원 비노출').toBeFalsy();
});

// ── AC5: opt-out 삭제 = soft-delete (hard-delete 아님) ───────────────────────
test('AC5 opt-out 삭제 = soft-delete UPDATE (.delete() 아님)', () => {
  // handleRemove 의 manual 경로가 .delete() 가 아니라 deleted_at 마킹 UPDATE
  const hr = ADMIN.match(/const handleRemove[\s\S]*?finally \{ setRemoving\(null\); \}/);
  expect(hr, 'handleRemove 존재').toBeTruthy();
  const body = hr![0];
  expect(body.includes('notification_opt_outs'), 'opt-out 테이블 대상').toBeTruthy();
  expect(/\.delete\(\)/.test(body), 'manual opt-out hard-delete(.delete()) 미사용').toBeFalsy();
  expect(body.includes('deleted_at') && body.includes('deleted_by'), 'soft-delete 마킹').toBeTruthy();
  // 읽기는 soft-deleted 제외
  expect(/notification_opt_outs[\s\S]{0,160}\.is\('deleted_at', null\)/.test(ADMIN), 'loadOptOuts deleted_at IS NULL 필터').toBeTruthy();
});

// ── AC6: opt-out RLS = partial-unique + DELETE 정책 없음 + clinic INVARIANT ──
test('AC6 opt-out 마이그 partial-unique / DELETE 제거 / clinic INVARIANT', () => {
  // soft-delete 컬럼 ADDITIVE
  for (const c of ['deleted_at', 'deleted_by', 'delete_reason']) {
    expect(OPTOUT_MIG.includes(c), `컬럼 ${c} 추가`).toBeTruthy();
  }
  // partial-unique
  expect(/CREATE UNIQUE INDEX[\s\S]*WHERE deleted_at IS NULL/i.test(OPTOUT_MIG), 'partial-unique(WHERE deleted_at IS NULL)').toBeTruthy();
  expect(OPTOUT_MIG.includes('DROP CONSTRAINT IF EXISTS uq_notif_optout_clinic_phone'), 'full-unique 제거').toBeTruthy();
  // notif_optout_write(FOR ALL) → INSERT + UPDATE 분리, DELETE 정책 없음
  expect(OPTOUT_MIG.includes('notif_optout_insert') && OPTOUT_MIG.includes('notif_optout_update'), 'insert/update 분리').toBeTruthy();
  expect(/FOR DELETE/i.test(OPTOUT_MIG), 'DELETE 정책 미생성').toBeFalsy();
  // clinic_id INVARIANT — USING+WITH CHECK 양쪽
  const usingCount = (OPTOUT_MIG.match(/clinic_id = public\.get_user_clinic_id\(\)/g) ?? []).length;
  expect(usingCount, 'clinic_id INVARIANT 다중 적용(USING+WITH CHECK)').toBeGreaterThanOrEqual(3);
});

// ── AC7: scope 가드 — rrn 영구제외 / send·Solapi 키 신설 0 / 롤백 동반 ──────
test('AC7 scope 가드 — rrn 제외 / 발송키 신설 0 / 롤백 동반', () => {
  // rrn export 영구 제외 — CSV/엑셀 헤더 배열에 주민번호 컬럼('주민번호' 따옴표 항목) 부재.
  //   (주석에 '주민번호(rrn) 평문 미포함' 문구는 있을 수 있으므로 헤더 항목만 판정.)
  expect(/'주민번호'/.test(CUSTEXPORT), '엑셀 헤더에 주민번호 컬럼 없음').toBeFalsy();
  expect(/'주민번호'/.test(CUSTCSV), 'CSV 헤더에 주민번호 컬럼 없음').toBeFalsy();
  // send/Solapi 키 신설 0 — 본 마이그에 발송 자격증명 컬럼/토큰 신설 없음.
  //   (주석에 'Solapi' 단어는 등장하므로 실제 자격증명 토큰 패턴만 판정.)
  for (const f of [AUDIT_MIG, OPTOUT_MIG]) {
    expect(/api_key|api_secret|access_token|client_secret/i.test(f), '마이그에 발송키/자격증명 신설 없음').toBeFalsy();
  }
  // 롤백 SQL 동반 (C2/C4)
  expect(AUDIT_RB.includes('DROP TABLE IF EXISTS public.customer_export_audit'), 'audit 롤백').toBeTruthy();
  expect(OPTOUT_RB.includes('uq_notif_optout_clinic_phone') && OPTOUT_RB.includes('UNIQUE'), 'opt-out 롤백 = full-unique 재생성').toBeTruthy();
  // 마이그/롤백 페어 존재
  const files = readdirSync(join(ROOT, MIG_DIR));
  expect(files.includes('20260701030000_customer_export_audit.rollback.sql')).toBeTruthy();
  expect(files.includes('20260701031000_optout_soft_delete_legal_guard.rollback.sql')).toBeTruthy();
});
