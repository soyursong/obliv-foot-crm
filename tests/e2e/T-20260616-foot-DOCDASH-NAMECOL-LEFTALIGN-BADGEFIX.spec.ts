/**
 * E2E spec — T-20260616-foot-DOCDASH-NAMECOL-LEFTALIGN-BADGEFIX (P2)
 * 진료대시보드(진료 알림판, DoctorCallDashboard) 환자이름 칼럼 미세조정.
 * 요청(문지은 대표원장, #foot):
 *   ① 환자이름 텍스트"만" 좌정렬(text-left).
 *   ② 초/재 배지가 이름 길이와 무관하게 항상 같은 위치(고정 기준점).
 *
 * 원인: [배지+이름] 그룹이 동일 가변폭 flex 컨테이너에서 justify-center(중앙정렬)되어
 *   이름이 길어질수록 그룹 전체 폭이 커져 배지가 왼쪽으로 밀림(흔들림).
 * 수정: 컨테이너 justify-center → justify-start (그룹을 셀 좌측에 앵커 → 배지 x위치 불변),
 *   이름 버튼 text-center → text-left (이름 텍스트만 좌정렬).
 *
 * 순수 presentation(CSS/JSX). DB·EF·토큰매핑·정렬로직·배지 텍스트/색상 무변경.
 * 컴포넌트가 auth/DB에 의존하므로 렌더 정본(DoctorCallDashboard.tsx)을 직접 읽어 정적 검증.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname_ = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname_, '../../src/components/doctor/DoctorCallDashboard.tsx');
const src = readFileSync(SRC, 'utf-8');

test.describe('NAMECOL-LEFTALIGN-BADGEFIX — 이름 좌정렬 + 배지 고정 위치', () => {
  test('① 이름 버튼: text-center → text-left (이름 텍스트만 좌정렬), 두 행(활성/진료완료) 모두', () => {
    // 활성 행 + 진료완료 행 두 곳의 이름 버튼이 text-left
    const leftHits = [...src.matchAll(/min-w-\[4rem\] break-keep text-left/g)].length;
    expect(leftHits).toBeGreaterThanOrEqual(2);
    // 구 좌표(text-center)로 남은 이름 버튼 0건
    expect(src).not.toContain('min-w-[4rem] break-keep text-center');
  });

  test('② 배지 고정: [배지+이름] flex 컨테이너 justify-center → justify-start (두 행 모두)', () => {
    const startHits = [...src.matchAll(/flex items-center justify-start gap-1\.5/g)].length;
    expect(startHits).toBeGreaterThanOrEqual(2);
    // 구 중앙정렬 컨테이너 잔재 0 — 이름 셀 흔들림 원인 제거
    expect(src).not.toContain('flex items-center justify-center gap-1.5');
  });
});

test.describe('회귀 — 분류/정렬/배지/차트진입 불변', () => {
  test('초/재/체 배지 매핑(텍스트·색상) 무변경', () => {
    expect(src).toContain("new: { label: '초', full: '초진', cls: 'bg-blue-100 text-blue-700' }");
    expect(src).toContain("returning: { label: '재', full: '재진', cls: 'bg-emerald-100 text-emerald-700' }");
    expect(src).toContain("experience: { label: '체', full: '체험', cls: 'bg-purple-100 text-purple-700' }");
  });

  test('이름 클릭 → 진료차트 진입(onOpenChart) 동선 + testid 보존', () => {
    expect(src).toContain('data-testid="doctor-call-name-chart-btn"');
    expect(src).toContain('data-testid="doctor-completed-name-chart-btn"');
    expect(src).toContain("onOpenChart(checkIn.customer_id, 'full')");
    expect(src).toContain('data-testid="doctor-visit-badge"');
  });

  test('SELECT(visit_type 등) 데이터 소스 무변경', () => {
    expect(src).toContain('customer_id, customer_name, visit_type, status, status_flag');
  });
});
