/**
 * E2E Spec — T-20260708-foot-DOCPRINT-DOCTOR-SELECT-DROPDOWN
 *
 * 풋 서류 출력 시 '진료 원장님' 상시 드롭다운을 신설하고, 선택 원장이 서류 렌더의
 * 의사 성명(+도장)에 반영되도록 한다. 원장 4분 진료체계 도입 전 조기 적용.
 *
 * 설계 요지:
 *  - 드롭다운 후보(doctorOptions) = 진료일 근무 로스터(dutyDoctors, duty_roster→staff role=director) 1순위,
 *    근무캘린더 미설정 시 원장 마스터(staff active director) 폴백. 하드코딩 금지·실시간 조회.
 *  - 선택값(selectedDoctorName)은 loadAutoBindContext(checkIn, doctorNameOverride) 로 흘러
 *    buildAutoBindValues.doctor_name 에 반영 → HTML 출력경로 2곳(일괄출력 buildHtmlPageHtml /
 *    영수증 재발급) 이 동일 SSOT(autoValues)를 소비하므로 두 경로 정합(★AC1/AC5).
 *  - AC4: 미선택('')/목록 0명이면 출력 차단(빈·잘못된 원장명 방지 — 의료·법적 서류).
 *
 * 본 spec 은 (1) 바인딩 SSOT(buildAutoBindValues) 가 override 원장명을 의사 성명에 정확히 싣는지,
 *  (2) 드롭다운 옵션 해석·기본선택·AC4 가드 알고리즘(컴포넌트 내부 로직과 동치)을 순수 함수로 단언한다.
 * 실브라우저 dual-path(일괄출력·영수증 재발급) 렌더 회귀 확인은 supervisor E2E(AC5)에서 최종 확정.
 *
 * 실행: npx playwright test T-20260708-foot-DOCPRINT-DOCTOR-SELECT-DROPDOWN.spec.ts
 */

import { test, expect } from '@playwright/test';
import { buildAutoBindValues, type AutoBindContext } from '../../src/lib/autoBindContext';
import type { CheckIn } from '../../src/lib/types';

// ─── 픽스처 ───────────────────────────────────────────────────────────────────
const CHECK_IN = {
  id: 'ci-1',
  clinic_id: 'clinic-jongno-foot',
  customer_id: 'cust-1',
  customer_name: '김발가',
  customer_phone: '01012345678',
  checked_in_at: '2026-07-08T02:00:00.000Z',
} as unknown as CheckIn;

const baseCtx = (doctor: string | null): AutoBindContext => ({
  customer: { name: '김발가', phone: '01012345678' },
  checkIn: CHECK_IN,
  clinic: { name: '오블리브 풋센터 종로', address: '서울 종로구' },
  doctor,
  clinicDoctor: null,
});

// ─── 드롭다운 옵션 해석 + 기본선택 + AC4 가드 (컴포넌트 내부 로직 동치 복제) ───────
type Opt = { id: string; name: string; roster_type?: string };
function resolveOptions(duty: Opt[], master: Opt[]): Opt[] {
  // 근무 로스터 1순위, 없으면 원장 마스터 폴백 (DocumentPrintPanel.doctorOptions 와 동일 규칙)
  return duty.length > 0 ? duty : master;
}
function nextSelected(prev: string, options: Opt[]): string {
  // 현재 선택이 옵션에 있으면 유지, 없으면 첫 번째, 옵션 0명이면 '' (미선택)
  if (options.length === 0) return '';
  return prev && options.some((o) => o.name === prev) ? prev : options[0].name;
}
/** resolveDoctorForPrint 동치: 확정 원장명 or null(=출력 차단) */
function resolveForPrint(selected: string): string | null {
  const eff = selected.trim();
  return eff ? eff : null;
}

