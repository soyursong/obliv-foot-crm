/**
 * E2E Spec — T-20260708-foot-TREATING-DOCTOR-SELECT-SYNC
 *
 * 풋센터 진료 의사(treating_doctor) 선택을 두 화면에서 하고 서로 연동 + 근무스케줄 기준
 * 오늘 휴무 원장 드롭다운 자동 비활성.
 *
 * 스코프(2026-07-09 planner MSG-3myj per-AC 게이트 분리):
 *  ✅ AC1 치료테이블>진료환자이력 탭 진료의 선택 (DoctorHistorySection)
 *  ✅ AC2 대시보드 진료콜 명단 진료의 선택 (DoctorCallListBar)
 *  ✅ AC3 양쪽 실시간 연동 = single-field-share(check_ins.treating_doctor_id 단일 앵커)
 *  ✅ AC6 요청 D — 오늘 duty_roster 휴무 원장 옵션 disabled(표시하되 선택불가, filter 아님)
 *  🔒 AC4 (요청 C, 서류 재출력 원장 스냅샷 / OpinionDocTab·printOpinionDoc) = §11 의료화면 컨펌
 *     게이트 대상 → 문지은 대표원장 confirm 전까지 미구현. 본 spec 에서 제외(아래 test.fixme 참조).
 *
 * 설계 요지(DA CONSULT-REPLY GO_ADDITIVE canonical):
 *  · 저장 grain = check_ins.treating_doctor_id (단일 앵커, FK→clinic_doctors(id) SET NULL).
 *    진료콜 명단·진료환자이력 탭이 같은 한 필드를 read/write → single-field-share 로 AC3 자동충족(sync 아님).
 *  · 옵션 소스 = active clinic_doctors. 근무/휴무 판정 = clinic_doctors.staff_id ↔ duty_roster.doctor_id(→staff).
 *  · unlinked(staff_id NULL) = disabled 아님(enabled+advisory) — over-disable 방지(실근무 원장 오잠금 X).
 *
 * 본 spec 은 옵션·근무/휴무 판정 canonical 로직(computeTreatingDoctorOptions, 컴포넌트/훅이 실제 소비하는
 *  동일 함수)을 순수 단언한다. 실브라우저 dual-surface 연동·realtime 회귀는 supervisor E2E 에서 최종 확정.
 *
 * 실행: npx playwright test T-20260708-foot-TREATING-DOCTOR-SELECT-SYNC.spec.ts
 */

import { test, expect } from '@playwright/test';
import {
  computeTreatingDoctorOptions,
  type TreatingDoctorOption,
} from '../../src/hooks/useTreatingDoctorOptions';

// ─── 픽스처: active clinic_doctors 4분 원장 ────────────────────────────────────
const CD = (id: string, name: string, staff_id: string | null): Record<string, unknown> => ({
  id,
  name,
  license_no: `LIC-${id}`,
  seal_image_url: null,
  staff_id,
});

const DOCTORS = [
  CD('cd-A', '문지은', 'staff-A'),
  CD('cd-B', '박원장', 'staff-B'),
  CD('cd-C', '이원장', 'staff-C'),
  CD('cd-D', '최원장', 'staff-D'),
];

const byId = (opts: TreatingDoctorOption[], id: string) => opts.find((o) => o.id === id)!;

// ─── 트리거 라벨 해석 (TreatingDoctorSelect.renderLabel 동치) ──────────────────
const NONE = '__none__';
function renderLabel(v: string | null, options: TreatingDoctorOption[]): string {
  if (!v || v === NONE) return '진료의 미지정';
  const o = options.find((x) => x.id === v);
  return o?.name ?? '진료의(비활성)';
}

// ─── 시나리오 3 / AC6: 근무스케줄 기준 휴무 원장 disabled ─────────────────────
test.describe('AC6/요청 D — 오늘 휴무 원장 옵션 disabled (표시하되 선택불가)', () => {
  test('C만 오늘 휴무 → C는 disabled, A/B/D는 선택 가능 (filter 아님·전원 표시)', () => {
    // 근무(duty_roster) = A/B/D 의 staff, C 는 오늘 로스터 부재
    const working = new Set(['staff-A', 'staff-B', 'staff-D']);
    const opts = computeTreatingDoctorOptions(DOCTORS, working, true);

    // 전원 옵션에 표시(휴무여도 제외 안 함)
    expect(opts).toHaveLength(4);
    expect(byId(opts, 'cd-C').disabled).toBe(true);
    expect(byId(opts, 'cd-C').working).toBe(false);
    for (const id of ['cd-A', 'cd-B', 'cd-D']) {
      expect(byId(opts, id).disabled).toBe(false);
      expect(byId(opts, id).working).toBe(true);
    }
  });

  test('C 근무 복귀 → C 다시 활성(선택 가능) — 실시간 재계산 동치', () => {
    const working = new Set(['staff-A', 'staff-B', 'staff-C', 'staff-D']);
    const opts = computeTreatingDoctorOptions(DOCTORS, working, true);
    expect(opts.every((o) => !o.disabled)).toBe(true);
    expect(byId(opts, 'cd-C').working).toBe(true);
  });
});

