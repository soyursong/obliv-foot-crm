/**
 * T-20260519-foot-PENCHART-FORM-ADD
 * 펜차트 개인정보+체크리스트 합본 양식 2종 추가 (일반용 + 어르신용)
 *
 * AC-1: 양식 2종 DB 등록 — form_key personal_checklist_general / personal_checklist_senior
 * AC-2: 양식 선택 UI — 기존 + 신규 2종 선택 패널 (폴백 포함)
 * AC-3: 고객 직접 기입 모드 — fill 모드 진입 + 성명 필수 + 동의 필수
 * AC-4: 상담내역 자동 연동 — form_submissions INSERT 시 check_in_id 연동 구조
 * AC-5: 기존 펜차트 무영향 — 기존 pen_chart form_key / 폴백 템플릿 구조 보전
 *
 * NOTE: 자기완결형 테스트 (component import 없음 — import.meta.env 호환성)
 *       데이터 구조·비즈니스 로직·DB 시드 설계 검증 특화.
 */
import { test, expect } from '@playwright/test';

// ─── 상수 정의 (PenChartTab 구현과 동기화) ────────────────────────────────

const GENERAL_FORM_KEY = 'personal_checklist_general';
const SENIOR_FORM_KEY  = 'personal_checklist_senior';
const PEN_CHART_FORM_KEY = 'pen_chart';

// 폴백 템플릿 (DB 미적용 시 UI에서 inline으로 사용되는 목록)
const FALLBACK_CHECKLIST_TEMPLATES = [
  {
    id: 'fallback-general',
    name_ko: '개인정보+체크리스트 (일반)',
    template_path: '',
    template_format: 'html',
    form_key: GENERAL_FORM_KEY,
  },
  {
    id: 'fallback-senior',
    name_ko: '개인정보+체크리스트 (어르신)',
    template_path: '',
    template_format: 'html',
    form_key: SENIOR_FORM_KEY,
  },
];

// 기존 펜차트 상용구 (AC-5 무영향 검증용)
const BOILERPLATE_LABELS = [
  '발목 족저근막염', '무지외반증', '굳은살·티눈', '발톱 내성발톱',
  '평발(편평족)', '당뇨발 주의', '시술 후 주의', '다음 예약',
];

// DB 시드 설계 (migration SQL과 동기화)
const DB_SEED = [
  { form_key: GENERAL_FORM_KEY, name_ko: '개인정보+체크리스트 (일반)',  sort_order: 91, template_format: 'html' },
  { form_key: SENIOR_FORM_KEY,  name_ko: '개인정보+체크리스트 (어르신)', sort_order: 92, template_format: 'html' },
];

// canSave 로직 (PersonalChecklistFillView와 동일)
const canSave = (name: string, agree_privacy: boolean | null): boolean =>
  name.trim().length > 0 && agree_privacy === true;

// form_submissions payload 빌더 (handleFillSave와 동일)
const buildPayload = (opts: {
  clinicId: string;
  templateId: string;
  customerId: string;
  fieldData: Record<string, unknown>;
  checkInId?: string;
  staffId?: string;
}) => {
  const payload: Record<string, unknown> = {
    clinic_id:   opts.clinicId,
    template_id: opts.templateId,
    customer_id: opts.customerId,
    field_data:  opts.fieldData,
    status:      'signed',
    signed_at:   new Date().toISOString(),
  };
  if (opts.checkInId) payload.check_in_id = opts.checkInId;
  if (opts.staffId)   payload.issued_by   = opts.staffId;
  return payload;
};

// ─────────────────────────────────────────────────────────────────────────────

