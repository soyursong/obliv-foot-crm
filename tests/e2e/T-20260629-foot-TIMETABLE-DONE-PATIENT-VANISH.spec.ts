/**
 * T-20260629-foot-TIMETABLE-DONE-PATIENT-VANISH
 * CRM 대시보드 통합시간표에서 [완료] 전환 시 환자 명단이 사라지던 버그 픽스.
 *
 * 원인: fetchSelfCheckIns 가 status in ('cancelled','done') 을 제외 → 새로고침/Realtime 재조회 시
 *       완료 환자가 통합시간표에서 사라져 그날 기록 소실(현장 신고).
 * 수정: fetch 제외를 'cancelled' 만으로 축소 → 'done'(완료) 포함. 완료 건은 byStatus['done'] 로
 *       라우팅되어 우측 [완료] 단독 컬럼(renderDoneColumn)에만 표시되고, 활성 슬롯/드래그/초과시간
 *       알림(active 필터에서 done 별도 제외)·정렬에는 영향 없음. 완료 카운트는 doneEverSet 과
 *       Set union(dedup) → 중복 집계 없음. 조회 범위 당일(checked_in_at) 한정 → 무한 누적 없음.
 *
 * NO-DDL: reservations/check_ins 스키마·데이터 무변경(쿼리 필터만 보정).
 *
 * 검증(소스 권위):
 *  AC-1(완료 잔존): fetch 가 done 을 더 이상 제외하지 않음.
 *  AC-2(완료 구분): [완료] 단독 컬럼 렌더 경로(slot-col-done) 생존 + done 회색 스타일.
 *  AC-3(회귀): active 초과시간 필터가 여전히 done 제외 / byStatus 는 상태별 정확 라우팅.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const DASH = fs.readFileSync(path.resolve('src/pages/Dashboard.tsx'), 'utf-8');
const STATUS = fs.readFileSync(path.resolve('src/lib/status.ts'), 'utf-8');

test.describe('S1: fetch 가 완료(done) 환자를 잔존시킴 (AC-1)', () => {
  test('S1-1: fetchSelfCheckIns 제외 필터가 cancelled 단독 (done 미제외)', () => {
    expect(DASH, 'done 이 여전히 fetch 에서 제외됨').not.toContain(`.not('status', 'in', '("cancelled","done")')`);
    expect(DASH, 'cancelled 단독 제외로 보정되지 않음').toContain(`.not('status', 'in', '("cancelled")')`);
  });

  test('S1-2: 픽스 마커 주석 존재', () => {
    expect(DASH).toContain('T-20260629-foot-TIMETABLE-DONE-PATIENT-VANISH');
  });
});

test.describe('S2: 완료 건 구분 표시 ([완료] 단독 컬럼) (AC-2)', () => {
  test('S2-1: 완료 단독 컬럼 렌더 경로 생존', () => {
    expect(DASH, '완료 컬럼 testid 소실').toContain('slot-col-done');
    expect(DASH, '완료 컬럼 라벨 소실').toContain('label="완료"');
  });

  test('S2-2: done 상태 회색 스타일(시각 구분) 유지', () => {
    expect(STATUS).toContain("done: '완료'");
    expect(STATUS).toMatch(/done:\s*'bg-gray-200 text-gray-500'/);
  });
});

test.describe('S3: 회귀 가드 (AC-3) — 활성 슬롯/알림 무영향', () => {
  test('S3-1: 초과시간 알림 active 필터가 여전히 done/cancelled 제외', () => {
    expect(DASH, 'active 필터에서 done 제외 소실 → 완료건 오버타임 오알림 위험')
      .toContain("rows.filter((r) => r.status !== 'done' && r.status !== 'cancelled')");
  });

  test('S3-2: byStatus 는 상태값별 정확 라우팅(done 은 done 그룹에만)', () => {
    // map[r.status] 로 정확 라우팅 → done 카드는 byStatus['done'] 에만 들어가 활성 컬럼 오염 없음
    expect(DASH).toContain('(map[r.status] ??= []).push(r);');
  });

  test('S3-3: filtered 는 취소만 제외(완료 포함) → 완료 카드가 byStatus 에 도달', () => {
    expect(DASH).toContain("rows.filter((r) => r.status !== 'cancelled')");
  });
});