// ─── 시나리오 4 / 엣지 ────────────────────────────────────────────────────────
test.describe('엣지 — 전원 휴무 / 미연결(unlinked) / 미선택', () => {
  test('당일 근무 원장 0명(전원 휴무) → 전 옵션 disabled, 목록은 표시(깨짐 없음)', () => {
    const opts = computeTreatingDoctorOptions(DOCTORS, new Set(), true);
    expect(opts).toHaveLength(4);
    expect(opts.every((o) => o.disabled)).toBe(true);
  });

  test('staff_id 미연결(브릿지 누락) 원장 → disabled 아님(enabled+advisory) — over-disable 방지', () => {
    const rows = [CD('cd-X', '연결안된원장', null), ...DOCTORS];
    const opts = computeTreatingDoctorOptions(rows, new Set(['staff-A']), true);
    const x = byId(opts, 'cd-X');
    expect(x.unlinked).toBe(true);
    expect(x.disabled).toBe(false); // 실근무 원장 오잠금 방지
    // 연결된 원장은 정상 근무판정
    expect(byId(opts, 'cd-A').working).toBe(true);
    expect(byId(opts, 'cd-B').disabled).toBe(true); // staff-B 오늘 미근무
  });

  test('staff_id 컬럼 미배포 환경(hasStaffIdCol=false) → 전원 unlinked=enabled (방어적 폴백)', () => {
    const opts = computeTreatingDoctorOptions(DOCTORS, new Set(), false);
    expect(opts.every((o) => o.unlinked && !o.disabled)).toBe(true);
  });

  test('미선택(NONE)/비활성 저장값 라벨 — UUID 미노출·깨짐 없음', () => {
    const working = new Set(['staff-A']);
    const opts = computeTreatingDoctorOptions(DOCTORS, working, true);
    expect(renderLabel(null, opts)).toBe('진료의 미지정');
    expect(renderLabel(NONE, opts)).toBe('진료의 미지정');
    expect(renderLabel('cd-A', opts)).toBe('문지은');
    // 옵션에 없는(비활성 clinic_doctor) id → UUID 노출 대신 '진료의(비활성)'
    expect(renderLabel('cd-INACTIVE', opts)).toBe('진료의(비활성)');
  });
});

// ─── AC1/AC2/AC3: single-field-share 연동 ─────────────────────────────────────
test.describe('AC3 — 두 화면 single-field-share(check_ins.treating_doctor_id)', () => {
  test('양쪽(진료콜 명단·진료환자이력 탭)이 동일 옵션 SSOT·동일 id 해석 → 연동 by-construction', () => {
    // 두 surface 는 같은 computeTreatingDoctorOptions + 같은 check_ins.treating_doctor_id 를 read/write.
    // 저장값 id 가 양쪽에서 동일 원장명으로 해석되어야 '연동'이 성립(중복 컬럼 없음).
    const working = new Set(['staff-A', 'staff-B', 'staff-D']);
    const optsCallList = computeTreatingDoctorOptions(DOCTORS, working, true);
    const optsHistoryTab = computeTreatingDoctorOptions(DOCTORS, working, true);
    // 진료콜에서 원장 A 저장 → 이력탭에서 동일 id 를 A 로 해석
    expect(renderLabel('cd-A', optsCallList)).toBe(renderLabel('cd-A', optsHistoryTab));
    expect(renderLabel('cd-A', optsHistoryTab)).toBe('문지은');
  });
});

// ─── AC4 (요청 C) — §11 의료화면 컨펌 게이트 대상: 문원장 confirm 전까지 미구현 ──
test.describe('AC4 (요청 C) — 서류 재출력 원장 스냅샷', () => {
  // 🔒 OpinionDocTab·printOpinionDoc = §11 게이트대상. planner MSG-3myj 판정으로 confirm_status: confirmed
  //    전까지 미수정. 문지은 대표원장 컨펌 후 별도 delta 로 구현·spec 추가한다(발행시점 field_data
  //    jsonb 스냅샷: issuing_doctor_name/issuing_doctor_license_no/issuing_doctor_seal_url).
  test.fixme('발행 당시 원장 스냅샷 불변 보존(재출력 시 변경 원장 아님) — 문원장 confirm 후 구현', () => {});
});
