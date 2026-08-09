/**
 * E2E spec — T-20260808-foot-RXHIST-HIDE-SOFTDELETE
 * 처방이력 탭(RxHistorySection) 개별 처방 건 숨김(soft-delete).
 *
 * 요청(김주연 총괄): "처방이력에서 삭제할 수 있게 기능 추가해줘"
 *   총괄 확정 스펙: 삭제방식 = B.숨김(soft-delete, DB 유지·목록 미표시) / 권한 = A.누구나(모든 스태프).
 *   ※ 이 티켓은 MQ 로 온 T-20260808-foot-RXHIST-DELETE-CAPABILITY 의 canonical 승격본(동일 요청 통합).
 *
 * ★ AC-0 census 결과(db_change=false): 기존 form_submissions soft-delete 인프라 전량 재사용.
 *   deleted_at(단일 authority)/deleted_by/delete_reason/is_deleted(GENERATED) + trg_form_submissions_body_audit
 *   (§22 감사 자동적재, NULL→NOT NULL 전이=operation DELETE·changed_by=auth.uid()) = 이미 배포
 *   (20260802150000_foot_form_submissions_softdelete_audit.sql). 신규 컬럼/마이그/DA CONSULT 불요.
 *   rx_standard=status 'printed'(published 아님) → immutable guard 무저촉 + update RLS(clinic 활성 스태프) 통과.
 *
 * 검증(현장 클릭 시나리오 → AC):
 *   [순수 함수] dedupeRxIssuanceRows member_ids — 재출력 sibling 전량 수집(숨김 시 되살아남 방지, AC-2 영속).
 *   [정적 소스] AC-1 숨기기 버튼 / AC-2 read is_deleted=false 유지 / AC-3 role 게이트 없음(모든 스태프) /
 *              AC-4 감사(deleted_by/at·트리거) / AC-5 확인 다이얼로그(오클릭) / soft-delete only(hard-DELETE 0·원장 무접촉).
 *
 * 스타일: 형제 RXHIST 스펙(BARTOVEN/RESULT-COUNT) 동일 — 순수 함수 단언 + 소스 정적 가드. auth/DB/page 불요.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  dedupeRxIssuanceRows,
  type RxIssuancePatientRow,
} from '../../src/lib/rxIssuanceHistory';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');

// ── 테스트 픽스처 ────────────────────────────────────────────────────────────
function row(over: Partial<RxIssuancePatientRow> & { id: string }): RxIssuancePatientRow {
  return {
    id: over.id,
    issued_at: over.issued_at ?? '2026-08-01',
    prescriber_name: over.prescriber_name ?? '문지은',
    diagnosis: over.diagnosis ?? null,
    issue_no: over.issue_no ?? null,
    medications: over.medications ?? ['테르비나핀'],
    customer_id: over.customer_id ?? 'cust-1',
    patient_name: over.patient_name ?? '홍길동',
    chart_number: over.chart_number ?? 'F-0001',
  };
}

// ── [순수 함수] member_ids — 숨김 대상 = 대표 + 병합 sibling 전량 ────────────────
test.describe('dedupeRxIssuanceRows member_ids (AC-2 영속 숨김 근거)', () => {
  test('동일 교부번호 재출력 3건 → 1 대표행 + member_ids 3개 전량 수집', () => {
    const rows = [
      row({ id: 'fs-1', issue_no: 'RX-100' }),
      row({ id: 'fs-2', issue_no: 'RX-100' }), // 재출력
      row({ id: 'fs-3', issue_no: 'RX-100' }), // 재출력
    ];
    const deduped = dedupeRxIssuanceRows(rows);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].dup_count).toBe(3);
    // ★핵심: 숨김은 member_ids 전량을 soft-delete 해야 sibling 이 refetch 후 되살아나지 않음.
    expect(deduped[0].member_ids.sort()).toEqual(['fs-1', 'fs-2', 'fs-3']);
  });

  test('별개 교부번호 2건 → 2 행, 각 member_ids 단일(과병합 없음)', () => {
    const rows = [
      row({ id: 'fs-1', issue_no: 'RX-100' }),
      row({ id: 'fs-2', issue_no: 'RX-200' }),
    ];
    const deduped = dedupeRxIssuanceRows(rows);
    expect(deduped).toHaveLength(2);
    for (const d of deduped) expect(d.member_ids).toHaveLength(1);
  });

  test('초안(issue_no=NULL) 동일 교부일·약품집합 → 폴백 병합 member_ids 수집', () => {
    const rows = [
      row({ id: 'fs-1', issue_no: null, issued_at: '2026-08-02', medications: ['A', 'B'] }),
      row({ id: 'fs-2', issue_no: null, issued_at: '2026-08-02', medications: ['B', 'A'] }),
    ];
    const deduped = dedupeRxIssuanceRows(rows);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].member_ids.sort()).toEqual(['fs-1', 'fs-2']);
  });
});

// ── [정적 소스] RxHistorySection.tsx 배선 가드 ────────────────────────────────
test.describe('RxHistorySection 숨김 배선 (정적 소스 가드)', () => {
  const SEC = () => SRC('components/treatment/RxHistorySection.tsx');

  test('AC-1: 각 행 숨기기 버튼 존재 + 확인 다이얼로그 트리거', () => {
    const s = SEC();
    expect(s).toContain('data-testid="rx-history-hide-btn"');
    // 버튼 클릭 → 즉시 삭제 아님, hideTarget 세팅(다이얼로그 오픈)
    expect(s).toMatch(/setHideTarget\(r\)/);
    // 행 펼침(toggle) 충돌 방지
    expect(s).toMatch(/e\.stopPropagation\(\)/);
  });

  test('AC-5: 확인 다이얼로그(오클릭 방지) — 숨기기/취소 버튼', () => {
    const s = SEC();
    expect(s).toContain('data-testid="rx-history-hide-dialog"');
    expect(s).toContain('data-testid="rx-history-hide-confirm"');
    expect(s).toContain('data-testid="rx-history-hide-cancel"');
    // 취소 → hideTarget 해제(무변경)
    expect(s).toMatch(/setHideTarget\(null\)/);
  });

  test('soft-delete only: deleted_at/deleted_by UPDATE (물리 DELETE·원장 무접촉)', () => {
    const s = SEC();
    // deleted_at + deleted_by 마킹 UPDATE
    expect(s).toMatch(/\.update\(\{[\s\S]*deleted_at:[\s\S]*deleted_by:[\s\S]*\}\)/);
    expect(s).toContain('deleted_by: profile?.id');
    // 대상 = member_ids 전량(sibling 포함)
    expect(s).toMatch(/hideMutation\.mutate\(hideTarget\.member_ids\)/);
    expect(s).toMatch(/\.in\('id', ids\)/);
    // ★hard-DELETE 금지 — form_submissions 물리 삭제 호출 없음.
    expect(s).not.toMatch(/from\('form_submissions'\)[\s\S]{0,80}\.delete\(\)/);
    // ★원장(payments/service_charges) 무접촉 — 해당 테이블 supabase 접근 호출 없음(주석 언급은 허용).
    expect(s).not.toMatch(/from\('payments'\)/);
    expect(s).not.toMatch(/from\('service_charges'\)/);
  });

  test('AC-4 감사: deleted_by 기록 + DB 트리거 감사 언급(누가·언제)', () => {
    const s = SEC();
    expect(s).toContain('deleted_by');
    // 감사 자동적재 트리거 근거 주석(진실원천=audit_log)
    expect(s).toContain('form_submissions_audit_log');
  });

  test('cross-CRM write rowcheck: 반영 0행 사일런트 성공 오인 차단', () => {
    const s = SEC();
    // .select() 로 affected 검증 + 0행 throw
    expect(s).toMatch(/\.select\('id'\)/);
    expect(s).toMatch(/affected === 0/);
  });

  test('숨김 성공 후 목록 무효화(즉시 반영·refetch)', () => {
    const s = SEC();
    expect(s).toMatch(/invalidateQueries\(\{ queryKey: \['rx_issuance_history_bydrug'\] \}\)/);
  });

  test('AC-2: 기본 조회 read-side is_deleted=false 필터 유지(숨긴 건 미표시·영속)', () => {
    const s = SEC();
    expect(s).toMatch(/\.eq\('is_deleted', false\)/);
  });

  test('AC-3: role 게이트 없음(모든 스태프 숨김 가능, 총괄 확정 Q2=A)', () => {
    const s = SEC();
    // 버튼/뮤테이션에 admin/manager/director role 조건 게이트가 걸려있지 않아야 함.
    expect(s).not.toMatch(/rx-history-hide-btn[\s\S]{0,400}role\s*===\s*['"](admin|manager|director)['"]/);
  });
});
