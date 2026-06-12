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
import { formatSinceCall } from '../../src/lib/doctor-call-notify';
import type { CheckIn } from '../../src/lib/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');
const DASH = () => SRC('components/doctor/DoctorCallDashboard.tsx');

const NEW_ORDER = ['이름', '상태', '콜경과시간', '방', '오늘시술', '처방', '임상경과', '진료차트'];

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오1 — AC-1 필터링 버그(진료 대기중에서 completed_at 제외)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오1 — AC-1 필터링 버그(완료 환자 대기중 누수 제거)', () => {
  test('activeCalls(purple) 필터에 !completed_at 추가', () => {
    expect(DASH()).toContain("ci.status_flag === 'purple' && !ci.completed_at");
  });
  test('doneCalls(pink) 필터에 !completed_at 추가', () => {
    expect(DASH()).toContain("ci.status_flag === 'pink' && !ci.completed_at");
  });
  test('completedPatients(진료 완료) 필터는 completed_at 기준 유지(SSOT 불변)', () => {
    expect(DASH()).toContain('.filter((ci) => ci.completed_at)');
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
  test('colgroup 8칼럼 폭이 양 섹션 글자 그대로 동일(2벌)', () => {
    const s = DASH();
    const colgroups = s.match(/<colgroup>[\s\S]*?<\/colgroup>/g) ?? [];
    expect(colgroups.length).toBe(2);
    expect(colgroups[0]).toBe(colgroups[1]); // 완전 동일
    // 8개 col 폭 정의
    expect((colgroups[0].match(/<col /g) ?? []).length).toBe(8);
  });
  test('thead 8칼럼이 양 섹션 글자 그대로 동일(2벌)', () => {
    const s = DASH();
    const theads = s.match(/<thead>[\s\S]*?<\/thead>/g) ?? [];
    expect(theads.length).toBe(2);
    expect(theads[0]).toBe(theads[1]); // 스키마 완전 동일
  });
});

test.describe('시나리오2 — AC-4 칼럼 순서(변경 불가)', () => {
  test('대기 테이블 헤더 순서 = 이름|상태|콜경과시간|방|오늘시술|처방|임상경과|진료차트', () => {
    const s = DASH();
    const thead = s.slice(s.indexOf('doctor-call-feed-table'), s.indexOf('doctor-call-feed-rows'));
    const order = (thead.match(/>([가-힣]+)<\/th>/g) ?? []).map((m) => m.replace(/[<>/th]/g, ''));
    expect(order).toEqual(NEW_ORDER);
  });
  test('진료완료 테이블 헤더 순서도 동일(AC-3 완전 동일)', () => {
    const s = DASH();
    const thead = s.slice(s.indexOf('doctor-completed-table'), s.indexOf('doctor-completed-rows'));
    const order = (thead.match(/>([가-힣]+)<\/th>/g) ?? []).map((m) => m.replace(/[<>/th]/g, ''));
    expect(order).toEqual(NEW_ORDER);
  });
  test('임상경과 버튼은 임상경과 칼럼 내부(toggle showClinical)', () => {
    const s = DASH();
    expect(s).toContain('data-testid="doctor-call-chart-btn"');
    expect(s).toContain('data-testid="doctor-completed-chart-btn"');
  });
  test('진료차트 버튼 전용 칼럼 신설(full chart 오픈)', () => {
    const s = DASH();
    expect(s).toContain('data-testid="doctor-call-fullchart-btn"');
    expect(s).toContain('data-testid="doctor-completed-fullchart-btn"');
  });
  test('인라인 펼침 행 colSpan 8칼럼 정합(DOCDASH_COLSPAN)', () => {
    const s = DASH();
    expect(s).toContain('const DOCDASH_COLSPAN = 8');
    // 처방/임상경과 인라인 4행(대기2+완료2) 모두 DOCDASH_COLSPAN 사용
    expect((s.match(/colSpan=\{DOCDASH_COLSPAN\}/g) ?? []).length).toBe(4);
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
  test('콜경과시간(11FIX AC-7): formatSinceCall(elapsedMinutes(getCallTime)) 양 섹션 사용', () => {
    const s = DASH();
    expect((s.match(/formatSinceCall\(elapsedMinutes\(getCallTime\(checkIn\)\)\)/g) ?? []).length).toBe(2);
    expect(formatSinceCall(0)).toBe('콜 직후');
    expect(formatSinceCall(12)).toBe('콜 후 12분 경과');
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
    expect(s).toContain('<span className="text-[11px] text-gray-300">—</span>');
  });
  test('양 섹션 0건 빈상태 메시지 + 헤더 항상 렌더(DOM 소멸 없음)', () => {
    const s = DASH();
    expect(s).toContain('오늘 진료 호출이 아직 없어요.');
    expect(s).toContain('아직 진료 완료된 환자가 없어요.');
    // 헤더(섹션 타이틀)는 빈상태 분기 밖 — 항상 렌더
    expect(s.indexOf('>진료 대기중</span>')).toBeLessThan(s.indexOf('오늘 진료 호출이 아직 없어요.'));
  });
});
