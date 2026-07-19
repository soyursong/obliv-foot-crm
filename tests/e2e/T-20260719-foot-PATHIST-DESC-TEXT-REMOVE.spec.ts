/**
 * E2E Spec — T-20260719-foot-PATHIST-DESC-TEXT-REMOVE (P1, planner / 김주연 총괄 풋센터)
 *
 * 치료테이블 > '진료 환자 이력' 탭:
 *   불필요한 설명(안내) 문구 2블록을 완전 제거(현장 피드백). FE-only·데이터/기능 무접점.
 *
 * 삭제 대상 (verbatim, MSG-20260719-161106-9jre):
 *   1) 탭 상단: "선택 날짜에 원장 진료콜 명단에 오른 환자입니다. 처방전·소견/진단서 신청·발행 여부를 표시합니다."
 *   2) 탭 하단 ※블록 2줄:
 *      "※ 소견·진단서는 신청(코디팀 요청)과 발행(원장 발행)을 각각 O/X로 표시합니다. 발행 문서 내용 보기(뷰어)는 …"
 *      "※ 진료완료 환자, 그리고 상태변경을 푼(상태해제) 환자는 … [진료완료] 섹션(당일 열람 전용)으로 이동해 보존 …"
 *
 * AC:
 *   AC-1: 상단 안내 문구가 소스에서 완전히 사라진다.
 *   AC-2: 하단 ※ 설명 블록 2줄이 소스에서 완전히 사라진다.
 *   AC-3: 기능 요소(진료 환자 이력 제목, O/X 배지 IssueBadge, [진료완료] done 섹션, 상태해제 배지)는 유지 — 회귀 0.
 *   AC-4: 데이터/쿼리 레이어(useDoctorHistory, form_submissions/check_ins 조회) 무접점.
 *
 * 구성: 정적 소스 가드(readFileSync + 문구 부재/기능 잔존 단언).
 *
 * 실행: npx playwright test T-20260719-foot-PATHIST-DESC-TEXT-REMOVE.spec.ts
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SECTION_SRC = () =>
  readFileSync(join(HERE, '../../src/components/treatment/DoctorHistorySection.tsx'), 'utf-8');

test.describe('T-20260719-foot-PATHIST-DESC-TEXT-REMOVE — 진료 환자 이력 설명 문구 삭제', () => {
  test('AC-1: 상단 안내 문구가 제거되었다', () => {
    const src = SECTION_SRC();
    expect(src).not.toContain('선택 날짜에 원장 진료콜 명단에 오른 환자입니다');
    expect(src).not.toContain('처방전·소견/진단서 신청·발행 여부를 표시합니다');
  });

  test('AC-2: 하단 ※ 설명 블록 2줄이 제거되었다', () => {
    const src = SECTION_SRC();
    // 삭제대상2 - 1줄
    expect(src).not.toContain('신청</b>(코디팀 요청)과');
    expect(src).not.toContain('발행 문서 내용 보기(뷰어)는 표시 방식 확정 후 제공됩니다');
    // 삭제대상2 - 2줄
    expect(src).not.toContain('상단 목록에서 하단 <b>[진료완료]</b> 섹션(당일 열람 전용)으로 이동해 보존');
    expect(src).not.toContain('상태를 다시 지정하면 상단 활성 명단으로 복귀합니다');
  });

  test('AC-3: 기능 요소는 유지된다(회귀 0)', () => {
    const src = SECTION_SRC();
    // 제목 유지
    expect(src).toContain('진료 환자 이력');
    // O/X 배지 컴포넌트 유지
    expect(src).toContain('function IssueBadge');
    expect(src).toContain('dh-opinion-request');
    expect(src).toContain('dh-opinion-issue');
    // 하단 [진료완료] 보존 섹션 유지
    expect(src).toContain('doctor-history-done-section');
    // 상태해제 배지(기능/라벨) 유지 — 안내 문구만 삭제, 배지 자체는 유지
    expect(src).toContain('dh-done-released-badge');
    expect(src).toContain('상태해제');
  });

  test('AC-4: 데이터/쿼리 레이어 무접점(회귀 0)', () => {
    const src = SECTION_SRC();
    // 조회 쿼리·파생 함수 유지
    expect(src).toContain('useDoctorHistory');
    expect(src).toContain("from('check_ins')");
    expect(src).toContain("from('form_submissions')");
    expect(src).toContain('computeDocStatusSummary');
    expect(src).toContain('splitByCompletion');
  });
});
