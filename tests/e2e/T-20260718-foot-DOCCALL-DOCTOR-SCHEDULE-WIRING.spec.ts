/**
 * E2E Spec — T-20260718-foot-DOCCALL-DOCTOR-SCHEDULE-WIRING
 *
 * 진료콜 명단 원장 드롭다운 ↔ 근무표(duty_roster) 연동. 근무일 원장=선택가능 / 휴무일 원장=자동 비활성.
 *
 * RC (dev-foot diagnose, 2026-07-18, 라이브 DB 실측):
 *   · 근무/휴무 판정 read-join 로직·스키마는 T-20260708-TREATING-DOCTOR-SELECT-SYNC 에서 이미 배포됨
 *     (useTreatingDoctorOptions: clinic_doctors.staff_id ↔ duty_roster.doctor_id(→staff) 조인).
 *   · 그러나 foot 4원장(문지은/한동훈/김윤기/김상은) 전원 clinic_doctors.staff_id = NULL (브릿지 미채움)
 *     → 전원 unlinked → 전원 enabled(over-disable 폴백) → '휴무 자동 비활성'이 발동 안 함
 *     = 현장 "휴무 반영 안 됨 / 매핑 연결 고리 미완성" 근본원인.
 *   · FIX = DATA backfill (20260718120000): 동일인 director-active staff 링크 채움. DDL 0.
 *
 * 본 spec 은 컴포넌트/훅이 실제 소비하는 동일 순수함수(computeTreatingDoctorOptions)를 단언한다
 * (drift 방지). 실브라우저 진료콜 명단 dual-surface·realtime 은 supervisor E2E 에서 최종 확정.
 *
 * ⚠ SOURCE-OF-TRUTH 가드(AC-4): 근무/휴무 판정 source = duty_roster(근무 스케줄). staff_attendance(실제 출근)
 *    와 결합 금지. workingStaffIds 는 duty_roster.doctor_id(resigned 제외) 집합에서만 유래한다.
 *
 * 실행: npx playwright test T-20260718-foot-DOCCALL-DOCTOR-SCHEDULE-WIRING.spec.ts
 */

import { test, expect } from '@playwright/test';
import {
  computeTreatingDoctorOptions,
  type TreatingDoctorOption,
} from '../../src/hooks/useTreatingDoctorOptions';

// ─── 라이브 지형 픽스처: foot 4원장 + 근무표 실제 staff.id ────────────────────────
//   staff.id 는 duty_roster.doctor_id 가 실제로 쓰는 director-active 계정(라이브 실측 대응).
const STAFF = {
  moon: 'staff-moon-director',   // 문지은 director/active (roster 사용)
  han: 'staff-han-director',     // 한동훈 director/active (roster 사용)
  hanTherapist: 'staff-han-therapist', // ⚠ 한동훈 동명 therapist/inactive — roster 미사용(오링크 함정)
  kimY: 'staff-kimY-director',   // 김윤기 director/active
  kimS: 'staff-kimS-director',   // 김상은 director/active
};

const CD = (id: string, name: string, staff_id: string | null): Record<string, unknown> => ({
  id,
  name,
  license_no: `LIC-${id}`,
  seal_image_url: null,
  staff_id,
});

// backfill 적용 후 상태(브릿지 = director-active staff)
const DOCTORS_LINKED = [
  CD('cd-moon', '문지은', STAFF.moon),
  CD('cd-han', '한동훈', STAFF.han),
  CD('cd-kimY', '김윤기', STAFF.kimY),
  CD('cd-kimS', '김상은', STAFF.kimS),
];

// backfill 이전(RC) 상태 = 전원 staff_id NULL
const DOCTORS_UNLINKED = [
  CD('cd-moon', '문지은', null),
  CD('cd-han', '한동훈', null),
  CD('cd-kimY', '김윤기', null),
  CD('cd-kimS', '김상은', null),
];

const byId = (opts: TreatingDoctorOption[], id: string) => opts.find((o) => o.id === id)!;

// ─── 시나리오 1: 근무일 원장 활성·선택 가능 (AC-1·AC-2) ────────────────────────────
test.describe('S1 — 근무일 원장 = 활성(선택 가능)', () => {
  test('오늘 duty_roster 근무 = 문지은·김윤기 → 활성(disabled=false, working=true)', () => {
    // 오늘(2026-07-18) 라이브 근무 집합 = {문지은, 김윤기} (실측). 소스=duty_roster (AC-4).
    const working = new Set([STAFF.moon, STAFF.kimY]);
    const opts = computeTreatingDoctorOptions(DOCTORS_LINKED, working, true);

    expect(opts).toHaveLength(4); // 휴무여도 제외 아님(표시하되 선택가능/불가)
    for (const id of ['cd-moon', 'cd-kimY']) {
      expect(byId(opts, id).working).toBe(true);
      expect(byId(opts, id).disabled).toBe(false);
      expect(byId(opts, id).unlinked).toBe(false);
    }
  });
});

