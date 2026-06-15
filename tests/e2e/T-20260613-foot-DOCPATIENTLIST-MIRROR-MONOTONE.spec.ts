/**
 * E2E spec — T-20260613-foot-DOCPATIENTLIST-MIRROR-MONOTONE
 * 진료환자목록(DoctorPatientList) — ①대기순번(queue_number=1036) 표시 칼럼 제거(차트번호 외 숫자 비표시)
 *   ②진료대시보드(DoctorCallDashboard MONOTONE) 테이블뷰 미러링.
 * (문지은 대표원장 6/13: "진료환자목록도 진료대시보드 테이블뷰 미러링해줘 중요정보 빠지지않게.
 *  초재진 왼쪽에 1036< 이건뭐임? 환자 차트번호 말고는 숫자 필요없어")
 *
 * ── 1차 선배포 범위 (항목 B = queue_number 제거) — 본 spec active ──
 *   AC-2: 대기순번(queue_number) 표시 칼럼 제거. 초/재진 배지 왼쪽 숫자(1036) 없음.
 *   AC-2: 차트번호(chartNoDisplay) 칼럼 유지 — 유일하게 남는 숫자.
 *   AC-3: queue_number 백엔드 무손상 — 타입/SELECT 유지(표시만 숨김, RPC/정렬 미변경).
 *   회귀: main 9→8칼럼 / history 8→7칼럼 grid-template 정합.
 *
 * ── 2차 (항목 A = 미러링) — DOCDASH-MONOTONE-RELAYOUT 배포 후 채움 (test.fixme placeholder) ──
 *
 * 스타일: 소스 정적 검증 — 컴포넌트가 auth/DB 의존이라 DoctorPatientList.tsx 렌더 정본을
 *   직접 읽어 grid 열 구성·queue_number span 제거·chart_number 유지를 회귀로 잡는다.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname_ = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname_, '../../src/components/doctor/DoctorPatientList.tsx');
const src = readFileSync(SRC, 'utf-8');

// 두 행 모드의 grid-template 추출 — main(9→8) / history(8→7).
const gridTemplates = [...src.matchAll(/grid-cols-\[([^\]]+)\]/g)].map((m) => m[1]);

test.describe('항목B — 대기순번(queue_number) 표시 제거 (1차 선배포)', () => {
  test('AC-2: queue_number 렌더 span이 진료환자목록 행에서 제거됨', () => {
    // 초/재진 배지 왼쪽 "1036" = {row.queue_number ?? '—'} span. 표시 렌더 0건이어야 함.
    expect(src).not.toContain('{row.queue_number ?? ');
    expect(src.includes('{row.queue_number')).toBe(false);
  });

  test('AC-2: 차트번호(chartNoDisplay) 칼럼은 유지 — 유일하게 남는 숫자', () => {
    // main + history 양쪽 행에 chart_number 표시 유지(2건).
    const chartHits = [...src.matchAll(/chartNoDisplay\(row\.chart_number\)/g)].length;
    expect(chartHits).toBeGreaterThanOrEqual(2);
    expect(src).toContain('data-testid="patient-chartno"');
  });

  test('AC-3: queue_number 백엔드 무손상 — 타입 + SELECT 유지(표시만 숨김)', () => {
    // 타입 정의에 queue_number 필드 유지(RPC/정렬/생성 로직 미변경 보증).
    expect(src).toMatch(/queue_number:\s*number\s*\|\s*null/);
    // SELECT 컬럼 목록에 queue_number 유지(데이터 fetch 무손상).
    const selectLine = src.split('\n').find((l) => l.includes("customers!customer_id(chart_number)"));
    expect(selectLine).toBeTruthy();
    expect(selectLine!).toContain('queue_number');
  });

  test('회귀: grid-template에서 선두 대기순번 칼럼(1.75rem) 제거', () => {
    // 변경 전: main = 1.75rem_3rem_5rem_4.5rem_5.5rem_3.75rem_4.75rem_minmax(0,1fr)_auto (9칼럼)
    //          history = 1.75rem_3rem_5rem_4.5rem_5.5rem_minmax(0,1fr)_auto_auto (8칼럼)
    // 변경 후: 선두 1.75rem(번호 칼럼) 사라지고 첫 칼럼=3rem(방문배지)로 시작.
    const patientGrids = gridTemplates.filter((g) => g.includes('3rem_5rem_4.5rem'));
    expect(patientGrids.length).toBeGreaterThanOrEqual(2);
    for (const g of patientGrids) {
      const cols = g.split('_');
      // 선두 칼럼이 더 이상 1.75rem(대기순번)이 아님.
      expect(cols[0]).not.toBe('1.75rem');
      expect(cols[0]).toBe('3rem');
    }
  });

  test('회귀: main 행 8칼럼 / history 행 7칼럼', () => {
    const main = gridTemplates.find((g) => g.includes('3.75rem_4.75rem')); // 상태+치료실 보유 = main
    const history = gridTemplates.find(
      (g) => g.includes('3rem_5rem_4.5rem') && !g.includes('3.75rem_4.75rem'),
    );
    expect(main).toBeTruthy();
    expect(history).toBeTruthy();
    expect(main!.split('_').length).toBe(8);
    expect(history!.split('_').length).toBe(7);
  });

  test('회귀(AC-5 보존가드): EXPAND-CLINICAL/COURSE-RXHISTORY/SIGNDOCTOR 진입점 유지', () => {
    // 미러링 1차에서 임상경과·처방이력·서명필터 표시/동작 회귀 금지(정본 마커 잔존 확인).
    expect(src).toContain('patient-row');         // 행 컴포넌트 유지
    expect(src).toContain('treatment_kind');      // 치료종류 표시 유지(history mode)
    expect(src).toContain('prescription');        // 처방 표기 유지
  });
});

test.describe('항목A — 진료대시보드(MONOTONE) 미러링 (2차, 의존 배포 후)', () => {
  // DOCDASH-MONOTONE-RELAYOUT 배포 확정 후 미러 컬럼(경과시간/오늘시술/임상경과) 정합 검증으로 채움.
  test.fixme('AC-1/4: DoctorPatientList ↔ DoctorCallDashboard(MONOTONE) 컬럼 시각 일관', () => {
    // depends_on: T-20260613-foot-DOCDASH-MONOTONE-RELAYOUT deploy-ready 이후 작성.
  });
});
