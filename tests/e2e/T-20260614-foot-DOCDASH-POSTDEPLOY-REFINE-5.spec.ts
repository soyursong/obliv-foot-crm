/**
 * E2E spec — T-20260614-foot-DOCDASH-POSTDEPLOY-REFINE-5 (문지은 대표원장)
 * 진료 알림판(DoctorCallDashboard) post-deploy 정비 — 본 PR 스코프 = item③·item④ 만.
 *
 * 정적 소스 검증 스타일 — 인접 DOCDASH spec(CALLUX-3FIX 등) 컨벤션 동일.
 *
 * 본 PR 포함:
 *   item③ 데이터칼럼 밀도: 방·상태·이름·생년 추가 압축 + 처방 미리보기 컬럼만 확대.
 *          (대기 colgroup: 방6·상태10·이름11·생년10·처방18 / 완료 colgroup: 방6·상태11·이름12·생년11·처방18)
 *   item④ 임상경과 미리보기 셀 클릭 → 행 아래로 전체내용 펼침(읽기 토글). 재클릭 접힘(aria-expanded).
 *          대기(CallFeedRow)·완료(CompletedRow) 양쪽 동일.
 *
 * 본 PR 제외(보류):
 *   item① 손 토글 옅은색+되돌리기 = conflict HOLD(HANDSTATE-COLORCYCLE/PURPLE-STEPPER 충돌, planner 보류).
 *   item② 임상경과 진료의 dropdown blur 취소 = AC-0 surface(차트탭 vs 진료알림판) 미확정, responder 확인 대기.
 *   item⑤ 진료환자목록 미러링 = grid→table 재설계 스코프 확인(planner FOLLOWUP) + 최종 ③④ 반영 후 별도 ship.
 *
 * ⚠ GUARD: DB 무변경(색·폭·펼침 전부 표시 레이어). colgroup 합 100% 유지.
 *   기존 손 토글 ✋(HandToggle)·처방게이트·임상경과 입력(📝 singleLine)·진료의 NOT NULL 회귀 금지.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');
const DASH = () => SRC('components/doctor/DoctorCallDashboard.tsx');

// 특정 <colgroup> 블록에서 w-[N%] 폭 순서를 뽑는다.
function colWidths(block: string): number[] {
  return [...block.matchAll(/w-\[(\d+)%\]/g)].map((m) => Number(m[1]));
}

// ─────────────────────────────────────────────────────────────────────────────
// item③ — 데이터칼럼 밀도(방·상태·이름·생년 압축 + 처방 확대)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('item③ — 데이터칼럼 밀도 추가 압축', () => {
  // ⚠ T-20260614-foot-DOCPATIENTLIST-COLWIDTH-EXPAND-QUICKEDIT (AC-1) supersede: 식별군 추가 압축 → 처방·임상경과 본문 확대.
  test('대기(호출) colgroup: 식별군 압축 + 처방24·임상경과14 본문 확대, 합 100%', () => {
    const s = DASH();
    const start = s.indexOf('doctor-call-feed-table');
    const cgStart = s.indexOf('<colgroup>', start);
    const cgEnd = s.indexOf('</colgroup>', cgStart);
    const widths = colWidths(s.slice(cgStart, cgEnd));
    // 순서: 방·상태·이름·생년·차트번호·오늘시술·차트·처방·임상경과·시간
    expect(widths).toEqual([5, 9, 11, 9, 8, 9, 6, 24, 14, 5]);
    expect(widths.reduce((a, b) => a + b, 0)).toBe(100);
    // 처방(8번째)이 가장 넓은 데이터 컬럼 — 본문 확대 보장.
    expect(widths[7]).toBeGreaterThanOrEqual(Math.max(...widths.filter((_, i) => i !== 7)));
  });

  test('완료 colgroup: 식별군 압축 + 처방25·임상경과16 본문 확대, 합 100%', () => {
    const s = DASH();
    const start = s.indexOf('doctor-completed-table');
    const cgStart = s.indexOf('<colgroup>', start);
    const cgEnd = s.indexOf('</colgroup>', cgStart);
    const widths = colWidths(s.slice(cgStart, cgEnd));
    // 순서: 방·상태·이름·생년·차트번호·오늘시술·차트·처방·임상경과
    expect(widths).toEqual([5, 10, 12, 9, 8, 9, 6, 25, 16]);
    expect(widths.reduce((a, b) => a + b, 0)).toBe(100);
    expect(widths[7]).toBe(25);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// item④ — 임상경과 미리보기 셀 클릭 → 행 아래 전체내용 펼침(토글)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('item④ — 임상경과 셀 클릭 펼침 토글', () => {
  test('대기(CallFeedRow): 미리보기 셀이 클릭 버튼 + aria-expanded + 펼침행 존재', () => {
    const s = DASH();
    // 미리보기가 button 으로 바뀌고 토글 상태(aria-expanded)를 노출.
    expect(s).toContain('doctor-call-clinical-expand-btn');
    expect(s).toContain('setExpandClinical');
    // 행 아래 전체내용(읽기) 펼침행 + whitespace 보존.
    expect(s).toContain('doctor-call-clinical-expand-row');
    expect(s).toContain('doctor-call-clinical-expand');
  });

  test('완료(CompletedRow): 미리보기 셀 클릭 버튼 + 펼침행 존재', () => {
    const s = DASH();
    expect(s).toContain('doctor-completed-clinical-expand-btn');
    expect(s).toContain('doctor-completed-clinical-expand-row');
    expect(s).toContain('doctor-completed-clinical-expand');
  });

  test('펼침은 읽기 전용(전문 보존) — whitespace-pre-wrap, 입력은 별도 📝 토글 유지(회귀)', () => {
    const s = DASH();
    expect(s).toContain('whitespace-pre-wrap');
    // 입력용 임상경과(singleLine 📝) 토글은 그대로 보존 — item④ 펼침과 별개 축.
    expect(s).toContain('doctor-call-chart-inline-row');
    expect(s).toContain('doctor-completed-chart-inline-row');
    expect(s).toContain('setShowClinical');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GUARD — 손 토글·처방게이트 등 회귀 금지(본 PR은 표시 레이어만)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('GUARD — 기존 동작 회귀 금지', () => {
  test('손 토글 ✋(HandToggle)·처방완료 actionMenu 보존', () => {
    const s = DASH();
    expect(s).toContain('HandToggle');
    expect(s).toContain('actionMenu');
  });
});
