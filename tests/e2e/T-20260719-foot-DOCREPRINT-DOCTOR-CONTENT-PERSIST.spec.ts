/**
 * E2E Spec — T-20260719-foot-DOCREPRINT-DOCTOR-CONTENT-PERSIST
 *
 * 풋 서류 재출력 시 최초 발급(출력) 시점의 (a)담당의 (b)선택 출력내용 항목을 저장해두고,
 * 동일 예약(check_in)의 서류를 재출력할 때 저장값을 선택 UI에 자동으로 채운다(재선택 불필요).
 *
 * 설계 요지 (DocumentPrintPanel 내부 로직과 동치):
 *  - 저장 스코프 = 예약(check_in) 단위. form_submissions.check_in_id 로 매칭(기본 키, §AC1).
 *  - 담당의 = 기존 발행분 field_data 스냅샷(attending_doctor_name → doctor_name)에서 복원.
 *    ★ 신규 컬럼 없음 — 기존 form_submissions.field_data(JSONB) 조회 재사용(db_change=false).
 *  - 출력내용 항목 = 발행된(무효 제외) 서류의 template_id → form_key 집합 = selectedKeys 프리필.
 *  - AC3 노출 규칙:
 *    · 최초 출력 前(발행 이력 없음): 프리필 미발동 → 선택 UI 그대로(빈 상태).
 *    · 이미 출력된 서류 재출력(이력 있음): 저장 담당의·출력내용 자동 세팅.
 *  - 저장 담당의가 그날 근무/치료 목록에 없어도(다른 날 재출력) 옵션에 additive 보강 → 자동선택 유지
 *    (T-20260713 UNLINKED 패턴 재사용, 신규 정책 없음).
 *  - checkIn.id당 1회만 적용 → 사용자가 자동세팅 후 바꾼 선택을 덮어쓰지 않는다.
 *
 * 본 spec 은 프리필 알고리즘(담당의 복원 / 출력내용 복원 / 옵션 보강 / 시나리오별 발동 여부)을
 * 순수 함수로 단언한다. 실브라우저 팝업 자동채움 회귀는 supervisor E2E(AC2)에서 최종 확정.
 *
 * 실행: npx playwright test T-20260719-foot-DOCREPRINT-DOCTOR-CONTENT-PERSIST.spec.ts
 */

import { test, expect } from '@playwright/test';

// ─── 픽스처: 발행 이력(form_submissions, created_at DESC) ─────────────────────
type Sub = {
  id: string;
  template_id: string;
  status: 'draft' | 'printed' | 'voided';
  field_data: Record<string, string>;
  created_at: string;
};
type Tpl = { id: string; form_key: string };
type Opt = { id: string; name: string };

const TEMPLATES: Tpl[] = [
  { id: 'tpl-treat', form_key: 'treat_confirm_code' },
  { id: 'tpl-visit', form_key: 'visit_confirm' },
  { id: 'tpl-bill', form_key: 'bill_receipt_new' },
  { id: 'tpl-diag', form_key: 'diagnosis' },
];

// ─── 컴포넌트 내부 로직 동치 복제 ─────────────────────────────────────────────

/** savedDoctorName: 최근 유효(무효 제외) 발행분 field_data 스냅샷(attending→doctor). */
function deriveSavedDoctor(submissions: Sub[]): string {
  return (
    submissions
      .filter((s) => s.status !== 'voided')
      .map((s) => (s.field_data?.attending_doctor_name || s.field_data?.doctor_name || '').trim())
      .find((n) => n.length > 0) ?? ''
  );
}

/** printedKeys: 발행된(무효 제외) 서류의 template_id → form_key 집합. */
function derivePrintedKeys(submissions: Sub[], templates: Tpl[]): Set<string> {
  const keys = new Set<string>();
  for (const sub of submissions) {
    if (sub.status === 'voided') continue;
    const tpl = templates.find((t) => t.id === sub.template_id);
    if (tpl) keys.add(tpl.form_key);
  }
  return keys;
}

/** doctorOptions: 저장 담당의가 목록에 없으면 additive 보강. */
function injectSavedDoctor(base: Opt[], savedDoctorName: string): Opt[] {
  return savedDoctorName && !base.some((o) => o.name === savedDoctorName)
    ? [{ id: `saved:${savedDoctorName}`, name: savedDoctorName }, ...base]
    : base;
}

/** 프리필 발동 판정 + 결과(담당의/출력내용). checkIn.id당 1회. AC2/AC3 게이트. */
function computePrefill(
  submissions: Sub[],
  templates: Tpl[],
  baseOptions: Opt[],
  prevSelectedKeys: Set<string>,
  alreadyApplied: boolean,
): { applied: boolean; doctor: string | null; keys: Set<string> | null } {
  if (alreadyApplied) return { applied: false, doctor: null, keys: null };
  if (submissions.length === 0 || templates.length === 0) return { applied: false, doctor: null, keys: null };
  const printedKeys = derivePrintedKeys(submissions, templates);
  const savedDoctorName = deriveSavedDoctor(submissions);
  if (printedKeys.size === 0 && !savedDoctorName) return { applied: false, doctor: null, keys: null };
  const options = injectSavedDoctor(baseOptions, savedDoctorName);
  const doctor = savedDoctorName && options.some((o) => o.name === savedDoctorName) ? savedDoctorName : null;
  const keys = printedKeys.size > 0 ? (prevSelectedKeys.size > 0 ? prevSelectedKeys : printedKeys) : null;
  return { applied: true, doctor, keys };
}

