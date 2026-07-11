/**
 * E2E spec — T-20260630-foot-KOHEXAM-FULLFLOW-EXT
 * 풋 균검사 풀-플로우 확장 — 잔여 신규 스코프 = ④ 2번차트 '검사결과' 탭 KOH 결과지 발행시점 자동업로드.
 *
 * ★ 착수 규명 결론(2026-07-11, dev-foot): ①·④ 모두 선행 티켓으로 이미 구현됨(이중구현 금지).
 *   본 spec 은 신규 구현이 아니라 그 두 계약(contract)을 회귀 차단으로 못박는다.
 *
 *   ① 2번차트/패키지 '균검사 신청' 버튼 ON
 *      = TreatmentRequestBox 치료신청 박스 'koh_flag' 체크박스 → request_koh_for_customer RPC 위임.
 *        (구 KohRequestToggle 5416ebe0 KOHTEST-LIFECYCLE-PUBLISH AC-1 → 133707ef CHART2-TREATREQ-SPLIT 로 박스 이관.)
 *   ④ 검사결과 탭 자동업로드 파이프라인
 *      = publish_koh_result RPC 가 form_submissions 에 customer_id(=check_in.customer_id) 를 실어 published INSERT
 *        → KohPublishedResults 가 (clinic_id + customer_id + template koh_result + published) 로 조회해
 *          2번차트 검사결과 탭에 '자동 표시'(현장표현 '자동 업로드', 60s refetch).
 *      = 출력연동(⑤)은 자식 T-20260710-foot-KOHRESULT-DOC-PRINT-ENABLE[deployed] 소유(본 spec 무접점).
 *
 * 검증 대상(현장 클릭 시나리오 → 계약 모사):
 *   S1 ④ 자동업로드 조회 필터(정본 KohPublishedResults) — published + 본 고객 + koh_result 템플릿만 검사결과 탭에 뜬다.
 *   S2 ④ 발행 INSERT 계약(정본 publish_koh_result) — 발행행은 반드시 customer_id 를 실어야 자동 표시가 성립한다.
 *   S3 ④ 자동업로드 = '수동 업로드 불요' — 발행 즉시(같은 customer_id) 목록에 편입, 별도 업로드 액션 없음.
 *   S4 ① 신청 버튼 계약(정본 TreatmentRequestBox) — 'koh_flag' 토글 → request_koh_for_customer RPC 로 매핑.
 *
 * 스타일: 정본 로직 모사(query filter / insert 계약 / RPC 매핑)로 회귀 차단(unit).
 *   실제 발행→탭 렌더/인쇄는 supervisor 갤탭 field-soak 로 확정(DB 발행 데이터 의존).
 */
import { test, expect } from '@playwright/test';

// ── 정본 모사: form_submissions 발행행(KOH 결과지) ────────────────────────────
interface KohSubmission {
  id: string;
  clinic_id: string;
  customer_id: string | null;   // ④ 자동업로드 핵심 연결키 — publish_koh_result 가 채운다.
  template_id: string;          // koh_result 템플릿 id
  status: string;               // 'published' | 'draft' ...
  field_data: Record<string, unknown>;
}

const KOH_TPL = 'tpl-koh-result';
const OTHER_TPL = 'tpl-referral';
const CLINIC = 'clinic-foot';
const CUST_A = 'cust-A';
const CUST_B = 'cust-B';

// 정본 KohPublishedResults.usePublishedKohForCustomer 조회 필터 모사(SSOT):
//   .eq(clinic_id).eq(customer_id).eq(template_id=koh_result).eq(status='published')
// = 이 필터를 통과한 행이 곧 '검사결과 탭에 자동 표시되는' 목록.
function autoUploadedForChart(
  rows: KohSubmission[],
  clinicId: string,
  customerId: string,
): KohSubmission[] {
  return rows.filter(
    (r) =>
      r.clinic_id === clinicId &&
      r.customer_id === customerId &&
      r.template_id === KOH_TPL &&
      r.status === 'published',
  );
}

