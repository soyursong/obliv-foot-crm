/**
 * E2E Spec — T-20260731-foot-FIRSTVISIT-MGMTRECORD-CONTENT-SAVE-PERSIST
 *
 * 초진 관리기록지 작성 내용 '저장(draft·재편집)/발행(published·공식 불변 이력)' 2계층 신설.
 * DA CONSULT-REPLY(20260731, 후보 B GO): draft 1행(재편집) + published N행(누적, 불변). 단일수렴 앵커 = check_in_id.
 *
 * 검증(정적 계약 단위 — 실서버/auth 불필요, 결정론):
 *  - AC-1/5: 초진 관리기록지 발급 팝업에 [저장]/[발행] 버튼 노출 + form_key 게이트(다른 서류 무영향, 회귀0).
 *  - AC-2:   [저장] = form_submissions status='draft' UPSERT(영속). 발행 = publish RPC(published 스냅샷).
 *  - AC-3:   재조회 — 기존 draft 로드 → 폼 상태 복원 effect 존재(빈 폼 초기화 방지).
 *  - CATCH1: status='signed' 오버로드 금지 — 저장/발행 경로에 'signed' 미사용(draft/published만).
 *  - CATCH2: 발행 게이트 = is_approved_user()(비의료 작성 서류) — is_doctor_role() 금지.
 *  - AC-6:   사진 무접점 — 본 마이그 신규 사진 DDL 0(form_submission_photos 미생성, treatment_photos 무변경).
 *  - MIG:    ADDITIVE — source_submission_id FK ON DELETE SET NULL. draft-dedup 전역 인덱스=DEFERRED
 *            (prod cross-feature dup draft[opinion_doc·orphan] 선행 dedup 필요) → FE(SELECT→INSERT)로 유일성 보장.
 *
 * 실행: npx playwright test T-20260731-foot-FIRSTVISIT-MGMTRECORD-CONTENT-SAVE-PERSIST.spec.ts
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const MIG = readFileSync(
  join(ROOT, 'supabase/migrations/20260731210000_foot_fvmr_content_draft_publish.sql'),
  'utf8',
);
const PANEL = readFileSync(join(ROOT, 'src/components/DocumentPrintPanel.tsx'), 'utf8');

// ── AC-1/5: [저장]/[발행] 버튼 + form_key 게이트 ──
test('AC-1: 초진 관리기록지 팝업에 [저장]/[발행] 버튼(data-testid) 노출', () => {
  expect(PANEL).toContain('data-testid="fvmr-save-draft"');
  expect(PANEL).toContain('data-testid="fvmr-publish"');
});

test('AC-5(회귀0): 저장/발행 UI가 first_visit_mgmt_record 로 게이트 — 다른 서류 무영향', () => {
  // 버튼 블록이 form_key 게이트 안에 있어야(다른 서류엔 미노출).
  const btnIdx = PANEL.indexOf('data-testid="fvmr-save-draft"');
  const gateIdx = PANEL.lastIndexOf("template.form_key === 'first_visit_mgmt_record'", btnIdx);
  expect(gateIdx).toBeGreaterThan(-1);
  expect(btnIdx - gateIdx).toBeLessThan(1200); // 게이트 직후 버튼 블록
});

// ── AC-2: 저장=draft 영속 / 발행=publish RPC ──
test('AC-2: [저장]은 status=draft 로 form_submissions 영속(UPSERT)', () => {
  expect(PANEL).toContain('const handleSaveDraft');
  expect(PANEL).toMatch(/status:\s*'draft'/);
  expect(PANEL).toContain("from('form_submissions')");
});

test('AC-2: [발행]은 publish_first_visit_mgmt_record RPC(published 스냅샷) 호출', () => {
  expect(PANEL).toContain('const handlePublishRecord');
  expect(PANEL).toContain("supabase.rpc('publish_first_visit_mgmt_record'");
  expect(PANEL).toContain('p_check_in_id');
  expect(PANEL).toContain('p_source_submission_id');
});

// ── AC-3: 재조회 — draft 로드/복원 ──
test('AC-3: 기존 draft 로드 → 폼 상태 복원(재조회, 빈 폼 초기화 방지)', () => {
  expect(PANEL).toContain('fvmrDraftId');
  // draft 조회 + _fvmr 스냅샷 복원
  expect(PANEL).toContain("eq('status', 'draft')");
  expect(PANEL).toContain('_fvmr');
  expect(PANEL).toContain('setManualValues((prev) => ({ ...prev, ...fvmr.manual }))');
});

// ── CATCH1: signed 오버로드 금지 ──
test('CATCH1: 저장/발행 FE 경로에 status=signed 오버로드 미사용', () => {
  // 초진 관리기록지 저장/발행 헬퍼 범위에 'signed' 상태 미등장(draft/published 만).
  const saveIdx = PANEL.indexOf('const handleSaveDraft');
  const pubEnd = PANEL.indexOf('const meta = FORM_META', saveIdx);
  const region = PANEL.slice(saveIdx, pubEnd);
  expect(region).not.toContain("'signed'");
  // 마이그도 CATCH1 가드(RPC 본문 signed 미등장 검증 DO 블록 포함).
  expect(MIG).toContain('CATCH1');
});

// ── CATCH2: 비의료 게이트(is_approved_user), 의사게이트 금지 ──
test('CATCH2: publish RPC 게이트 = is_approved_user() (is_doctor_role 금지)', () => {
  expect(MIG).toContain('is_approved_user()');
  // publish 함수 본문에 is_doctor_role 게이트가 없어야(비의료 작성 서류).
  const fnIdx = MIG.indexOf('FUNCTION public.publish_first_visit_mgmt_record');
  const fnBody = MIG.slice(fnIdx, MIG.indexOf('$$;', fnIdx));
  expect(fnBody).toContain('is_approved_user()');
  expect(fnBody).not.toContain('is_doctor_role()');
});

// ── AC-6: 사진 무접점 ──
test('AC-6: 본 마이그 신규 사진 DDL 0 — form_submission_photos 미생성', () => {
  expect(MIG).not.toContain('form_submission_photos');
  expect(MIG).not.toMatch(/CREATE\s+TABLE[^;]*photo/i);
  // 사진 authoritative=treatment_photos(check_in 앵커) — field_data 에 사진 미주입.
  const payloadIdx = PANEL.indexOf('const buildFvmrPayload');
  const payloadEnd = PANEL.indexOf('});', payloadIdx);
  expect(PANEL.slice(payloadIdx, payloadEnd)).not.toMatch(/photo/i);
});

// ── MIG: ADDITIVE 계약 ──
test('MIG: source_submission_id nullable FK ON DELETE SET NULL', () => {
  expect(MIG).toMatch(/ADD COLUMN IF NOT EXISTS source_submission_id uuid/);
  expect(MIG).toContain('ON DELETE SET NULL');
});

test('MIG: draft-dedup 전역 인덱스는 DEFERRED — 본 마이그 미생성(cross-feature dedup 선행)', () => {
  // prod에 타 기능(opinion_doc)·orphan 중복 draft 존재 → 전역 unique index 즉시 생성 불가.
  expect(MIG).not.toContain('CREATE UNIQUE INDEX IF NOT EXISTS form_submissions_draft_dedup_uidx');
  expect(MIG).toContain('DEFERRED');
});

test('FE: 초진 관리기록지 draft 유일성 = 저장 전 기존 draft SELECT→UPDATE, else INSERT(인덱스 부재 보완)', () => {
  const saveIdx = PANEL.indexOf('const handleSaveDraft');
  const region = PANEL.slice(saveIdx, PANEL.indexOf('const handlePublishRecord', saveIdx));
  // 기존 draft 조회 후 있으면 UPDATE(재편집), 없으면 INSERT.
  expect(region).toContain("eq('status', 'draft')");
  expect(region).toMatch(/\.update\(\{ field_data: payload \}\)/);
  expect(region).toMatch(/status:\s*'draft'/);
  // 중복 클릭 가드(fvmrBusy).
  expect(PANEL).toContain('fvmrBusy');
});

test('MIG: published 불변 트리거는 재사용(신규 생성/DROP 아님 — 기존 방어막 의존)', () => {
  // 트리거를 새로 CREATE 하지 않고 존재만 재확인(의존 전제).
  expect(MIG).not.toContain('CREATE TRIGGER');
  expect(MIG).toContain('trg_form_submissions_published_immutable');
});
