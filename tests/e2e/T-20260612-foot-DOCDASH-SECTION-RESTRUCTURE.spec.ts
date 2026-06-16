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

// ─────────────────────────────────────────────────────────────────────────────
// T-20260617-foot-DOCDASH-SPEC-DRIFT-3CAUSE (spec 위생, test_only — 코드 롤백 아님):
//   본 spec(SECTION-RESTRUCTURE)은 MONOTONE-RELAYOUT 시절 9칼럼(차트 신설·시간 칼럼)을 박제했으나,
//   이후 deployed 된 UI 3건이 칼럼 구성을 바꿔 정본과 drift 발생 → 현 deployed 렌더를 정답으로 재동기한다.
//     ① T-20260615-foot-DOCDASH-NAME-EMOJI-CLINICAL-3FIX item2: '차트' 칼럼(📝/🩺 헤더+셀) 통째 제거,
//        진료차트 진입을 이름 버튼(doctor-*-name-chart-btn, onOpenChart 'full')으로 이동. (9→여전히 9, 시간 잔존)
//     ② T-20260616-foot-DOCDASH-ELAPSED-CLINICAL-3FIX AC-1: '시간(경과시간)' 칼럼 제거 → colspan 9→8,
//        "+N분"을 상태 셀 ✋ 옆 인라인으로 이전(formatElapsedPlus 재사용). (9→8칼럼)
//     ③ T-20260616-foot-DOCDASH-NAMECOL-LEFTALIGN-BADGEFIX: 이름 버튼 text-center→text-left.
//   ⇒ deployed 정본 = 대기·완료 양 테이블 동일 8칼럼:
//        방 · 상태 · 이름 · 생년(만나이) · 차트번호 · 오늘시술 · 처방 · 임상경과.
//   각 변경 의도를 회귀로 박제(아래 시나리오2/3) — 정본이 다시 9칼럼/차트칼럼/시간칼럼으로 회귀하면 fail.
const DEPLOYED_ORDER = ['방', '상태', '이름', '생년(만나이)', '차트번호', '오늘시술', '처방', '임상경과'];