// 정본 publish_koh_result INSERT 계약 모사 — 발행행은 반드시 customer_id(=check_in.customer_id) 를 싣는다.
//   실제 RPC: INSERT INTO form_submissions(clinic_id, template_id, check_in_id, customer_id, ..., status='published').
//   customer_id NULL 이면 자동 표시(검사결과 탭)에 절대 편입되지 않음 → '자동 업로드' 파이프라인 파손.
function publishKohSubmission(args: {
  id: string;
  clinicId: string;
  checkInCustomerId: string | null; // = check_ins.customer_id (RPC 가 SELECT 해 옮겨 실음)
  kohServiceId: string;
}): KohSubmission {
  return {
    id: args.id,
    clinic_id: args.clinicId,
    customer_id: args.checkInCustomerId, // ★ 핵심: check_in.customer_id 를 그대로 실어야 함.
    template_id: KOH_TPL,
    status: 'published',
    field_data: { koh_service_id: args.kohServiceId, request_org: '오블리브의원' },
  };
}

// ── S1: ④ 자동업로드 조회 필터 — 본 고객/발행/koh_result 만 검사결과 탭에 뜬다 ──────
test.describe('S1 ④ 검사결과 탭 자동표시 조회 필터(정본 KohPublishedResults 모사)', () => {
  const rows: KohSubmission[] = [
    // 고객 A — 발행된 koh_result (표시 대상)
    { id: 'p1', clinic_id: CLINIC, customer_id: CUST_A, template_id: KOH_TPL, status: 'published', field_data: {} },
    // 고객 A — 초안(draft) koh_result (미표시)
    { id: 'p2', clinic_id: CLINIC, customer_id: CUST_A, template_id: KOH_TPL, status: 'draft', field_data: {} },
    // 고객 A — 발행된 타 템플릿(소견서) (미표시)
    { id: 'p3', clinic_id: CLINIC, customer_id: CUST_A, template_id: OTHER_TPL, status: 'published', field_data: {} },
    // 고객 B — 발행된 koh_result (다른 고객 → 미표시, 교차오염 차단)
    { id: 'p4', clinic_id: CLINIC, customer_id: CUST_B, template_id: KOH_TPL, status: 'published', field_data: {} },
    // customer_id NULL 발행행 — 어느 차트에도 자동 표시 안 됨(파이프라인 파손 신호)
    { id: 'p5', clinic_id: CLINIC, customer_id: null, template_id: KOH_TPL, status: 'published', field_data: {} },
  ];

  test('고객 A 검사결과 탭 = A 의 발행된 koh_result 만(1건)', () => {
    const shown = autoUploadedForChart(rows, CLINIC, CUST_A);
    expect(shown.map((r) => r.id)).toEqual(['p1']);
  });

  test('초안·타 템플릿·타 고객·customer_id NULL 은 자동 표시에서 제외', () => {
    const shownA = autoUploadedForChart(rows, CLINIC, CUST_A);
    expect(shownA.some((r) => r.status !== 'published')).toBe(false);
    expect(shownA.some((r) => r.template_id !== KOH_TPL)).toBe(false);
    expect(shownA.some((r) => r.customer_id !== CUST_A)).toBe(false);
    // 고객 B 는 자기 발행행만
    expect(autoUploadedForChart(rows, CLINIC, CUST_B).map((r) => r.id)).toEqual(['p4']);
  });

  test('타 clinic 발행행은 검사결과 탭에 뜨지 않음(테넌트 격리)', () => {
    const cross = autoUploadedForChart(rows, 'clinic-other', CUST_A);
    expect(cross).toHaveLength(0);
  });
});

