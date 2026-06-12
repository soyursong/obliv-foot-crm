/**
 * E2E spec — T-20260612-foot-DOCDASH-WAITELAPSED-POLISH
 * 진료부 대시보드(DoctorCallDashboard) 후속 폴리시 (문지은 대표원장).
 *   직전 부모 SECTION-RESTRUCTURE(d8c6b75) 위 표현/필터/정렬 보강. REDEFINITION_RISK=true →
 *   AC-0 회귀 rebase 의무(SECTION-RESTRUCTURE·11FIX·STATUS-SPLIT·DOCTORCALL-SORT·LABEL-RX-REFINE 보존).
 *
 * 인접 DOCDASH spec 컨벤션 동일 — 정적 소스 검증(빌드·lint 보강) + 순수 헬퍼 단위 검증.
 *
 * AC-0  회귀 rebase: 칼럼순서/flat테이블/plain-text(RESTRUCTURE), 콜경과 SSOT·HandRaiseFlow(11FIX),
 *       완료 원내잔류 처방허용·귀가차단(STATUS-SPLIT), 정렬(DOCTORCALL-SORT), 라벨·처방(LABEL-RX-REFINE) 보존.
 * AC-1  진료 대기중에서 완료(pink/completed_at) 행 + '완료 N명' 카운트 배지 완전 제거 — 근본(feed=activeCalls만).
 * AC-2  헤더 "콜경과시간" → "경과시간".
 * AC-3  경과시간 셀 "콜 후" 제거, "+N분" 분단위 표기.
 * AC-4  진료 완료 섹션 경과시간 비표시('-'/빈칸, 레이아웃 무붕괴).
 * AC-5  진료 대기중 경과시간 내림차순(급한순) 정렬. DOCTORCALL-SORT 충돌 시 본건 우선.
 * AC-6  헤더+셀 텍스트 전부 중앙정렬.
 * AC-7  처방없음 → "-".
 * AC-8  초진/재진 버튼 → "초"/"재" 한 글자(동작·색상 유지).
 * AC-9  null/NaN/undefined 노출·크래시 금지, 0건도 정상 렌더.
 *
 * 시나리오1 = 진료 대기중 완료누수 근본제거 + 경과시간 폴리시(AC-1/2/3/5).
 * 시나리오2 = 진료 완료 섹션 + 라벨/중앙정렬/안전 + AC-0 회귀(AC-4/6/7/8/9 + AC-0).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRxInClinic } from '../../src/lib/inClinicRxGate';
import {
  formatElapsedPlus,
  elapsedMinutes,
  getCallTime,
} from '../../src/lib/doctor-call-notify';
import type { CheckIn } from '../../src/lib/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');
const DASH = () => SRC('components/doctor/DoctorCallDashboard.tsx');
const NOTIFY = () => SRC('lib/doctor-call-notify.ts');

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오1 — 진료 대기중: 완료 누수 근본 제거 + 경과시간 폴리시 (AC-1/2/3/5)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오1 — AC-1 진료 대기중 완료 누수 근본 제거', () => {
  test('진료 대기중 표시 명단 feed = activeCalls(purple)만 — pink(doneCalls) 분리', () => {
    const s = DASH();
    expect(s).toContain('const feed = activeCalls;');
    // 구 누수 경로(feed = [...activeCalls, ...doneCalls]) 잔존 0
    expect(s).not.toContain('[...activeCalls, ...doneCalls]');
    expect(s).not.toContain('const doneCalls');
  });
  test("'완료 N명' 카운트 배지/텍스트 완전 제거(진료필요만 노출)", () => {
    const s = DASH();
    expect(s).toContain('진료필요 {activeCalls.length}');
    expect(s).not.toContain('완료 {doneCalls.length}');
    expect(s).not.toContain('완료 {doneCalls');
  });
  test('STATUS-SPLIT 보존(AC-0): pink 원내잔류는 삭제 아닌 진료 완료로 이전', () => {
    const s = DASH();
    expect(s).toContain("ci.completed_at || ci.status_flag === 'pink'");
  });
});

test.describe('시나리오1 — AC-2 헤더 경과시간 + AC-3 +N분', () => {
  test("헤더 '콜경과시간' → '경과시간'(양 섹션, 잔존 0)", () => {
    const s = DASH();
    expect(s).toContain('>경과시간</th>');
    expect(s).not.toContain('>콜경과시간</th>');
  });
  test('대기 셀 "+N분" 표기 = formatElapsedPlus 사용, formatSinceCall 미사용', () => {
    const s = DASH();
    expect(s).toContain('formatElapsedPlus(elapsedMinutes(getCallTime(checkIn)))');
    expect(s).not.toContain('formatSinceCall(elapsedMinutes');
  });
  test('formatElapsedPlus: "콜 후" 제거 + 분단위 "+N분"', () => {
    expect(formatElapsedPlus(0)).toBe('+0분');
    expect(formatElapsedPlus(1)).toBe('+1분');
    expect(formatElapsedPlus(12)).toBe('+12분');
    expect(formatElapsedPlus(135)).toBe('+135분'); // 시/분 분리 없음(분단위만)
    expect(formatElapsedPlus(0)).not.toContain('콜');
  });
});

test.describe('시나리오1 — AC-5 급한순(경과 내림차순) 정렬', () => {
  test('activeCalls 정렬 = getCallTime 오름차순(가장 오래 기다린=급한순 상단)', () => {
    const s = DASH();
    // 콜시각 오름차순 = 경과시간 내림차순. DOCTORCALL-SORT(내림차순) supersede.
    expect(s).toContain('.sort((a, b) => getCallTime(a).localeCompare(getCallTime(b)))');
    expect(s).not.toContain('getCallTime(b).localeCompare(getCallTime(a))'); // 구 신규상단 정렬 잔존 0(대기 명단)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오2 — 진료 완료 섹션 + 라벨/중앙정렬/안전 + AC-0 회귀 (AC-4/6/7/8/9 + AC-0)
// ─────────────────────────────────────────────────────────────────────────────
// T-20260612-foot-DOCDASH-WAITFILTER-UX7 AC-7 supersede: POLISH 의 '-' 비표시 셀을 칼럼 자체 제거로 재정의.
test.describe('시나리오2 — AC-4 → UX7 AC-7 진료 완료 경과시간 칼럼 제거', () => {
  test('완료 행 경과시간 셀/칼럼 소멸(testid 부재)', () => {
    const s = DASH();
    expect(s).not.toContain('data-testid="doctor-completed-elapsed-cell"');
    // 완료 섹션은 elapsed 계산 자체를 하지 않음(formatElapsedPlus 호출은 대기 1곳뿐)
    expect((s.match(/formatElapsedPlus\(/g) ?? []).length).toBe(1);
  });
});

test.describe('시나리오2 — AC-6 헤더+셀 중앙정렬', () => {
  test('thead tr 중앙정렬(text-center) — 좌측정렬 잔존 0', () => {
    const s = DASH();
    const theads = s.match(/<thead>[\s\S]*?<\/thead>/g) ?? [];
    expect(theads.length).toBe(2);
    for (const th of theads) expect(th).toContain('text-center');
    // 구 text-left thead 잔존 0
    expect(s).not.toContain('bg-gray-50/70 text-left');
  });
  test('데이터 셀 td 중앙정렬(px-3 py-2 text-center) 다수', () => {
    const s = DASH();
    // 8칼럼 × 2행(대기/완료) 대부분 text-center — 최소 12개 이상 보강
    // FULLWIDTH-INLINE-EMOJI AC-1: 셀 여백 px-3→px-2 축소.
    expect((s.match(/px-2 py-2 text-center/g) ?? []).length).toBeGreaterThanOrEqual(12);
  });
});

test.describe('시나리오2 — AC-7 처방없음 "-"', () => {
  test("완료 행 미처방 표기 '처방 없음' → '-'", () => {
    const s = DASH();
    expect(s).toContain('data-testid="doctor-completed-no-rx"');
    expect(s).not.toContain('처방 없음');
  });
});

test.describe('시나리오2 — AC-8 한 글자 레이블(초/재/체)', () => {
  test('VisitBadge label 초/재/체 + 색상(cls) 유지', () => {
    const s = DASH();
    expect(s).toContain("new: { label: '초', full: '초진', cls: 'bg-blue-100 text-blue-700' }");
    expect(s).toContain("returning: { label: '재', full: '재진', cls: 'bg-emerald-100 text-emerald-700' }");
    expect(s).toContain("experience: { label: '체', full: '체험', cls: 'bg-purple-100 text-purple-700' }");
    // 풀네임 hover(title) 안전 제공
    expect(s).toContain('title={full}');
  });
});

test.describe('시나리오2 — AC-9 null/NaN/undefined 안전 + 0건 렌더', () => {
  test('elapsedMinutes NaN/음수 방어 → formatElapsedPlus 0 폴백', () => {
    expect(formatElapsedPlus(elapsedMinutes('not-a-date'))).toBe('+0분');
    expect(formatElapsedPlus(elapsedMinutes('2026-06-12T00:00:00+09:00', 0))).toBe('+0분'); // 미래시각=음수→0
    expect(formatElapsedPlus(Number.NaN)).toBe('+0분');
    expect(formatElapsedPlus(-5)).toBe('+0분');
  });
  test('NOTIFY: formatElapsedPlus export + Number.isFinite 가드', () => {
    const n = NOTIFY();
    expect(n).toContain('export function formatElapsedPlus');
    expect(n).toContain('Number.isFinite(min)');
  });
  test('양 섹션 0건 빈상태 메시지 + 헤더 항상 렌더(DOM 소멸 없음)', () => {
    const s = DASH();
    expect(s).toContain('오늘 진료 호출이 아직 없어요.');
    expect(s).toContain('아직 진료 완료된 환자가 없어요.');
    expect(s.indexOf('>진료 대기중</span>')).toBeLessThan(s.indexOf('오늘 진료 호출이 아직 없어요.'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오2 — AC-0 회귀(직전 deployed 동작 보존)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오2 — AC-0 회귀 rebase(부모 동작 보존)', () => {
  test('STATUS-SPLIT: 완료(pink) 원내잔류 처방 허용 / 귀가(done) 차단(SSOT 보존)', () => {
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
  test('11FIX: 임상경과 미리보기(useCompletedClinicalProgress/clinicalPreview) 보존', () => {
    const s = DASH();
    expect(s).toContain('useCompletedClinicalProgress');
    expect(s).toContain('clinicalPreview');
  });
  // UX7 AC-7 supersede: 완료 섹션 경과시간 제거로 양 섹션 비대칭(호출 8 / 완료 7). flat 테이블 구조·순서는 보존.
  test('RESTRUCTURE: flat 테이블 보존 — 호출 8칼럼 / 완료 7칼럼(UX7 AC-7)', () => {
    const s = DASH();
    const colgroups = s.match(/<colgroup>[\s\S]*?<\/colgroup>/g) ?? [];
    const theads = s.match(/<thead>[\s\S]*?<\/thead>/g) ?? [];
    expect(colgroups.length).toBe(2);
    expect((colgroups[0].match(/<col /g) ?? []).length).toBe(8);
    expect((colgroups[1].match(/<col /g) ?? []).length).toBe(7);
    expect(theads.length).toBe(2);
    expect((theads[0].match(/<th /g) ?? []).length).toBe(8);
    expect((theads[1].match(/<th /g) ?? []).length).toBe(7);
    expect(s).toContain('const DOCDASH_COLSPAN = 8');
    expect(s).toContain('const DOCDASH_COMPLETED_COLSPAN = 7');
    expect((s.match(/colSpan=\{DOCDASH_COLSPAN\}/g) ?? []).length).toBe(2);
    expect((s.match(/colSpan=\{DOCDASH_COMPLETED_COLSPAN\}/g) ?? []).length).toBe(2);
  });
  test('완료 행: 귀가/귀가 대기 상태 + discharge 게이트 보존', () => {
    const s = DASH();
    expect(s).toContain("{discharged ? '귀가' : '귀가 대기'}");
    expect(s).toContain('data-testid="doctor-completed-discharge-status"');
  });
});

// completedPatients 정렬 폴백(pink 이전 환자, completed_at null) 순수 검증 — getCallTime 사용 확인
test.describe('보강 — completedPatients 정렬키 폴백(completed_at ?? getCallTime)', () => {
  test('소스가 completed_at ?? getCallTime 내림차순 정렬키 사용', () => {
    const s = DASH();
    expect(s).toContain('(b.completed_at ?? getCallTime(b)).localeCompare(a.completed_at ?? getCallTime(a))');
  });
  test('getCallTime 폴백 = checked_in_at(이력 없을 때) — pink 환자도 정렬 안전', () => {
    const ci = { status_flag_history: null, checked_in_at: '2026-06-12T01:00:00+09:00' } as unknown as CheckIn;
    expect(getCallTime(ci)).toBe('2026-06-12T01:00:00+09:00');
  });
});
