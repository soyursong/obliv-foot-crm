/**
 * E2E spec — T-20260612-foot-DOCDASH-SECTION-RESTRUCTURE
 * 진료부 대시보드(DoctorCallDashboard) 진료 호출 알람 + 진료완료 섹션 전면 UI 재구성 + 대기/완료 필터링 버그
 * (문지은 대표원장, REDEFINITION_RISK=true — 11FIX·TABLEVIEW-CONVERGE·STATUS-SPLIT·TABLE-BTN-MINIMIZE 레이아웃 supersede).
 *
 * 인접 DOCDASH spec 컨벤션 동일 — 정적 소스 검증(빌드·lint 보강) + 순수 헬퍼 단위 검증.
 *
 * AC-0  회귀 rebase: 콜경과(11FIX AC-7)·손들기2단계(AC-8)·귀가상태(AC-10)·임상경과 미리보기(AC-11)·
 *       STATUS-SPLIT(완료 원내잔류 처방 허용·귀가 차단)·방이름 SSOT 동작 보존(레이아웃만 재배치).
 * AC-1  필터링 버그: 진료 대기중(호출) 섹션에서 completed_at 보유 환자 제외(!completed_at) → '진료 완료'에만.
 * AC-2  섹션 제목 "진료 대기중" / "진료 완료".
 * AC-3  양 섹션 테두리 제거(flat) + colgroup/thead 글자 그대로 동일(칼럼 너비/스키마 완전 동일).
 * AC-4  칼럼 순서(변경 불가): 이름|상태|콜경과시간|방|오늘시술|처방|임상경과|진료차트.
 *       임상경과 버튼은 임상경과 칼럼 내부, 진료차트 버튼은 진료차트 칼럼 신설.
 * AC-5  숫자/카운트(방번호·카운트) plain text — Badge/Button 금지.
 * AC-6  안전/회귀: null/"undefined" 미노출(빈 값 "—"), 양 섹션 0건 빈상태 정상 렌더.
 *
 * 시나리오1=필터링버그 / 시나리오2=칼럼 스펙 / 시나리오3=회귀.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAssignedSlotName } from '../../src/lib/checkin-slot';
import { checkRxInClinic } from '../../src/lib/inClinicRxGate';
import { formatElapsedPlus } from '../../src/lib/doctor-call-notify';
import type { CheckIn } from '../../src/lib/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');
const DASH = () => SRC('components/doctor/DoctorCallDashboard.tsx');

// T-20260612-foot-DOCDASH-WAITELAPSED-POLISH(후속) supersede: 헤더 '콜경과시간' → '경과시간'(AC-2).
// T-20260612-foot-CHARTNO-COL-SPLIT-P1: 이름 옆 '차트번호' 독립 칼럼 추가.
// T-20260612-foot-DOCDASH-FULLWIDTH-INLINE-EMOJI AC-3: '진료차트' 칼럼 제거(이름 옆 🩺 이모지 버튼으로 이동).
//   → 대기 8칼럼: 이름·차트번호·상태·경과시간·방·오늘시술·처방·임상경과.
const NEW_ORDER = ['이름', '차트번호', '상태', '경과시간', '방', '오늘시술', '처방', '임상경과'];

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오1 — AC-1 필터링 버그(진료 대기중에서 completed_at 제외)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오1 — AC-1 필터링 버그(완료 환자 대기중 누수 제거)', () => {
  test('activeCalls(purple) 필터에 !completed_at 추가', () => {
    expect(DASH()).toContain("ci.status_flag === 'purple' && !ci.completed_at");
  });
  // T-20260612-WAITELAPSED-POLISH supersede(AC-1): pink(doneCalls)는 진료 대기중 feed 에서 완전 분리 →
  //   '진료 완료' 섹션으로 이전(STATUS-SPLIT 처방허용 보존). feed = activeCalls 만.
  test('진료 대기중 표시 명단 = activeCalls(purple)만 (pink 누수 제거)', () => {
    expect(DASH()).toContain('const feed = activeCalls;');
  });
  test('completedPatients(진료 완료) 필터 = completed_at 보유 OR pink(원내잔류 이전)', () => {
    expect(DASH()).toContain("ci.completed_at || ci.status_flag === 'pink'");
  });
  test('GUARD: status 전이/write 미변경 — 실제 전이 호출은 진료완료 버튼 1곳만(표시 분류만 수정)', () => {
    const s = DASH();
    // import 라인 제외, 실제 호출(인자 동반)만 카운트 → 신설 write 0.
    expect((s.match(/applyStatusFlagTransition\(checkIn/g) ?? []).length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오2 — AC-2~5 칼럼 스펙
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오2 — AC-2 섹션 제목', () => {
  test('"진료 대기중" / "진료 완료" 제목 + 구 제목 잔존 0', () => {
    const s = DASH();
    expect(s).toContain('>진료 대기중</span>');
    expect(s).toContain('>진료 완료</span>');
    expect(s).not.toContain('>진료 호출 알람</span>');
    expect(s).not.toContain('>진료 완료 환자</span>');
  });
});

test.describe('시나리오2 — AC-3 flat + 칼럼 너비/스키마 동일', () => {
  test('양 섹션 테두리 제거(rounded-xl border 카드 잔존 0)', () => {
    const s = DASH();
    expect(s).not.toContain('rounded-xl border border-red-200');
    expect(s).not.toContain('<section className="rounded-xl border"');
    // 두 섹션 모두 flat(bg-white) section
    expect(s).toContain('<section className="bg-white" data-testid="doctor-call-feed">');
    expect(s).toContain('<section className="bg-white" data-testid="doctor-completed-section">');
  });
  // T-20260612-foot-DOCDASH-WAITFILTER-UX7 AC-7 supersede: 완료 섹션 경과시간 칼럼 제거 →
  //   호출=8칼럼 / 완료=7칼럼. 더 이상 양 섹션 colgroup/thead 글자 동일 아님(섹션별 독립).
  test('colgroup: 호출 8칼럼 / 완료 7칼럼(UX7 AC-7 경과시간 제거)', () => {
    const s = DASH();
    const colgroups = s.match(/<colgroup>[\s\S]*?<\/colgroup>/g) ?? [];
    expect(colgroups.length).toBe(2);
    expect((colgroups[0].match(/<col /g) ?? []).length).toBe(8); // 호출
    expect((colgroups[1].match(/<col /g) ?? []).length).toBe(7); // 완료(경과시간 제거)
  });
  test('thead: 호출 8칼럼 / 완료 7칼럼(UX7 AC-7)', () => {
    const s = DASH();
    const theads = s.match(/<thead>[\s\S]*?<\/thead>/g) ?? [];
    expect(theads.length).toBe(2);
    expect((theads[0].match(/<th /g) ?? []).length).toBe(8); // 호출
    expect((theads[1].match(/<th /g) ?? []).length).toBe(7); // 완료(경과시간 제거)
  });
});

test.describe('시나리오2 — AC-4 칼럼 순서(변경 불가)', () => {
  test('대기 테이블 헤더 순서 = 이름|차트번호|상태|경과시간|방|오늘시술|처방|임상경과(진료차트 칼럼 제거)', () => {
    const s = DASH();
    const thead = s.slice(s.indexOf('doctor-call-feed-table'), s.indexOf('doctor-call-feed-rows'));
    const order = (thead.match(/>([가-힣]+)<\/th>/g) ?? []).map((m) => m.replace(/[<>/th]/g, ''));
    expect(order).toEqual(NEW_ORDER);
  });
  // UX7 AC-7 supersede: 완료 테이블은 경과시간 칼럼 제거 → NEW_ORDER 에서 '경과시간' 뺀 7칼럼.
  test('진료완료 테이블 헤더 순서 = 경과시간 제거 7칼럼(UX7 AC-7)', () => {
    const s = DASH();
    const thead = s.slice(s.indexOf('doctor-completed-table'), s.indexOf('doctor-completed-rows'));
    const order = (thead.match(/>([가-힣]+)<\/th>/g) ?? []).map((m) => m.replace(/[<>/th]/g, ''));
    expect(order).toEqual(NEW_ORDER.filter((c) => c !== '경과시간'));
  });
  test('임상경과 버튼은 임상경과 칼럼 내부(toggle showClinical)', () => {
    const s = DASH();
    expect(s).toContain('data-testid="doctor-call-chart-btn"');
    expect(s).toContain('data-testid="doctor-completed-chart-btn"');
  });
  // FULLWIDTH-INLINE-EMOJI AC-2/AC-3: 진료차트 전용 칼럼 → 이름 옆 🩺 이모지 버튼으로 이동(testid·full chart 오픈 동선 보존).
  test('진료차트 진입(full chart 오픈) 버튼 보존 — 이름 옆 이모지 버튼으로 이동', () => {
    const s = DASH();
    expect(s).toContain('data-testid="doctor-call-fullchart-btn"');
    expect(s).toContain('data-testid="doctor-completed-fullchart-btn"');
  });
  // UX7 AC-7 supersede: 완료 인라인 행 colSpan = DOCDASH_COMPLETED_COLSPAN(7). 호출 인라인 = DOCDASH_COLSPAN(8).
  test('인라인 펼침 행 colSpan 정합(호출 8 / 완료 7)', () => {
    const s = DASH();
    expect(s).toContain('const DOCDASH_COLSPAN = 8');
    expect(s).toContain('const DOCDASH_COMPLETED_COLSPAN = 7');
    // 호출(대기) 인라인 2행 = DOCDASH_COLSPAN, 완료 인라인 2행 = DOCDASH_COMPLETED_COLSPAN
    expect((s.match(/colSpan=\{DOCDASH_COLSPAN\}/g) ?? []).length).toBe(2);
    expect((s.match(/colSpan=\{DOCDASH_COMPLETED_COLSPAN\}/g) ?? []).length).toBe(2);
    // 구 하드코딩 colSpan(5/6) 잔존 0
    expect(s).not.toContain('colSpan={5}');
    expect(s).not.toContain('colSpan={6}');
  });
});

test.describe('시나리오2 — AC-5 숫자/카운트 plain text', () => {
  test('섹션 카운트 배지(rounded-full bg-...) 제거 → plain text', () => {
    const s = DASH();
    expect(s).not.toContain('rounded-full bg-red-100');
    expect(s).not.toContain('rounded-full bg-emerald-100');
    expect(s).toContain('진료필요 {activeCalls.length}');
    expect(s).toContain('{completedPatients.length}명');
  });
  test('방 셀은 배지/버튼 아님(span plain text + getAssignedSlotName)', () => {
    const s = DASH();
    expect(s).toContain('data-testid="doctor-call-room-cell"');
    // 방 셀에 button/Badge wrapper 미사용 — getAssignedSlotName 결과를 span 으로만
    expect(s).toContain('const slotName = getAssignedSlotName(checkIn)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오3 — AC-0/AC-6 회귀 보존
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오3 — AC-0 회귀(직전 deployed 동작 보존)', () => {
  // UX7 AC-7 supersede(POLISH AC-4 재정의): 대기 섹션 formatElapsedPlus("+N분") 1곳,
  //   진료 완료 섹션은 경과시간 칼럼 자체 제거(셀 testid 도 소멸).
  test('경과시간: 대기 섹션 formatElapsedPlus 사용 + 완료 섹션 칼럼 제거', () => {
    const s = DASH();
    expect((s.match(/formatElapsedPlus\(elapsedMinutes\(getCallTime\(checkIn\)\)\)/g) ?? []).length).toBe(1);
    expect(s).not.toContain('data-testid="doctor-completed-elapsed-cell"');
    expect(formatElapsedPlus(0)).toBe('+0분');
    expect(formatElapsedPlus(12)).toBe('+12분');
  });
  test('손들기 2단계(11FIX AC-8): HandRaiseFlow + applyStatusFlagTransition(pink) 보존', () => {
    const s = DASH();
    expect(s).toContain('<HandRaiseFlow');
    expect(s).toContain("applyStatusFlagTransition(checkIn, 'pink', actor)");
  });
  test('귀가 상태(11FIX AC-10): 귀가/귀가 대기 + discharge 게이트 보존', () => {
    const s = DASH();
    expect(s).toContain("{discharged ? '귀가' : '귀가 대기'}");
    expect(s).toContain('data-testid="doctor-completed-discharge-status"');
  });
  test('임상경과 미리보기(11FIX AC-11): 진료완료 한정 clinicalPreview + useCompletedClinicalProgress', () => {
    const s = DASH();
    expect(s).toContain('useCompletedClinicalProgress');
    expect(s).toContain('clinicalPreview');
  });
  test('STATUS-SPLIT: 완료(pink) 원내잔류 처방 허용 / 귀가(done) 차단(SSOT 보존)', () => {
    const today = '2026-06-12';
    const base = { checked_in_at: `${today}T01:00:00+09:00` };
    expect(checkRxInClinic({ ...base, status: 'done' }, today).reason).toBe('discharged');
    expect(checkRxInClinic({ ...base, status: 'treatment_waiting', status_flag: 'pink' }, today).allowed).toBe(true);
  });
});

test.describe('시나리오3 — 방 칼럼 SSOT(ROOM-LABEL CRITICAL: preconditioning→treatment_room)', () => {
  const base = {
    id: 'x', customer_id: 'c', customer_name: 'n', visit_type: 'returning',
    consultation_room: null, examination_room: null, laser_room: null,
  } as unknown as CheckIn;

  test('치료실 입실(preconditioning) 환자는 treatment_room 방번호(C2) 노출', () => {
    const ci = { ...base, status: 'preconditioning', treatment_room: 'C2' } as CheckIn;
    expect(getAssignedSlotName(ci)).toBe('C2');
  });
  test('치료대기(treatment_waiting)는 잔존 treatment_room 무시(null)', () => {
    const ci = { ...base, status: 'treatment_waiting', treatment_room: 'C2' } as CheckIn;
    expect(getAssignedSlotName(ci)).toBeNull();
  });
});

test.describe('시나리오3 — AC-6 안전/빈상태', () => {
  test('빈 방 값은 "—" 폴백(빈칸 안전)', () => {
    const s = DASH();
    // FULLWIDTH-INLINE-EMOJI AC-1: 폰트 확대(text-[11px]→text-[13px]).
    expect(s).toContain('<span className="text-[13px] text-gray-300">—</span>');
  });
  test('양 섹션 0건 빈상태 메시지 + 헤더 항상 렌더(DOM 소멸 없음)', () => {
    const s = DASH();
    expect(s).toContain('오늘 진료 호출이 아직 없어요.');
    expect(s).toContain('아직 진료 완료된 환자가 없어요.');
    // 헤더(섹션 타이틀)는 빈상태 분기 밖 — 항상 렌더
    expect(s.indexOf('>진료 대기중</span>')).toBeLessThan(s.indexOf('오늘 진료 호출이 아직 없어요.'));
  });
});