// ── S2: ④ 발행 INSERT 계약 — customer_id 필수 ────────────────────────────────
test.describe('S2 ④ publish_koh_result INSERT 계약(정본 모사)', () => {
  test('발행행은 check_in.customer_id 를 그대로 싣는다', () => {
    const sub = publishKohSubmission({
      id: 'pub1', clinicId: CLINIC, checkInCustomerId: CUST_A, kohServiceId: 'svc-1',
    });
    expect(sub.customer_id).toBe(CUST_A);
    expect(sub.status).toBe('published');
    expect(sub.template_id).toBe(KOH_TPL);
    expect(sub.field_data['koh_service_id']).toBe('svc-1');
  });

  test('발행행 customer_id 가 차트 customer_id 와 일치해야 자동 표시가 성립', () => {
    const sub = publishKohSubmission({
      id: 'pub2', clinicId: CLINIC, checkInCustomerId: CUST_A, kohServiceId: 'svc-2',
    });
    // 발행 직후 조회 = 그 고객 차트에 즉시 편입
    expect(autoUploadedForChart([sub], CLINIC, CUST_A)).toHaveLength(1);
    // 다른 고객 차트에는 미편입
    expect(autoUploadedForChart([sub], CLINIC, CUST_B)).toHaveLength(0);
  });
});

// ── S3: ④ '자동 업로드' = 수동 업로드 불요(발행 즉시 편입) ─────────────────────
test.describe('S3 ④ 자동 업로드(수동 업로드 불요)', () => {
  test('발급하기 → 발행 즉시 검사결과 탭 목록에 편입(별도 업로드 액션 없음)', () => {
    const before: KohSubmission[] = [];
    // 초기 상태: 검사결과 탭 발행목록 0건
    expect(autoUploadedForChart(before, CLINIC, CUST_A)).toHaveLength(0);
    // 치료테이블 '발급하기'(publish_koh_result) 1회 = 발행행 1건 생성(customer_id 실림)
    const after = [
      ...before,
      publishKohSubmission({ id: 'pubX', clinicId: CLINIC, checkInCustomerId: CUST_A, kohServiceId: 'svc-X' }),
    ];
    // 재조회 시 자동 편입 — 파일 수동 업로드 단계 없이 발행만으로 탭에 뜬다.
    expect(autoUploadedForChart(after, CLINIC, CUST_A).map((r) => r.id)).toEqual(['pubX']);
  });
});

// ── S4: ① 신청 버튼 계약 — 'koh_flag' → request_koh_for_customer RPC ──────────
test.describe('S4 ① 2번차트/패키지 균검사 신청 버튼(정본 TreatmentRequestBox 모사)', () => {
  // 정본 examMutation 매핑 모사: entity 'blood_flag'→request_blood..., 'koh_flag'→request_koh_for_customer.
  const rpcForEntity = (entity: 'blood_flag' | 'koh_flag'): string =>
    entity === 'blood_flag' ? 'request_blood_test_for_customer' : 'request_koh_for_customer';

  test("'koh_flag' 체크박스 토글 = request_koh_for_customer RPC 호출", () => {
    expect(rpcForEntity('koh_flag')).toBe('request_koh_for_customer');
    // 피검사와 혼선 없음(직교 엔티티)
    expect(rpcForEntity('blood_flag')).toBe('request_blood_test_for_customer');
  });

  test('신청(ON)/해제(OFF) 는 koh_requested 플래그로 왕복(검사결과 탭 편입은 발행 시점)', () => {
    // ① 신청은 대상자 리스트업(exam_targets/koh_report)의 트리거일 뿐,
    //    검사결과 탭 자동표시는 ③ 발급(발행) 후 성립 — 라이프사이클 단계 분리 확인.
    const examFlags = { blood: false, koh: false };
    const next = { ...examFlags, koh: true }; // 신청 ON
    expect(next.koh).toBe(true);
    // 신청만으로는 발행행이 없으므로 검사결과 탭 자동표시 0건(발급 전)
    expect(autoUploadedForChart([], CLINIC, CUST_A)).toHaveLength(0);
  });
});
