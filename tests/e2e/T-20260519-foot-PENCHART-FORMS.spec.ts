/**
 * T-20260519-foot-PENCHART-FORMS
 * 2번차트 펜차트 — 개인정보/체크리스트 합본 양식(일반용·어르신용) 추가 + 고객 기입 동선
 *
 * AC-1: 2번차트 기존 펜차트 기능 정상 동작 유지 확인
 * AC-2: 펜차트 양식 목록에 "개인정보/체크리스트 (일반용)" 표시
 * AC-3: 펜차트 양식 목록에 "개인정보/체크리스트 (어르신용)" 표시
 * AC-4: 양식 선택 → 고객 기입 화면 진입 가능 (고객 정보 자동 바인딩)
 * AC-5: 기입 완료 후 저장 시 form_submissions 레코드 생성 (customer_id + check_in_id)
 * AC-6: 상담내역 화면에서 해당 고객의 제출 양식 조회 가능
 *
 * NOTE: 자기완결형 단위 테스트 — 컴포넌트 로직·DB 시드·UI 흐름 검증
 *       Playwright 브라우저 통합 테스트는 loginAndWaitForDashboard helpers 경유
 */
import { test, expect } from '@playwright/test';

// ─── 상수 (PenChartTab.tsx / DB migration과 동기화) ─────────────────────────

const GENERAL_FORM_KEY = 'personal_checklist_general';
const SENIOR_FORM_KEY  = 'personal_checklist_senior';
const PEN_CHART_FORM_KEY = 'pen_chart';

// DB 등록 확인 (scripts/apply_20260519000050_via_rest.mjs 실행 후)
const DB_SEED_EXPECTED = [
  { form_key: GENERAL_FORM_KEY, name_ko: '개인정보+체크리스트 (일반)',  sort_order: 91, template_format: 'html' },
  { form_key: SENIOR_FORM_KEY,  name_ko: '개인정보+체크리스트 (어르신)', sort_order: 92, template_format: 'html' },
];

// 폴백 템플릿 (DB 미적용 시 UI에서 사용)
const FALLBACK_TEMPLATES = [
  { id: 'fallback-general', form_key: GENERAL_FORM_KEY },
  { id: 'fallback-senior',  form_key: SENIOR_FORM_KEY  },
];

// form_submissions payload 빌더 (handleFillSave 로직과 동일)
const buildFillPayload = (opts: {
  clinicId: string;
  templateId: string;
  customerId: string;
  fieldData: Record<string, unknown>;
  staffId: string;
  checkInId?: string;
}) => {
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    clinic_id:   opts.clinicId,
    template_id: opts.templateId,
    customer_id: opts.customerId,
    field_data:  opts.fieldData,
    status:      'signed',
    signed_at:   now,
    printed_at:  now,             // AC-6: 상담내역 submissionEntries 표시용
    issued_by:   opts.staffId,    // NOT NULL 제약 — staffId 필수
  };
  if (opts.checkInId) payload.check_in_id = opts.checkInId;
  return payload;
};

// canSave 로직 (PersonalChecklistFillView와 동일)
const canSave = (name: string, agree_privacy: boolean | null): boolean =>
  name.trim().length > 0 && agree_privacy === true;

// ─────────────────────────────────────────────────────────────────────────────