// ─── (1) 바인딩 SSOT: 선택 원장 → 의사 성명 ────────────────────────────────────
test.describe('T-20260708 선택 원장 → 서류 의사 성명 바인딩 (양 경로 공통 SSOT)', () => {
  test('AC1/AC5: doctor override 가 doctor_name·referring_doctor 에 그대로 반영', () => {
    const v = buildAutoBindValues(baseCtx('문지은'));
    expect(v.doctor_name).toBe('문지은');
    // 진료의뢰서 등 파생 필드도 동일 원장명으로 수렴
    expect(v.referring_doctor).toBe('문지은');
  });

  test('원장 교체 시 의사 성명도 따라 교체 (드롭다운 재선택 시나리오)', () => {
    expect(buildAutoBindValues(baseCtx('박원장')).doctor_name).toBe('박원장');
    expect(buildAutoBindValues(baseCtx('이원장')).doctor_name).toBe('이원장');
  });

  test('AC5 무회귀: 도장 HTML 은 doctor override 와 무관하게 항상 렌더 (doctor_seal_html 존치)', () => {
    // 8FIX 정합 — 의사성명 근방 도장 일원화. 도장은 clinicDoctor.seal 또는 로컬자산 폴백으로 항상 존재.
    const v = buildAutoBindValues(baseCtx('문지은'));
    expect(typeof v.doctor_seal_html).toBe('string');
    expect(v.doctor_seal_html.length).toBeGreaterThan(0);
    // RRN성별연동 등 기존 바인딩 회귀 없음(성별 체크박스 필드 존재)
    expect(v.patient_gender).toContain('☐');
  });
});

// ─── (2) AC4: 빈·잘못된 원장명 출력 차단 ───────────────────────────────────────
test.describe('T-20260708 AC4 기본값 안전성 — 빈 원장명 출력 차단', () => {
  test('doctor=null 이면 doctor_name 은 빈 문자열(=미선택 신호)', () => {
    expect(buildAutoBindValues(baseCtx(null)).doctor_name).toBe('');
  });

  test('resolveForPrint: 미선택("")·공백이면 null → 출력 차단', () => {
    expect(resolveForPrint('')).toBeNull();
    expect(resolveForPrint('   ')).toBeNull();
  });

  test('resolveForPrint: 선택값 있으면 그 이름으로 진행', () => {
    expect(resolveForPrint('문지은')).toBe('문지은');
  });
});

// ─── (3) 드롭다운 옵션·기본선택 알고리즘 ───────────────────────────────────────
test.describe('T-20260708 드롭다운 옵션 해석 + 기본선택', () => {
  const duty2: Opt[] = [
    { id: 'd1', name: '문지은', roster_type: 'regular' },
    { id: 'd2', name: '박원장', roster_type: 'part' },
  ];
  const master: Opt[] = [{ id: 'm1', name: '이원장' }];

  test('근무 로스터가 있으면 로스터가 옵션 (마스터 무시)', () => {
    expect(resolveOptions(duty2, master).map((o) => o.name)).toEqual(['문지은', '박원장']);
  });

  test('근무캘린더 미설정 시 원장 마스터 폴백 (옵션 비지 않음)', () => {
    expect(resolveOptions([], master).map((o) => o.name)).toEqual(['이원장']);
  });

  test('기본선택: 옵션 있으면 첫 번째, 기존 선택이 옵션에 있으면 유지', () => {
    expect(nextSelected('', duty2)).toBe('문지은');       // 최초 → 첫 번째
    expect(nextSelected('박원장', duty2)).toBe('박원장');  // 유지
    expect(nextSelected('없는원장', duty2)).toBe('문지은'); // 이탈 → 첫 번째로 복귀
  });

  test('AC4: 옵션 0명이면 선택은 "" → 이후 resolveForPrint 로 출력 차단', () => {
    const sel = nextSelected('문지은', resolveOptions([], []));
    expect(sel).toBe('');
    expect(resolveForPrint(sel)).toBeNull();
  });
});