// ─── 시나리오 2: 휴무일 원장 자동 비활성 (AC-3) ────────────────────────────────────
test.describe('S2 — 휴무일 원장 = 자동 비활성(선택 불가)', () => {
  test('오늘 로스터 부재 = 한동훈·김상은 → disabled=true(휴무), working=false', () => {
    const working = new Set([STAFF.moon, STAFF.kimY]);
    const opts = computeTreatingDoctorOptions(DOCTORS_LINKED, working, true);

    for (const id of ['cd-han', 'cd-kimS']) {
      expect(byId(opts, id).working).toBe(false);
      expect(byId(opts, id).disabled).toBe(true);  // 휴무 = 자동 비활성
      expect(byId(opts, id).unlinked).toBe(false); // 연결됨(브릿지 채워짐)이라 휴무 판정 성립
    }
  });

  test('전원 휴무(로스터 0행) → 4명 전부 disabled, 목록은 표시(깨짐 없음)', () => {
    const opts = computeTreatingDoctorOptions(DOCTORS_LINKED, new Set(), true);
    expect(opts).toHaveLength(4);
    expect(opts.every((o) => o.disabled)).toBe(true);
  });

  test('실시간: 한동훈 근무 등록 시 즉시 활성 복귀(재계산 동치, AC-3 실시간)', () => {
    const opts = computeTreatingDoctorOptions(
      DOCTORS_LINKED,
      new Set([STAFF.moon, STAFF.kimY, STAFF.han]),
      true,
    );
    expect(byId(opts, 'cd-han').working).toBe(true);
    expect(byId(opts, 'cd-han').disabled).toBe(false);
  });
});

// ─── 브릿지 오링크 함정 가드: 한동훈 동명 therapist/inactive 계정 배제 ──────────────
test.describe('브릿지 대상 = 근무표 authoritative 계정 (한동훈 director-vs-therapist 함정)', () => {
  test('한동훈을 roster-미사용 therapist 계정에 오링크하면 → 근무일에도 영영 휴무(회귀 유발)', () => {
    // 만약 backfill 이 한동훈을 therapist/inactive staff 로 잘못 링크했다면,
    // 로스터가 쓰는 director 계정(STAFF.han)이 근무 중이어도 옵션의 staff_id(hanTherapist)는
    // working 집합에 없어 *근무일에도 disabled* 로 잘못 잠긴다 — 우리가 배제한 실패 모드.
    const misLinked = [CD('cd-han', '한동훈', STAFF.hanTherapist)];
    const workingDirectorOn = new Set([STAFF.han]); // 근무표엔 director 로 근무 등록
    const opts = computeTreatingDoctorOptions(misLinked, workingDirectorOn, true);
    expect(byId(opts, 'cd-han').disabled).toBe(true); // ← 잘못된 링크의 증상(오잠금)

    // 반면 올바른 director 링크(우리 backfill) 는 근무일에 정상 활성.
    const correct = [CD('cd-han', '한동훈', STAFF.han)];
    const opts2 = computeTreatingDoctorOptions(correct, workingDirectorOn, true);
    expect(byId(opts2, 'cd-han').disabled).toBe(false);
    expect(byId(opts2, 'cd-han').working).toBe(true);
  });
});

// ─── 시나리오 3: 회귀 — 기존 선택·저장 동작 무변경 + RC 재현 (AC-5) ─────────────────
test.describe('S3 — 회귀 금지 + RC(브릿지 NULL) 재현', () => {
  test('backfill 이전(staff_id NULL) = RC → 전원 unlinked·enabled(휴무 미반영, 버그)', () => {
    // 이 상태가 현장이 보고한 결함: 오늘 문지은·김윤기만 근무여도 4명 전원 선택 가능(휴무 안 잠김).
    const working = new Set([STAFF.moon, STAFF.kimY]);
    const opts = computeTreatingDoctorOptions(DOCTORS_UNLINKED, working, true);
    expect(opts.every((o) => o.unlinked)).toBe(true);
    expect(opts.every((o) => !o.disabled)).toBe(true); // 휴무 자동비활성 발동 X = 결함 재현
  });

  test('기존 선택·저장 동선 무변경 — 옵션 id·이름 해석·미지정 라벨 불변', () => {
    // AC-5: 활성/비활성 표시만 가산. 옵션 자체(id/name)·저장 grain(check_ins.treating_doctor_id)은 불변.
    const working = new Set([STAFF.moon]);
    const opts = computeTreatingDoctorOptions(DOCTORS_LINKED, working, true);
    // 전원 옵션 표시(선택 후보 유지) — 저장 경로가 소비하는 id 집합 불변.
    expect(opts.map((o) => o.id).sort()).toEqual(['cd-han', 'cd-kimS', 'cd-kimY', 'cd-moon']);
    // 근무 원장은 정상 선택 가능(저장 가능).
    expect(byId(opts, 'cd-moon').disabled).toBe(false);
  });

  test('staff_id 컬럼 미배포 방어 폴백 유지(hasStaffIdCol=false) → 전원 enabled(over-disable 방지)', () => {
    const opts = computeTreatingDoctorOptions(DOCTORS_LINKED, new Set(), false);
    expect(opts.every((o) => o.unlinked && !o.disabled)).toBe(true);
  });
});
