/**
 * T-20260614-foot-TIMETABLE-THERAPIST-DESIGNATED
 * 통합시간표 [치료사별] 탭: 치료실/배정 기준 → 고객 지정치료사 기준 그룹핑 + 명단 "지정" 배지
 *
 * 김주연 총괄 (2026-06-14, C0ATE5P6JTH thread 1781366479.405429):
 *   [치료사별] 탭을 지정 치료사 기준으로 바꿔달라 + 오늘 예약 명단 중 지정치료사 환자는 별도 표기.
 *
 * 설계:
 *  - DB 변경 없음. customers.designated_therapist_id (T-20260607-CHECKIN-DESIGNATED-FLAG SSOT) read-only JOIN 재사용.
 *  - Q1=a 해석: 환자 상시 지정치료사(customers.designated_therapist_id) 기준 그룹핑.
 *  - Q2 baseline: 미설정 환자는 '__none__' → "미지정" 섹션으로 수용 (명단 누락 금지).
 *
 * AC-1: [치료사별] 그룹핑 키가 ci.therapist_id → ci.customers.designated_therapist_id 로 변경됨
 * AC-2: 지정치료사 미설정 환자 섹션 라벨이 "미지정" (기존 "미배정" 아님)
 * AC-3: 체크인/예약 embed 쿼리에 designated_therapist_id 가 추가됨 (selfCheckIns + timelineReservations)
 * AC-4: 치료사별 뷰 카드에 "지정" 배지 (designated_therapist_id 존재 시) 렌더
 * AC-5: 시간표 뷰 아코디언 명단에 designatedTherapistId 기반 "지정" 배지 렌더
 * AC-6: CheckIn / Reservation customers embed 타입에 designated_therapist_id 필드 존재
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashSrc = readFileSync(
  path.resolve(__dirname, '../../src/pages/Dashboard.tsx'),
  'utf-8',
);
const typesSrc = readFileSync(
  path.resolve(__dirname, '../../src/lib/types.ts'),
  'utf-8',
);

// AC-1: 그룹핑 키 변경 (배정 치료사 → 고객 지정치료사)
test('AC-1: checkInsByTherapist 그룹핑 키가 customers.designated_therapist_id 로 변경됨', () => {
  expect(dashSrc).toContain("const key = ci.customers?.designated_therapist_id ?? '__none__';");
  // 기존 배정치료사(ci.therapist_id) 키로 그룹핑하지 않음
  expect(dashSrc).not.toContain("const key = ci.therapist_id ?? '__none__';");
});

// AC-2: 미설정 환자 섹션 = "미지정"
test('AC-2: 지정치료사 미설정 섹션 라벨이 "미지정"', () => {
  expect(dashSrc).toContain("therapistId === '__none__'\n                  ? '미지정'");
});

// AC-3: embed 쿼리에 designated_therapist_id 추가 (selfCheckIns + reservations)
test('AC-3: check_ins / reservations embed 쿼리에 designated_therapist_id 추가됨', () => {
  expect(dashSrc).toContain("customers(name, chart_number, designated_therapist_id)");
  // 최소 2곳(selfCheckIns + timelineReservations)
  const occurrences = dashSrc.split("customers(name, chart_number, designated_therapist_id)").length - 1;
  expect(occurrences).toBeGreaterThanOrEqual(2);
});

// AC-4: 치료사별 뷰 카드 "지정" 배지
test('AC-4: 치료사별 뷰 카드에 designated_therapist_id 기반 "지정" 배지 렌더', () => {
  expect(dashSrc).toContain('ci.customers?.designated_therapist_id &&');
  expect(dashSrc).toContain('지정');
});

// AC-5: 아코디언 명단 designatedTherapistId 배지
test('AC-5: 아코디언 AccordionItem 에 designatedTherapistId + "지정" 배지', () => {
  expect(dashSrc).toContain('designatedTherapistId: string | null');
  expect(dashSrc).toContain('item.designatedTherapistId &&');
  // 가독성 — 지정치료사 이름 확보 시 표기
  expect(dashSrc).toContain('staffMap?.get(item.designatedTherapistId)?.name');
});

// AC-6: 타입 embed 필드
test('AC-6: CheckIn / Reservation customers embed 타입에 designated_therapist_id 필드 존재', () => {
  const matches = typesSrc.match(
    /customers\?: \{ name: string \| null; chart_number\?: string \| null; designated_therapist_id\?: string \| null \} \| null;/g,
  );
  // CheckIn + Reservation 두 인터페이스 모두
  expect(matches?.length).toBeGreaterThanOrEqual(2);
});
