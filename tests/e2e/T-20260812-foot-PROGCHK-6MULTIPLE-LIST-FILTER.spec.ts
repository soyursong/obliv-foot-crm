/**
 * T-20260812-foot-PROGCHK-6MULTIPLE-LIST-FILTER — 경과분석 탭 나열기준 변경 (pure-logic E2E)
 *
 * 나열 기준 변경: '예약일=오늘' → '활성 패키지 보유 + (used_sessions + 1) % 6 == 0 인 환자 전부'
 *   (오늘 예약 여부 무관·미예약 포함). 판정 로직 기존 그대로(anticipatedSession = used + 1; % 6 == 0).
 *
 * 검증 대상 = 필터/라벨/정렬의 결정론적 핵심(supabase 조립·UI 게이팅은 컴포넌트 통합 수동 QA):
 *   AC1/AC2: 6배수 도래(used+1 % 6==0) 판정 — 오늘 예약 여부 무관(세션수 기반).
 *   AC3: 활성 패키지 스코프 — total_sessions>0 tier 만 대상(체험 tier 0 배제). (활성 status 필터는 쿼리 leg)
 *   AC4: 정렬 = 다음 예약일 오름차순(NULLS LAST) → 이름순(가나다).
 *
 * 왜 pure-logic: 6배수 판정·NULLS-LAST 정렬이 현장 오독(대상 누락/순서 뒤섞임)의 실질 리스크.
 *   자매 SONGDO-FORM-DOWNLOAD 와 동일 모집단(완료회차%6==5 = anticipatedSession%6==0) 정합을 값으로 못박는다.
 */
import { test, expect } from '@playwright/test';
import {
  anticipatedSession,
  isSixMultipleTarget,
  sessionCheckpointLabel,
  compareProgressTargets,
  type ProgressSortRow,
} from '../../src/lib/progressSixMultiple';

test.describe('PROGCHK-6MULTIPLE · anticipatedSession (used + 1)', () => {
  test('anticipatedSession = 완료 세션 수 + 1', () => {
    expect(anticipatedSession(0)).toBe(1);
    expect(anticipatedSession(5)).toBe(6); // 현장 예시 F-4696: 5회 완료 → 다음 6회차
    expect(anticipatedSession(11)).toBe(12);
    expect(anticipatedSession(23)).toBe(24);
  });
});

test.describe('PROGCHK-6MULTIPLE · 6배수 도래 필터 (AC1/AC2/AC3)', () => {
  test('완료 5·11·17·23회 → 다음이 6·12·18·24 (6배수) → 대상', () => {
    for (const used of [5, 11, 17, 23]) {
      expect(isSixMultipleTarget({ usedSessions: used, totalSessions: 30 })).toBe(true);
    }
  });

  test('현장 예시: 허유희 F-4696(5회 완료) → 6회차 도래 → 대상(오늘 예약 무관)', () => {
    // 필터는 세션수(used+1)만 본다 — 오늘 예약 여부는 입력에 없음(미예약도 대상).
    expect(isSixMultipleTarget({ usedSessions: 5, totalSessions: 12 })).toBe(true);
  });

  test('완료 0·3·4·6회(다음이 1·4·5·7) → 6배수 아님 → 비대상', () => {
    for (const used of [0, 3, 4, 6]) {
      expect(isSixMultipleTarget({ usedSessions: used, totalSessions: 30 })).toBe(false);
    }
  });

  test('활성 패키지 tier 0(체험/Re:Born, total_sessions<=0)은 배제', () => {
    // 6배수여도 tier 0 이면 경과분석 대상 아님.
    expect(isSixMultipleTarget({ usedSessions: 5, totalSessions: 0 })).toBe(false);
    expect(isSixMultipleTarget({ usedSessions: 5, totalSessions: null })).toBe(false);
    expect(isSixMultipleTarget({ usedSessions: 5, totalSessions: undefined })).toBe(false);
  });
});

test.describe('PROGCHK-6MULTIPLE · 회차 라벨', () => {
  test('라벨 = "{anticipatedSession}회 경과분석"', () => {
    expect(sessionCheckpointLabel(6)).toBe('6회 경과분석');
    expect(sessionCheckpointLabel(12)).toBe('12회 경과분석');
    expect(sessionCheckpointLabel(24)).toBe('24회 경과분석');
  });
});

test.describe('PROGCHK-6MULTIPLE · 정렬 (AC4: 다음예약일 오름차순 NULLS LAST → 이름순)', () => {
  const mk = (name: string, date: string | null): ProgressSortRow => ({
    customerName: name,
    nextReservationDate: date,
  });

  test('다음 예약일 오름차순(가까운 날짜가 위)', () => {
    const rows = [mk('나', '2026-08-20'), mk('가', '2026-08-14'), mk('다', '2026-08-16')];
    const sorted = [...rows].sort(compareProgressTargets).map((r) => r.customerName);
    expect(sorted).toEqual(['가', '다', '나']);
  });

  test('미예약(null) 환자는 항상 하단 (NULLS LAST)', () => {
    const rows = [mk('미예약가', null), mk('예약을', '2026-08-25'), mk('미예약나', null)];
    const sorted = [...rows].sort(compareProgressTargets).map((r) => r.customerName);
    expect(sorted[0]).toBe('예약을'); // 예약 있는 환자가 최상단
    expect(sorted.slice(1).sort()).toEqual(['미예약가', '미예약나'].sort()); // 나머지는 미예약(하단)
  });

  test('같은 날짜 → 이름순(가나다, ko)', () => {
    const rows = [mk('다현', '2026-08-14'), mk('가온', '2026-08-14'), mk('나래', '2026-08-14')];
    const sorted = [...rows].sort(compareProgressTargets).map((r) => r.customerName);
    expect(sorted).toEqual(['가온', '나래', '다현']);
  });

  test('둘 다 미예약 → 이름순(가나다)', () => {
    const rows = [mk('하늘', null), mk('가람', null), mk('바다', null)];
    const sorted = [...rows].sort(compareProgressTargets).map((r) => r.customerName);
    expect(sorted).toEqual(['가람', '바다', '하늘']);
  });

  test('혼합: 예약(가까운→먼) 위, 미예약(이름순) 아래', () => {
    const rows = [
      mk('미예약나', null),
      mk('예약다', '2026-08-30'),
      mk('예약가', '2026-08-14'),
      mk('미예약가', null),
    ];
    const sorted = [...rows].sort(compareProgressTargets).map((r) => r.customerName);
    expect(sorted).toEqual(['예약가', '예약다', '미예약가', '미예약나']);
  });
});
