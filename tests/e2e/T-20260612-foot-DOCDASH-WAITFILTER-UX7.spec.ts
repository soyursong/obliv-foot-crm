/**
 * E2E spec — T-20260612-foot-DOCDASH-WAITFILTER-UX7
 * 진료부 대시보드(DoctorCallDashboard) 실사용 후속 정정 (문지은 대표원장).
 *   직전 SECTION-RESTRUCTURE(d8c6b75) 배포자 본인 정정 + 형제 WAITELAPSED-POLISH(cde6850) 위 가산.
 *   P1 버그(완료 환자/카운트 대기섹션 잔류) 1건 + UX 7건. REDEFINITION_RISK=true →
 *   AC-0 회귀 rebase 의무(SECTION-RESTRUCTURE·11FIX·STATUS-SPLIT·POLISH 보존).
 *
 * 인접 DOCDASH spec 컨벤션 동일 — 정적 소스 검증 + 순수 헬퍼 단위 검증.
 *
 * AC-1  진료 대기중 리스트 + 카운트 모두 완료(pink/completed_at) 환자 제외(근본 feed=activeCalls만).
 * AC-2  헤더 "콜경과시간" → "경과시간".
 * AC-3  경과시간 셀 "콜 후" 제거 → "+N분" 분단위.
 * AC-4  호출 섹션 경과시간 내림차순(급한순) 정렬.
 * AC-5  전체 칼럼 헤더+셀 중앙정렬(text-center).
 * AC-6  처방 칼럼 "처방없음" → "-".
 * AC-7  진료 완료 섹션 경과시간 칼럼 '제거'(POLISH '-' 비표시를 supersede). 호출 섹션은 유지.
 * AC-8  초진/재진 버튼 → "초"/"재" 한 글자(동작·바인딩 불변).
 *
 * 시나리오1 = 대기섹션 완료환자/카운트 제외(AC-1).
 * 시나리오2 = UX 표시 검증(AC-2~8).
 * 시나리오3 = AC-0 회귀(직전 deployed 동작 보존).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRxInClinic } from '../../src/lib/inClinicRxGate';
import { formatElapsedPlus, elapsedMinutes, getCallTime } from '../../src/lib/doctor-call-notify';
import type { CheckIn } from '../../src/lib/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');
const DASH = () => SRC('components/doctor/DoctorCallDashboard.tsx');

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오1 — 대기섹션 완료환자/카운트 제외 (AC-1)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오1 — AC-1 진료 대기중 완료환자/카운트 제외', () => {
  test('대기 feed = activeCalls(purple, !completed_at)만 — 완료 누수 0', () => {
    const s = DASH();
    expect(s).toContain('const feed = activeCalls;');
    expect(s).toContain("ci.status_flag === 'purple' && !ci.completed_at");
    // 구 누수 경로(완료 행 이어붙임) 잔존 0
    expect(s).not.toContain('[...activeCalls, ...doneCalls]');
    expect(s).not.toContain('const doneCalls');
  });
  test('대기섹션 카운트 = activeCalls.length(완료 미포함) — "완료 N명" 위젯 0', () => {
    const s = DASH();
    expect(s).toContain('진료필요 {activeCalls.length}');
    expect(s).not.toContain('완료 {doneCalls');
    // 카운트가 미필터 rows.length 를 참조하지 않음
    expect(s).not.toContain('rows.length}명');
  });
  test('완료 환자는 진료 완료 섹션에만(completed_at || pink) — STATUS-SPLIT 보존', () => {
    const s = DASH();
    expect(s).toContain("ci.completed_at || ci.status_flag === 'pink'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오2 — UX 표시 검증 (AC-2~8)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오2 — UX 표시(AC-2~8)', () => {
  test('AC-2 헤더 "경과시간"(콜경과시간 잔존 0)', () => {
    const s = DASH();
    expect(s).toContain('>경과시간</th>');
    expect(s).not.toContain('>콜경과시간</th>');
  });
  test('AC-3 경과시간 셀 "+N분"(콜 후 제거) = formatElapsedPlus', () => {
    const s = DASH();
    expect(s).toContain('formatElapsedPlus(elapsedMinutes(getCallTime(checkIn)))');
    expect(s).not.toContain('formatSinceCall(elapsedMinutes');
    expect(formatElapsedPlus(0)).toBe('+0분');
    expect(formatElapsedPlus(30)).toBe('+30분');
    expect(formatElapsedPlus(30)).not.toContain('콜');
  });
  test('AC-4 호출 섹션 경과시간 내림차순(급한순=콜시각 오름차순)', () => {
    const s = DASH();
    expect(s).toContain('.sort((a, b) => getCallTime(a).localeCompare(getCallTime(b)))');
    // 구 신규상단(내림차순) 잔존 0 — 대기 명단
    expect(s).not.toContain('getCallTime(b).localeCompare(getCallTime(a))');
  });
  test('AC-5 헤더 thead 2벌 모두 중앙정렬(text-center) — text-left 잔존 0', () => {
    const s = DASH();
    const theads = s.match(/<thead>[\s\S]*?<\/thead>/g) ?? [];
    expect(theads.length).toBe(2);
    for (const th of theads) expect(th).toContain('text-center');
    expect(s).not.toContain('bg-gray-50/70 text-left');
    // 데이터 셀 중앙정렬 다수 — FULLWIDTH-INLINE-EMOJI AC-1: 셀 여백 px-3→px-2 축소.
    expect((s.match(/px-2 py-2 text-center/g) ?? []).length).toBeGreaterThanOrEqual(12);
  });
  test('AC-6 처방 빈값 "-"(처방 없음 텍스트 0)', () => {
    const s = DASH();
    expect(s).toContain('data-testid="doctor-completed-no-rx"');
    expect(s).not.toContain('처방 없음');
  });
  test('AC-7 진료 완료 섹션 경과시간 칼럼 제거(호출 8 / 완료 7)', () => {
    const s = DASH();
    // 완료 셀 testid 소멸
    expect(s).not.toContain('data-testid="doctor-completed-elapsed-cell"');
    // 완료 thead 7칼럼, 경과시간 제거된 순서
    const compThead = s.slice(s.indexOf('doctor-completed-table'), s.indexOf('doctor-completed-rows'));
    expect((compThead.match(/<th /g) ?? []).length).toBe(7);
    const compOrder = (compThead.match(/>([가-힣]+)<\/th>/g) ?? []).map((m) => m.replace(/[<>/th]/g, ''));
    // CHARTNO-COL-SPLIT-P1(차트번호 칼럼) + FULLWIDTH-INLINE-EMOJI AC-3(진료차트 칼럼 제거).
    expect(compOrder).toEqual(['이름', '차트번호', '상태', '방', '오늘시술', '처방', '임상경과']);
    // 호출 thead 는 경과시간 유지(8칼럼)
    const callThead = s.slice(s.indexOf('doctor-call-feed-table'), s.indexOf('doctor-call-feed-rows'));
    expect((callThead.match(/<th /g) ?? []).length).toBe(8);
    expect(callThead).toContain('>경과시간</th>');
    // colspan 분리(호출 8 / 완료 7)
    expect(s).toContain('const DOCDASH_COMPLETED_COLSPAN = 7');
    expect((s.match(/colSpan=\{DOCDASH_COMPLETED_COLSPAN\}/g) ?? []).length).toBe(2);
  });
  test('AC-8 초진/재진 버튼 라벨 "초"/"재"(동작·색상·title 풀이 유지)', () => {
    const s = DASH();
    expect(s).toContain("new: { label: '초', full: '초진', cls: 'bg-blue-100 text-blue-700' }");
    expect(s).toContain("returning: { label: '재', full: '재진', cls: 'bg-emerald-100 text-emerald-700' }");
    expect(s).toContain('title={full}');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오3 — AC-0 회귀(직전 deployed 동작 보존)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오3 — AC-0 회귀 rebase', () => {
  test('STATUS-SPLIT: 완료(pink) 원내잔류 처방 허용 / 귀가(done) 차단', () => {
    const today = '2026-06-12';
    const base = { checked_in_at: `${today}T01:00:00+09:00` };
    expect(checkRxInClinic({ ...base, status: 'done' }, today).reason).toBe('discharged');
    expect(
      checkRxInClinic({ ...base, status: 'treatment_waiting', status_flag: 'pink' }, today).allowed,
    ).toBe(true);
  });
  test('11FIX: HandRaiseFlow 2단계 + applyStatusFlagTransition(pink) 전이 1곳(신설 write 0)', () => {
    const s = DASH();
    expect(s).toContain('<HandRaiseFlow');
    expect(s).toContain("applyStatusFlagTransition(checkIn, 'pink', actor)");
    expect((s.match(/applyStatusFlagTransition\(checkIn/g) ?? []).length).toBe(1);
  });
  test('방번호(getAssignedSlotName)·처방·임상경과 미리보기 보존', () => {
    const s = DASH();
    expect(s).toContain('getAssignedSlotName(checkIn)');
    expect(s).toContain('useCompletedClinicalProgress');
    expect(s).toContain('clinicalPreview');
    expect(s).toContain('data-testid="doctor-completed-room-cell"');
  });
  test('진료 완료 카운트(명수)·빈상태 메시지 보존 — DB write 0', () => {
    const s = DASH();
    expect(s).toContain('{completedPatients.length}명');
    expect(s).toContain('아직 진료 완료된 환자가 없어요.');
  });
  test('경과시간 헬퍼 NaN/음수/null 방어(0 폴백)', () => {
    expect(formatElapsedPlus(elapsedMinutes('not-a-date'))).toBe('+0분');
    expect(formatElapsedPlus(Number.NaN)).toBe('+0분');
    expect(formatElapsedPlus(-5)).toBe('+0분');
  });
});
