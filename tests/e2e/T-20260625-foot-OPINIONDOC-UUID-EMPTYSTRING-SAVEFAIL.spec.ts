/**
 * E2E spec — T-20260625-foot-OPINIONDOC-UUID-EMPTYSTRING-SAVEFAIL
 *
 * 현장(문지은 대표원장, C0ATE5P6JTH 2026-06-25 10:48):
 *   "소견서 발급하면 저장이 안 돼." → 에러 `invalid input syntax for type uuid: ""`.
 *
 * AC-0 (RC 특정, 파일:라인 근거):
 *   - 발행 RPC = publish_opinion_doc(p_check_in_id uuid, p_field_data jsonb)
 *     (supabase/migrations/20260616160000_opinion_doc_form_stack.sql:173). p_check_in_id 는 NOT NULL uuid 필수
 *     (line 199~205: 내방 미발견 시 RAISE). issued_by_doctor_id 는 JSONB(v_field)에 저장 — uuid 캐스팅 없음,
 *     issued_by 는 서버에서 resolve. → '' uuid 캐스팅 실패 surface 는 p_check_in_id 단 하나.
 *   - '' 유입원 = DocRequestQueue.tsx:58 `id: active.checkInId ?? ''`. 데스크 서류요청 큐에서 check_in 없는 환자
 *     요청을 '작성하기'로 열면 visitor.id='' → handlePublish → checkInId='' → p_check_in_id:'' → uuid 캐스팅 실패.
 *
 * AC-2 (필수 FK 차단): p_check_in_id 는 필수(null 정규화 대상 아님). visitor.id 가 빈 값이면
 *   RPC 호출 전 handlePublish 에서 발급 차단 + 안내 toast('내방(체크인) 기록이 없어 발행할 수 없습니다…').
 * AC-3: 정상 동선(실 check_in uuid)은 가드 통과 → 발행 진행. 빈 UUID 엣지는 가드 차단(uuid 에러 미발생).
 * AC-4 (회귀가드): DOCGEN-CONTRAIND-COMBINE(조합엔진 composeOpinionDoc) / DOCFORM-POPUP-OVERHAUL(OpinionEditorDialog
 *   export 진입점) 작업물 회귀 0 — 마커 존속 단언.
 *
 * 정적 소스 단언(데이터/로그인 비의존)으로 회귀 가드. db_change:false (FE 입력검증만).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const OPINIONTAB = 'src/components/doctor/OpinionDocTab.tsx';
const DOCQUEUE = 'src/components/doctor/DocRequestQueue.tsx';
const RPC_MIG = 'supabase/migrations/20260616160000_opinion_doc_form_stack.sql';

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: 빈 UUID(check_in_id) → 발행 차단 + 안내 (필수 FK, null 정규화 아님)
// ─────────────────────────────────────────────────────────────────────────────
test('AC2-1: handlePublish 가 빈 visitor.id 를 RPC 호출 전 차단한다', () => {
  const src = read(OPINIONTAB);
  // 가드 존재: visitor.id 빈 값(또는 공백) 검사
  expect(src).toMatch(/if \(!visitor\.id \|\| !visitor\.id\.trim\(\)\)/);
  // 차단 안내 메시지(현장 친화 — 개발용어 없음)
  expect(src).toContain('내방(체크인) 기록이 없어 발행할 수 없습니다');
});

test('AC2-2: 빈 UUID 가드는 publish RPC(publishMut.mutateAsync) 호출보다 앞선다(차단 우선)', () => {
  const src = read(OPINIONTAB);
  const guardIdx = src.indexOf('내방(체크인) 기록이 없어 발행할 수 없습니다');
  const mutateIdx = src.indexOf('publishMut.mutateAsync');
  expect(guardIdx).toBeGreaterThan(0);
  expect(mutateIdx).toBeGreaterThan(0);
  expect(guardIdx).toBeLessThan(mutateIdx); // 가드가 먼저
});

test('AC2-3: 가드는 ticket RC 주석으로 출처를 남긴다(회귀 추적)', () => {
  const src = read(OPINIONTAB);
  expect(src).toContain('T-20260625-foot-OPINIONDOC-UUID-EMPTYSTRING-SAVEFAIL');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-0/AC-1: RC surface 단언 — p_check_in_id 는 uuid 필수, '' 유입원은 큐
// ─────────────────────────────────────────────────────────────────────────────
test('AC0-1: RPC publish_opinion_doc 의 p_check_in_id 는 uuid 필수 파라미터', () => {
  const mig = read(RPC_MIG);
  expect(mig).toContain('publish_opinion_doc(p_check_in_id uuid');
});

test('AC0-2: 발행 호출은 checkInId 로 visitor.id 를 RPC p_check_in_id 에 직결한다(캐스팅 surface)', () => {
  const src = read(OPINIONTAB);
  expect(src).toContain('p_check_in_id: input.checkInId');
  expect(src).toMatch(/checkInId: visitor\.id/);
});

test('AC0-3: 큐는 checkInId 없으면 visitor.id 를 빈 문자열로 구성(가드가 후속 차단) — RC 유입원 명시', () => {
  const src = read(DOCQUEUE);
  expect(src).toMatch(/id: active\.checkInId \?\? ''/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4 회귀가드: 형제 in_progress 작업물 마커 존속 (회귀 0)
// ─────────────────────────────────────────────────────────────────────────────
test('AC4-1: DOCGEN-CONTRAIND-COMBINE 조합엔진(composeOpinionDoc) 와이어링 존속', () => {
  const src = read(OPINIONTAB);
  expect(src).toContain('composeOpinionDoc');
  expect(src).toContain('T-20260623-foot-DOCGEN-CONTRAIND-COMBINE');
});

test('AC4-2: DOCFORM-POPUP-OVERHAUL 진입점(OpinionEditorDialog export) 존속', () => {
  const src = read(OPINIONTAB);
  expect(src).toContain('export function OpinionEditorDialog');
  expect(src).toContain('T-20260617-foot-DOCFORM-POPUP-OVERHAUL');
});

test('AC4-3: 기존 환자정보 가드(customer_id) 는 보존 — 신규 가드는 그 다음에 얹힘', () => {
  const src = read(OPINIONTAB);
  const custGuard = src.indexOf('환자 정보를 확인할 수 없어 발행할 수 없습니다');
  const newGuard = src.indexOf('내방(체크인) 기록이 없어 발행할 수 없습니다');
  expect(custGuard).toBeGreaterThan(0);
  expect(newGuard).toBeGreaterThan(custGuard); // 기존 가드 보존 + 신규 가드 후행
});