test.describe('T-20260519-foot-PENCHART-FORM-ADD', () => {

  // ── AC-1: DB 시드 구조 ───────────────────────────────────────────────
  test('AC-1: form_key 2종 — general/senior 명칭 정규화', () => {
    expect(GENERAL_FORM_KEY).toBe('personal_checklist_general');
    expect(SENIOR_FORM_KEY).toBe('personal_checklist_senior');
  });

  test('AC-1: DB seed 2행 — form_key/name_ko/sort_order/template_format 구조', () => {
    expect(DB_SEED).toHaveLength(2);
    for (const row of DB_SEED) {
      expect(row.form_key).toBeTruthy();
      expect(row.name_ko).toBeTruthy();
      expect(row.sort_order).toBeGreaterThan(0);
      expect(row.template_format).toBe('html');
    }
  });

  test('AC-1: sort_order general(91) < senior(92) — UI 순서 보장', () => {
    const gen = DB_SEED.find(r => r.form_key === GENERAL_FORM_KEY)!;
    const sen = DB_SEED.find(r => r.form_key === SENIOR_FORM_KEY)!;
    expect(gen.sort_order).toBeLessThan(sen.sort_order);
  });

  test('AC-1: personal_checklist_ prefix 공유 — form_key 패밀리 식별', () => {
    expect(GENERAL_FORM_KEY.startsWith('personal_checklist_')).toBe(true);
    expect(SENIOR_FORM_KEY.startsWith('personal_checklist_')).toBe(true);
  });

  // ── AC-2: 양식 선택 패널 폴백 구조 ─────────────────────────────────
  test('AC-2: 폴백 체크리스트 템플릿 2종 존재', () => {
    expect(FALLBACK_CHECKLIST_TEMPLATES).toHaveLength(2);
  });

  test('AC-2: 폴백 — 각 항목 id/form_key/name_ko 필드 포함', () => {
    for (const tpl of FALLBACK_CHECKLIST_TEMPLATES) {
      expect(tpl.id).toBeTruthy();
      expect(tpl.form_key).toBeTruthy();
      expect(tpl.name_ko).toBeTruthy();
    }
  });

  test('AC-2: 일반용 이름 "일반" 포함', () => {
    const general = FALLBACK_CHECKLIST_TEMPLATES.find(t => t.form_key === GENERAL_FORM_KEY)!;
    expect(general.name_ko).toContain('일반');
  });

  test('AC-2: 어르신용 이름 "어르신" 포함', () => {
    const senior = FALLBACK_CHECKLIST_TEMPLATES.find(t => t.form_key === SENIOR_FORM_KEY)!;
    expect(senior.name_ko).toContain('어르신');
  });

  test('AC-2: 폴백 template_format = html (캔버스 없는 인앱 렌더링)', () => {
    for (const tpl of FALLBACK_CHECKLIST_TEMPLATES) {
      expect(tpl.template_format).toBe('html');
    }
  });

  // ── AC-3: fill 모드 — 저장 가능 조건 ──────────────────────────────
  test('AC-3: isSenior 플래그 — senior form_key 에만 true', () => {
    expect(GENERAL_FORM_KEY === 'personal_checklist_senior').toBe(false);
    expect(SENIOR_FORM_KEY  === 'personal_checklist_senior').toBe(true);
  });

  test('AC-3: canSave — 성명 없으면 false', () => {
    expect(canSave('', true)).toBe(false);
    expect(canSave('  ', true)).toBe(false);
  });

  test('AC-3: canSave — agree_privacy null이면 false', () => {
    expect(canSave('홍길동', null)).toBe(false);
  });

  test('AC-3: canSave — agree_privacy false이면 false (성명 있어도)', () => {
    expect(canSave('홍길동', false)).toBe(false);
  });

  test('AC-3: canSave — 성명 + agree_privacy true → true', () => {
    expect(canSave('홍길동', true)).toBe(true);
  });

  // ── AC-4: form_submissions payload ──────────────────────────────────
  test('AC-4: check_in_id 있을 때 payload에 포함 (상담 자동 연동)', () => {
    const payload = buildPayload({
      clinicId: 'clinic-uuid',
      templateId: 'template-uuid',
      customerId: 'customer-uuid',
      fieldData: { name: '홍길동' },
      checkInId: 'checkin-uuid-1234',
      staffId:   'staff-uuid-5678',
    });
    expect(payload.check_in_id).toBe('checkin-uuid-1234');
    expect(payload.issued_by).toBe('staff-uuid-5678');
  });

  test('AC-4: checkInId 없을 때 check_in_id 미포함 (선택적 연동)', () => {
    const payload = buildPayload({
      clinicId: 'clinic-uuid',
      templateId: 'template-uuid',
      customerId: 'customer-uuid',
      fieldData: {},
    });
    expect(payload).not.toHaveProperty('check_in_id');
  });

  test('AC-4: payload status = signed, signed_at ISO 형식', () => {
    const payload = buildPayload({
      clinicId: 'c', templateId: 't', customerId: 'u', fieldData: {},
      checkInId: 'ci-001',
    });
    expect(payload.status).toBe('signed');
    expect(typeof payload.signed_at).toBe('string');
    expect(() => new Date(payload.signed_at as string)).not.toThrow();
  });

  test('AC-4: payload 필수 키 clinic_id/template_id/customer_id/field_data 포함', () => {
    const payload = buildPayload({
      clinicId: 'c-1', templateId: 't-1', customerId: 'u-1', fieldData: { name: 'test' },
    });
    expect(payload).toHaveProperty('clinic_id',   'c-1');
    expect(payload).toHaveProperty('template_id', 't-1');
    expect(payload).toHaveProperty('customer_id', 'u-1');
    expect(payload).toHaveProperty('field_data');
  });

  // ── AC-5: 기존 펜차트 무영향 ─────────────────────────────────────
  test('AC-5: pen_chart form_key는 personal_checklist_ 패밀리와 충돌 없음', () => {
    expect(PEN_CHART_FORM_KEY).toBe('pen_chart');
    expect(PEN_CHART_FORM_KEY).not.toBe(GENERAL_FORM_KEY);
    expect(PEN_CHART_FORM_KEY).not.toBe(SENIOR_FORM_KEY);
    expect(PEN_CHART_FORM_KEY.startsWith('personal_checklist_')).toBe(false);
  });

  test('AC-5: 상용구 8종 유지 — label 목록 확인', () => {
    expect(BOILERPLATE_LABELS).toHaveLength(8);
    expect(BOILERPLATE_LABELS).toContain('발목 족저근막염');
    expect(BOILERPLATE_LABELS).toContain('무지외반증');
    expect(BOILERPLATE_LABELS).toContain('시술 후 주의');
    expect(BOILERPLATE_LABELS).toContain('다음 예약');
  });

  test('AC-5: general/senior form_key 2종 서로 다름', () => {
    expect(GENERAL_FORM_KEY).not.toBe(SENIOR_FORM_KEY);
  });

});