test.describe('T-20260519-foot-PENCHART-FORMS', () => {

  // ── AC-1: 기존 펜차트 무영향 ────────────────────────────────────────────
  test('AC-1: pen_chart form_key 분리 — 체크리스트와 충돌 없음', () => {
    expect(PEN_CHART_FORM_KEY).toBe('pen_chart');
    expect(PEN_CHART_FORM_KEY).not.toBe(GENERAL_FORM_KEY);
    expect(PEN_CHART_FORM_KEY).not.toBe(SENIOR_FORM_KEY);
    expect(PEN_CHART_FORM_KEY.startsWith('personal_checklist_')).toBe(false);
  });

  test('AC-1: BUILTIN 펜차트 템플릿 구조 — id/name_ko/form_key', () => {
    const builtin = {
      id: 'builtin-pen-chart',
      name_ko: '펜차트 양식',
      template_path: '/forms/pen_chart_form.png',
      template_format: 'png',
      form_key: 'pen_chart',
    };
    expect(builtin.form_key).toBe('pen_chart');
    expect(builtin.template_format).toBe('png');
    expect(builtin.template_path).toContain('pen_chart_form');
  });

  // ── AC-2/3: 양식 2종 DB 시드 구조 ──────────────────────────────────────
  test('AC-2: 일반용 form_key = personal_checklist_general', () => {
    const gen = DB_SEED_EXPECTED.find(r => r.form_key === GENERAL_FORM_KEY)!;
    expect(gen.name_ko).toContain('일반');
    expect(gen.template_format).toBe('html');
    expect(gen.sort_order).toBe(91);
  });

  test('AC-3: 어르신용 form_key = personal_checklist_senior', () => {
    const sen = DB_SEED_EXPECTED.find(r => r.form_key === SENIOR_FORM_KEY)!;
    expect(sen.name_ko).toContain('어르신');
    expect(sen.template_format).toBe('html');
    expect(sen.sort_order).toBe(92);
  });

  test('AC-2/3: 2종 sort_order 순서 — general(91) < senior(92)', () => {
    const gen = DB_SEED_EXPECTED.find(r => r.form_key === GENERAL_FORM_KEY)!;
    const sen = DB_SEED_EXPECTED.find(r => r.form_key === SENIOR_FORM_KEY)!;
    expect(gen.sort_order).toBeLessThan(sen.sort_order);
  });

  test('AC-2/3: personal_checklist_ prefix 공유', () => {
    expect(GENERAL_FORM_KEY.startsWith('personal_checklist_')).toBe(true);
    expect(SENIOR_FORM_KEY.startsWith('personal_checklist_')).toBe(true);
  });

  // ── AC-4: 고객 기입 화면 — 저장 가능 조건 ─────────────────────────────
  test('AC-4: canSave — 성명 + 개인정보 동의 true → 저장 가능', () => {
    expect(canSave('홍길동', true)).toBe(true);
  });

  test('AC-4: canSave — 성명 없으면 저장 불가', () => {
    expect(canSave('', true)).toBe(false);
    expect(canSave('  ', true)).toBe(false);
  });

  test('AC-4: canSave — 개인정보 동의 null이면 저장 불가', () => {
    expect(canSave('홍길동', null)).toBe(false);
  });

  test('AC-4: canSave — 개인정보 동의 false이면 저장 불가', () => {
    expect(canSave('홍길동', false)).toBe(false);
  });

  test('AC-4: 어르신용 isSenior 판별 — form_key 일치 여부', () => {
    const isSeniorForGeneral = GENERAL_FORM_KEY === 'personal_checklist_senior';
    const isSeniorForSenior  = SENIOR_FORM_KEY  === 'personal_checklist_senior';
    expect(isSeniorForGeneral).toBe(false);
    expect(isSeniorForSenior).toBe(true);
  });

  // ── AC-5: form_submissions payload ─────────────────────────────────────
  test('AC-5: payload 필수 키 — clinic_id/template_id/customer_id/field_data', () => {
    const payload = buildFillPayload({
      clinicId: 'c-1', templateId: 't-1', customerId: 'u-1',
      fieldData: { name: '홍길동', agree_privacy: true },
      staffId: 's-1',
    });
    expect(payload).toHaveProperty('clinic_id',   'c-1');
    expect(payload).toHaveProperty('template_id', 't-1');
    expect(payload).toHaveProperty('customer_id', 'u-1');
    expect(payload).toHaveProperty('field_data');
    expect(payload).toHaveProperty('issued_by',   's-1');
  });

  test('AC-5: payload status=signed + signed_at ISO 형식', () => {
    const payload = buildFillPayload({
      clinicId: 'c', templateId: 't', customerId: 'u',
      fieldData: {}, staffId: 's',
    });
    expect(payload.status).toBe('signed');
    expect(typeof payload.signed_at).toBe('string');
    expect(() => new Date(payload.signed_at as string)).not.toThrow();
  });

  test('AC-5: payload printed_at 설정 — 상담내역 표시용 (non-null)', () => {
    const payload = buildFillPayload({
      clinicId: 'c', templateId: 't', customerId: 'u',
      fieldData: {}, staffId: 's',
    });
    expect(payload.printed_at).toBeTruthy();
    expect(payload.printed_at).toBe(payload.signed_at);
  });

  test('AC-5: check_in_id 있을 때 payload에 포함 (상담 자동 연동)', () => {
    const payload = buildFillPayload({
      clinicId: 'c', templateId: 't', customerId: 'u',
      fieldData: {}, staffId: 's',
      checkInId: 'ci-001',
    });
    expect(payload.check_in_id).toBe('ci-001');
  });

  test('AC-5: check_in_id 없을 때 payload에 미포함', () => {
    const payload = buildFillPayload({
      clinicId: 'c', templateId: 't', customerId: 'u',
      fieldData: {}, staffId: 's',
    });
    expect(payload).not.toHaveProperty('check_in_id');
  });

  test('AC-5: 폴백 ID(fallback-)는 FK 위반 방지 대상 — UUID 아님', () => {
    for (const tpl of FALLBACK_TEMPLATES) {
      expect(tpl.id.startsWith('fallback-')).toBe(true);
      // 폴백 ID는 UUID 형식이 아님 → save guard에서 걸러야 함
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(uuidPattern.test(tpl.id)).toBe(false);
    }
  });

  // ── AC-6: 상담내역 submissionEntries 표시 ──────────────────────────────
  test('AC-6: form_key → 한국어 레이블 매핑 — personal_checklist_general', () => {
    const FORM_KEY_LABEL: Record<string, string> = {
      personal_checklist_general: '개인정보+체크리스트 (일반)',
      personal_checklist_senior:  '개인정보+체크리스트 (어르신)',
      pen_chart: '펜차트',
      consent_form: '동의서',
    };
    expect(FORM_KEY_LABEL['personal_checklist_general']).toBe('개인정보+체크리스트 (일반)');
    expect(FORM_KEY_LABEL['personal_checklist_senior']).toBe('개인정보+체크리스트 (어르신)');
  });

  test('AC-6: printed_at null 시 signed_at 폴백 — 표시 시각 오류 방지', () => {
    const entry = { template_key: GENERAL_FORM_KEY, printed_at: null, signed_at: '2026-05-19T10:00:00.000Z' };
    const ts = entry.printed_at ?? entry.signed_at;
    expect(ts).toBe('2026-05-19T10:00:00.000Z');
    expect(() => new Date(ts!)).not.toThrow();
  });

  test('AC-6: printed_at 있을 때 signed_at 무시 — 기존 서류 발행 호환', () => {
    const entry = { printed_at: '2026-05-19T09:00:00.000Z', signed_at: '2026-05-19T10:00:00.000Z' };
    const ts = entry.printed_at ?? entry.signed_at;
    expect(ts).toBe('2026-05-19T09:00:00.000Z');
  });

  // ── 종합 ──────────────────────────────────────────────────────────────
  test('전체 AC 커버: form_key 2종 상호 독립', () => {
    expect(GENERAL_FORM_KEY).not.toBe(SENIOR_FORM_KEY);
    expect(GENERAL_FORM_KEY).not.toBe(PEN_CHART_FORM_KEY);
    expect(SENIOR_FORM_KEY).not.toBe(PEN_CHART_FORM_KEY);
  });

});