// thead 블록의 <th>텍스트</th> 라벨 순서 추출(클래스 무관·괄호 포함 '생년(만나이)'도 캡처).
function thOrder(block: string): string[] {
  return [...block.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1].trim());
}

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
  test('GUARD: status 전이/write 미변경 — 이 화면 내 전이 호출 0(완료는 칸반 상태 플래그 메뉴로 이전)', () => {
    // T-20260616-foot-DOCDASH-COMPLETEBTN-REMOVE: 진료완료 버튼 제거로 완료 전이(applyStatusFlagTransition pink)가
    //   DoctorCallDashboard 밖(Dashboard.handleFlagChange — 상태 플래그 메뉴)으로 이전. 이 화면 신설 write 0.
    const s = DASH();
    expect((s.match(/applyStatusFlagTransition\(checkIn/g) ?? []).length).toBe(0);
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
  // SPEC-DRIFT-3CAUSE 재동기: NAME-EMOJI(차트 칼럼 제거)+ELAPSED(시간 칼럼 제거) →
  //   양 테이블 동일 8칼럼(deployed 정본). 차트칼럼/시간칼럼 복원 시 fail로 회귀 차단.
  test('colgroup: 호출·완료 모두 8칼럼(차트·시간 칼럼 제거 정본)', () => {
    const s = DASH();
    const colgroups = s.match(/<colgroup>[\s\S]*?<\/colgroup>/g) ?? [];
    expect(colgroups.length).toBe(2);
    expect((colgroups[0].match(/<col /g) ?? []).length).toBe(8); // 호출
    expect((colgroups[1].match(/<col /g) ?? []).length).toBe(8); // 완료
    // 콜그룹 폭 합 각각 100% (드리프트 후에도 폭 정합 보존).
    const pct = (b: string) => [...b.matchAll(/w-\[(\d+)%\]/g)].reduce((a, m) => a + Number(m[1]), 0);
    expect(pct(colgroups[0])).toBe(100);
    expect(pct(colgroups[1])).toBe(100);
  });
  test('thead: 호출·완료 모두 8칼럼(차트·시간 칼럼 제거 정본)', () => {
    const s = DASH();
    const theads = s.match(/<thead>[\s\S]*?<\/thead>/g) ?? [];
    expect(theads.length).toBe(2);
    expect((theads[0].match(/<th /g) ?? []).length).toBe(8); // 호출
    expect((theads[1].match(/<th /g) ?? []).length).toBe(8); // 완료
  });
});

test.describe('시나리오2 — AC-4 칼럼 순서(SPEC-DRIFT-3CAUSE deployed 정본)', () => {
  test('대기 테이블 헤더 순서 = 방|상태|이름|생년(만나이)|차트번호|오늘시술|처방|임상경과', () => {
    const s = DASH();
    const thead = s.slice(s.indexOf('doctor-call-feed-table'), s.indexOf('doctor-call-feed-rows'));
    expect(thOrder(thead)).toEqual(DEPLOYED_ORDER);
  });
  // 완료 테이블은 대기와 '글자 그대로 동일' 8칼럼(WAITDONE-ALIGN-CNTNUM 폭 1:1, 차트·시간 칼럼 동일 제거).
  test('진료완료 테이블 헤더 순서 = 대기와 동일 8칼럼', () => {
    const s = DASH();
    const thead = s.slice(s.indexOf('doctor-completed-table'), s.indexOf('doctor-completed-rows'));
    expect(thOrder(thead)).toEqual(DEPLOYED_ORDER);
  });
  // NAME-EMOJI-CLINICAL-3FIX item2 회귀 박제: 임상경과는 전용 칼럼(셀 내부 showClinical 토글)으로 잔존,
  //   '차트' 칼럼의 📝(임상경과 단축) 버튼은 제거됨 → chart-btn testid 잔존 0.
  test('임상경과는 임상경과 칼럼(clinical-cell) 내부 토글 — 구 차트칼럼 chart-btn 제거', () => {
    const s = DASH();
    expect(s).toContain('data-testid="doctor-call-clinical-cell"');
    expect(s).toContain('data-testid="doctor-completed-clinical-cell"');
    // 빈값 '—' 클릭 = 인라인 임상경과 편집(showClinical) 진입(item3).
    expect(s).toContain('data-testid="doctor-call-clinical-empty-btn"');
    // 구 '차트' 칼럼 📝 단축 버튼 잔존 0(NAME-EMOJI item2 제거).
    expect(s).not.toContain('data-testid="doctor-call-chart-btn"');
    expect(s).not.toContain('data-testid="doctor-completed-chart-btn"');
  });
  // NAME-EMOJI-CLINICAL-3FIX item1/item2 회귀 박제: 진료차트(full) 진입은 '차트' 칼럼 🩺 버튼이 아니라
  //   이름 버튼(doctor-*-name-chart-btn, onOpenChart 'full')으로 이동. 구 fullchart-btn 칼럼 잔존 0.
  test('진료차트(full) 진입 = 이름 버튼으로 이동 — 구 차트칼럼 fullchart-btn 제거', () => {
    const s = DASH();
    expect(s).toContain('data-testid="doctor-call-name-chart-btn"');
    expect(s).toContain('data-testid="doctor-completed-name-chart-btn"');
    expect(s).toContain("onOpenChart(checkIn.customer_id, 'full')");
    expect(s).not.toContain('data-testid="doctor-call-fullchart-btn"');
    expect(s).not.toContain('data-testid="doctor-completed-fullchart-btn"');
  });
  // ELAPSED-CLINICAL-3FIX AC-1 회귀 박제: 시간 칼럼 제거 → 양 테이블 colSpan 모두 8(9 복원 시 fail).
  test('인라인 펼침 행 colSpan 정합(호출·완료 모두 8)', () => {
    const s = DASH();
    expect(s).toContain('const DOCDASH_COLSPAN = 8');
    expect(s).toContain('const DOCDASH_COMPLETED_COLSPAN = 8');
    // 호출/완료 인라인 차트 1행씩 = 각 COLSPAN 상수(임상경과/처방 펼침은 셀 내부 토글 — 별도 full-width 행 아님).
    expect((s.match(/colSpan=\{DOCDASH_COLSPAN\}/g) ?? []).length).toBe(1);
    expect((s.match(/colSpan=\{DOCDASH_COMPLETED_COLSPAN\}/g) ?? []).length).toBe(1);
    // 9칼럼 시절 상수 + 구 하드코딩 colSpan 잔존 0.
    expect(s).not.toContain('const DOCDASH_COLSPAN = 9');
    expect(s).not.toContain('const DOCDASH_COMPLETED_COLSPAN = 9');
    expect(s).not.toContain('colSpan={5}');
    expect(s).not.toContain('colSpan={6}');
  });
});

test.describe('시나리오2 — AC-5 숫자/카운트 plain text', () => {
  // WAITDONE-ALIGN-CNTNUM supersede: 대기 섹션 '진료필요' 라벨 제거 → 숫자만(doctor-call-active-count) 크게·볼드.
  //   배지(rounded-full bg-...) 미사용 plain text 불변(AC-5 회귀 보존).
  test('섹션 카운트 배지(rounded-full bg-...) 제거 → plain text', () => {
    const s = DASH();
    expect(s).not.toContain('rounded-full bg-red-100');
    expect(s).not.toContain('rounded-full bg-emerald-100');
    expect(s).toContain('data-testid="doctor-call-active-count"');
    expect(s).toContain('{activeCalls.length}');
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
  // ELAPSED-CLINICAL-3FIX AC-1 supersede: '시간' 칼럼 제거 → "+N분"을 상태 셀 ✋ 옆 인라인으로 이전.
  //   계산 로직(elapsedMinutes/formatElapsedPlus)은 2-line 형태로 재사용(elapsedMin → 30분↑ 빨간색 분기).
  test('경과시간: 상태 셀 인라인 "+N분"(elapsedMin/formatElapsedPlus 재사용) + 완료 섹션 칼럼 제거', () => {
    const s = DASH();
    expect(s).toContain('const elapsedMin = elapsedMinutes(getCallTime(checkIn));');
    expect(s).toContain('const elapsed = formatElapsedPlus(elapsedMin);');
    expect(s).toContain('data-testid="doctor-call-elapsed"');
    expect(s).not.toContain('data-testid="doctor-completed-elapsed-cell"');
    expect(formatElapsedPlus(0)).toBe('+0분');
    expect(formatElapsedPlus(12)).toBe('+12분');
  });
  // MONOTONE-RELAYOUT AC-4 supersede: 손들기 2단계 버튼(HandRaiseFlow) → 상태셀 HandToggle(✋ 단색 3-상태 토글).
  //   T-20260616-foot-DOCDASH-COMPLETEBTN-REMOVE: 진료완료 전이(applyStatusFlagTransition pink)는 이 화면 밖
  //   (칸반 상태 플래그 메뉴 → Dashboard.handleFlagChange)으로 이전 → 이 화면엔 HandToggle(ack 전용)만 잔존.
  test('손들기 토글(MONOTONE-RELAYOUT AC-4): HandToggle 보존 + 완료 전이는 이 화면 밖', () => {
    const s = DASH();
    expect(s).toContain('<HandToggle');
    expect(s).not.toContain('<HandRaiseFlow');
    expect(s).not.toContain("applyStatusFlagTransition(checkIn, 'pink'");
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