// ─── 시나리오 1: 최초 발급 (저장 발생) ────────────────────────────────────────
test('시나리오1 — 발행 이력이 저장값 원천: 담당의·출력내용이 field_data/template_id로 조회 재사용된다', () => {
  const afterFirstIssue: Sub[] = [
    {
      id: 's1',
      template_id: 'tpl-treat',
      status: 'printed',
      field_data: { attending_doctor_name: '김의사', doctor_name: '오블리브대표' },
      created_at: '2026-07-19T05:00:00Z',
    },
    {
      id: 's2',
      template_id: 'tpl-bill',
      status: 'printed',
      field_data: { doctor_name: '오블리브대표' },
      created_at: '2026-07-19T05:00:01Z',
    },
  ];
  // 담당의 = attending_doctor_name 우선 스냅샷
  expect(deriveSavedDoctor(afterFirstIssue)).toBe('김의사');
  // 출력내용 = 발행된 서류의 form_key 집합
  expect([...derivePrintedKeys(afterFirstIssue, TEMPLATES)].sort()).toEqual(
    ['bill_receipt_new', 'treat_confirm_code'].sort(),
  );
});

// ─── 시나리오 2: 재출력 (자동 세팅) ───────────────────────────────────────────
test('시나리오2 — 재출력 시 저장 담당의·출력내용이 자동 프리필된다(재선택 불필요)', () => {
  const history: Sub[] = [
    {
      id: 's1',
      template_id: 'tpl-treat',
      status: 'printed',
      field_data: { attending_doctor_name: '김의사' },
      created_at: '2026-07-19T05:00:00Z',
    },
    {
      id: 's2',
      template_id: 'tpl-visit',
      status: 'printed',
      field_data: { attending_doctor_name: '김의사' },
      created_at: '2026-07-19T05:00:01Z',
    },
  ];
  const options: Opt[] = [{ id: 'd1', name: '김의사' }, { id: 'd2', name: '박의사' }];
  const r = computePrefill(history, TEMPLATES, options, new Set(), false);
  expect(r.applied).toBe(true);
  expect(r.doctor).toBe('김의사');
  expect([...(r.keys ?? new Set())].sort()).toEqual(['treat_confirm_code', 'visit_confirm'].sort());
});

test('시나리오2b — 저장 담당의가 그날 근무/치료 목록에 없어도 additive 보강 후 자동선택 유지', () => {
  const history: Sub[] = [
    {
      id: 's1',
      template_id: 'tpl-diag',
      status: 'printed',
      field_data: { attending_doctor_name: '이전담당의' },
      created_at: '2026-07-10T05:00:00Z',
    },
  ];
  const todayOptions: Opt[] = [{ id: 'd1', name: '오늘근무의' }]; // 저장 담당의 부재
  const injected = injectSavedDoctor(todayOptions, deriveSavedDoctor(history));
  expect(injected.some((o) => o.name === '이전담당의')).toBe(true);
  const r = computePrefill(history, TEMPLATES, todayOptions, new Set(), false);
  expect(r.doctor).toBe('이전담당의');
  expect([...(r.keys ?? new Set())]).toEqual(['diagnosis']);
});

// ─── 시나리오 3: 엣지 — 최초 출력 이력 없는 신규 서류 ─────────────────────────
test('시나리오3 — 발행 이력 없으면 프리필 미발동(선택 UI 빈 상태 유지, AC3)', () => {
  const r = computePrefill([], TEMPLATES, [{ id: 'd1', name: '김의사' }], new Set(), false);
  expect(r.applied).toBe(false);
  expect(r.doctor).toBeNull();
  expect(r.keys).toBeNull();
});

// ─── 회귀/불변식: 1회 적용 · 사용자 편집 보존 · 무효 서류 제외 ─────────────────
test('불변식 — checkIn.id당 1회만 적용(이미 적용 시 재발동 없음)', () => {
  const history: Sub[] = [
    { id: 's1', template_id: 'tpl-treat', status: 'printed', field_data: { attending_doctor_name: '김의사' }, created_at: '2026-07-19T05:00:00Z' },
  ];
  const r = computePrefill(history, TEMPLATES, [{ id: 'd1', name: '김의사' }], new Set(), true /* alreadyApplied */);
  expect(r.applied).toBe(false);
});

test('불변식 — 사용자가 이미 선택한 출력내용(selectedKeys)은 프리필이 덮어쓰지 않는다', () => {
  const history: Sub[] = [
    { id: 's1', template_id: 'tpl-treat', status: 'printed', field_data: { attending_doctor_name: '김의사' }, created_at: '2026-07-19T05:00:00Z' },
  ];
  const userSelected = new Set(['visit_confirm']);
  const r = computePrefill(history, TEMPLATES, [{ id: 'd1', name: '김의사' }], userSelected, false);
  expect([...(r.keys ?? new Set())]).toEqual(['visit_confirm']); // 사용자 선택 보존
});

test('불변식 — 무효(voided) 서류는 담당의·출력내용 복원에서 제외', () => {
  const history: Sub[] = [
    { id: 's1', template_id: 'tpl-treat', status: 'voided', field_data: { attending_doctor_name: '취소의사' }, created_at: '2026-07-19T05:00:02Z' },
    { id: 's2', template_id: 'tpl-bill', status: 'printed', field_data: { attending_doctor_name: '김의사' }, created_at: '2026-07-19T05:00:00Z' },
  ];
  expect(deriveSavedDoctor(history)).toBe('김의사'); // 취소의사 제외
  expect([...derivePrintedKeys(history, TEMPLATES)]).toEqual(['bill_receipt_new']); // voided treat 제외
});
