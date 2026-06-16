/**
 * E2E spec — T-20260613-foot-DOCDASH-MONOTONE-RELAYOUT
 * 진료대시보드(DoctorCallDashboard) 단색·미니멀 리레이아웃.
 *   이름옆 이모지/꺾쇠 제거 + 시간 시계아이콘 제거 + 칼럼 재배치(임상경과=처방 왼쪽, 차트 신설=처방 오른쪽)
 *   + 손들기 ✋ 토글을 상태 셀로 이동(회색 SHAKE→초록 ack→파랑 완료, DB-backed cross-client).
 *
 * 정적 소스 검증 스타일 — 인접 DOCDASH spec 컨벤션 동일.
 *
 * AC-1  이름 옆 이모지(📝/🩺/✋)·꺾쇠(<) 제거 + 이름 중앙정렬
 * AC-2  시간 칼럼 시계(🕐/Clock) 아이콘 제거(텍스트 전용)
 * AC-3  칼럼 순서: 이름|차트번호|상태|시간|방|오늘시술|임상경과|처방|차트(신설) — 임상경과=처방 왼쪽, 차트=처방 오른쪽
 * AC-4  손들기 ✋ 토글을 상태 셀(진료필요 옆)로 이동, HandToggle 3-상태(shake/green/blue) 단색 아이콘
 * AC-5a 교차 클라이언트 동기화 = 로컬 state 아님(doctor_ack_at/status_flag DB값 → 색 투영, onRefresh)
 * AC-5b 옵션 B(데이터 보수): 파랑(완료) 클릭 시 완료 해제 안 함(안내 토스트만)
 * AC-6  차트 칼럼(처방 오른쪽): 임상경과 단축(📝) + 진료차트(🩺) 중앙정렬
 * AC-7  FULLWIDTH(b967f33) 스코프 보존: 처방 셀 미리보기 / 알약버튼→파란글씨 처방완료 회귀 금지
 *
 * ⚠ GUARD: status_flag 전이 SSOT(applyStatusFlagTransition) / ack SSOT(recordAck) 재사용(스키마 무변경) /
 *   진료의 NOT NULL / 처방게이트(inClinicRxGate) / 차트번호 칼럼(CHARTNO-COL-SPLIT-P1) 회귀 금지.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');
const DASH = () => SRC('components/doctor/DoctorCallDashboard.tsx');
const ACK = () => SRC('components/doctor/DoctorAck.tsx');
const TW = () => readFileSync(join(HERE, '../../tailwind.config.js'), 'utf-8');

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 — 이름 옆 이모지/꺾쇠 제거 + 중앙정렬
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 — 이름 셀 정리(이모지/꺾쇠 제거·중앙정렬)', () => {
  test('이름 셀에는 임상경과/진료차트/손 이모지 인라인 버튼이 없다(차트 칼럼으로 이동)', () => {
    const s = DASH();
    // 이름 클릭 = 차트 열기 버튼만 남음(이름-차트 진입). 별도 이모지 인라인 버튼 testid 부재.
    expect(s).toContain('data-testid="doctor-call-name-chart-btn"');
    // 이름 옆 이모지 버튼(구 NAME_EMOJI_BTN)·HandRaiseFlow 잔존 0
    expect(s).not.toContain('NAME_EMOJI_BTN');
    expect(s).not.toContain('HandRaiseFlow');
  });

  // T-20260617-foot-DOCDASH-SPEC-DRIFT-3CAUSE 재동기(③ NAMECOL-LEFTALIGN-BADGEFIX):
  //   이름 버튼 text-center → text-left (이름 텍스트만 좌정렬), [배지+이름] 컨테이너 justify-start.
  //   MONOTONE 시절 중앙정렬은 deployed 정본에서 폐지 — text-center 복원 시 fail.
  test('이름 버튼 좌정렬(text-left) — NAMECOL-LEFTALIGN, 중앙정렬 잔재 0', () => {
    const s = DASH();
    expect(s).toContain('min-w-[4rem] break-keep text-left');
    expect(s).not.toContain('min-w-[4rem] break-keep text-center');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2 — 시간 칼럼 시계 아이콘 제거
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 — 시간 칼럼 시계 아이콘 제거', () => {
  test('Clock 아이콘 import 제거(텍스트 전용)', () => {
    const s = DASH();
    expect(s).not.toMatch(/\bClock\b/);
  });

  test('경과시간 셀은 텍스트 전용(doctor-call-elapsed)', () => {
    const s = DASH();
    expect(s).toContain('data-testid="doctor-call-elapsed"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3 — 칼럼 순서: 임상경과=처방 왼쪽, 차트=처방 오른쪽(신설)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-3 — 칼럼 재배치(SPEC-DRIFT-3CAUSE deployed 정본)', () => {
  // SPEC-DRIFT-3CAUSE(① NAME-EMOJI 차트칼럼 제거 + ② ELAPSED 시간칼럼 제거):
  //   MONOTONE 시절 차트 칼럼 신설(colspan 9)·시간 칼럼은 deployed 정본에서 폐지 →
  //   양 테이블 colSpan 모두 8. 9 복원 시 fail로 회귀 차단.
  test('칼럼 제거 반영 colspan(호출·완료 모두 8)', () => {
    const s = DASH();
    expect(s).toContain('const DOCDASH_COLSPAN = 8;');
    expect(s).toContain('const DOCDASH_COMPLETED_COLSPAN = 8;');
    expect(s).not.toContain('const DOCDASH_COLSPAN = 9;');
  });

  // deployed 정본 thead 순서: …오늘시술→처방→임상경과 (임상경과가 마지막 칼럼, '차트' 칼럼 폐지).
  //   th className 도 정본 = px-1.5 py-1 (MONOTONE 시절 px-2 py-1.5 폐지).
  test('진료 대기중 thead 순서: …오늘시술→처방→임상경과 (차트 칼럼 폐지)', () => {
    const s = DASH();
    const order = [
      '<th className="px-1.5 py-1">오늘시술</th>',
      '<th className="px-1.5 py-1">처방</th>',
      '<th className="px-1.5 py-1">임상경과</th>',
    ];
    let cursor = 0;
    for (const th of order) {
      const idx = s.indexOf(th, cursor);
      expect(idx).toBeGreaterThan(cursor);
      cursor = idx;
    }
    // '차트' 칼럼 헤더 잔존 0(NAME-EMOJI item2 제거).
    expect(s).not.toContain('<th className="px-1.5 py-1">차트</th>');
    expect(s).not.toContain('<th className="px-2 py-1.5">차트</th>');
  });

  test('두 콜그룹 폭 합계 각각 100%', () => {
    const s = DASH();
    const pct = (block: string) =>
      [...block.matchAll(/w-\[(\d+)%\]/g)].reduce((a, m) => a + Number(m[1]), 0);
    // 첫 colgroup(진료 대기중) + 둘째 colgroup(진료 완료) 각각 합 100.
    const g1Start = s.indexOf('<colgroup>');
    const g1 = s.slice(g1Start, s.indexOf('</colgroup>', g1Start));
    const g2Start = s.indexOf('<colgroup>', g1Start + 1);
    const g2 = s.slice(g2Start, s.indexOf('</colgroup>', g2Start));
    expect(pct(g1)).toBe(100);
    expect(pct(g2)).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4 / AC-5 — 손들기 ✋ 토글을 상태 셀로 이동(3-상태 단색)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-4/AC-5 — HandToggle 상태 셀 3-상태 토글', () => {
  test('HandToggle 컴포넌트 + data-hand-state(shake/green/blue)', () => {
    const s = DASH();
    expect(s).toContain('function HandToggle(');
    expect(s).toContain('data-testid="doctor-hand-toggle"');
    expect(s).toContain('data-hand-state={visual}');
    // 3-상태 색 매핑
    expect(s).toContain("completed ? 'blue' : acked ? 'green' : 'shake'");
  });

  test('상태 셀(진료필요 옆) HandToggle 렌더 + 완료 테이블은 completed', () => {
    const s = DASH();
    expect(s).toContain("'진료필요'");
    expect(s).toContain('completed={false}');
    expect(s).toMatch(/<HandToggle[\s\S]*?completed\s*\n\s*onRefresh/);
  });

  test('AC-5a 교차 클라이언트: ack 는 DB SSOT write 재사용(recordAck)', () => {
    // ⚠ T-20260616-foot-DOCDASH-COMPLETEBTN-REMOVE: 진료완료 버튼 제거로 완료 전이
    //   (applyStatusFlagTransition pink)가 DoctorCallDashboard 밖(칸반 상태 플래그 메뉴 → Dashboard.handleFlagChange)
    //   으로 이전됨. 이 화면은 ack(recordAck)만 write — 완료 전이 호출 0(아래 GUARD 로 박제).
    const s = DASH();
    expect(s).toContain('recordAck(checkIn.id)');
    expect(s).not.toContain("applyStatusFlagTransition(checkIn, 'pink'"); // 완료 전이는 이 화면 밖(상태 플래그 메뉴)
    // recordAck export(SSOT 재사용)
    expect(ACK()).toContain('export async function recordAck');
  });

  test('AC-5b 옵션 B: 파랑(완료) 클릭은 완료 해제 안 함(상태 전이 호출 없음, 안내만)', () => {
    // ⚠ T-20260615-foot-SHAKEHAND-NO-COMPLETE 가 ✋ 를 ack 전용으로 환원 → 파랑 안내 문구 갱신.
    //   불변식(파랑 클릭=완료 해제 안 함, 안내만)은 유지.
    const s = DASH();
    const start = s.indexOf('function HandToggle(');
    const end = s.indexOf('// ─── 진료완료 버튼', start);
    const fn = s.slice(start, end > 0 ? end : undefined);
    expect(fn).toContain("if (visual === 'blue')");
    expect(fn).toContain('이미 진료완료된 환자예요'); // 안내만, un-complete 미수행
  });

  test('SHAKE 애니메이션 tailwind 정의(미ack 초기)', () => {
    expect(TW()).toContain('shake:');
    expect(TW()).toContain('shake 0.9s ease-in-out infinite');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-6 — 차트 칼럼 폐지(SPEC-DRIFT-3CAUSE ① NAME-EMOJI-CLINICAL-3FIX item2)
//   MONOTONE 시절 '차트' 칼럼(📝 임상경과 단축 / 🩺 진료차트 이모지 버튼)은 deployed 정본에서 통째 제거.
//   진료차트(full) 진입은 이름 버튼(doctor-*-name-chart-btn)으로 이동 — 칼럼 복원 시 fail로 회귀 차단.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-6 — 차트 칼럼 폐지 + 진입 이름 버튼 이동(NAME-EMOJI item2)', () => {
  test('차트 칼럼 셀/이모지 버튼 testid 잔존 0 (call)', () => {
    const s = DASH();
    expect(s).not.toContain('data-testid="doctor-call-chart-cell"');
    expect(s).not.toContain('data-testid="doctor-call-chart-btn"');
    expect(s).not.toContain('data-testid="doctor-call-fullchart-btn"');
    // 차트 셀 이모지 span(📝/🩺) 잔재 0(CHART_CELL_EMOJI_BTN 제거).
    expect(s).not.toContain('<span aria-hidden>📝</span>');
    expect(s).not.toContain('<span aria-hidden>🩺</span>');
  });

  test('완료 테이블 차트 칼럼 셀/버튼 testid 잔존 0', () => {
    const s = DASH();
    expect(s).not.toContain('data-testid="doctor-completed-chart-cell"');
    expect(s).not.toContain('data-testid="doctor-completed-fullchart-btn"');
  });

  test('진료차트(full) 진입은 이름 버튼으로 이동(onOpenChart full)', () => {
    const s = DASH();
    expect(s).toContain('data-testid="doctor-call-name-chart-btn"');
    expect(s).toContain('data-testid="doctor-completed-name-chart-btn"');
    expect(s).toContain("onOpenChart(checkIn.customer_id, 'full')");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-7 / GUARD — FULLWIDTH 스코프 + 핵심 경로 회귀 0
// ─────────────────────────────────────────────────────────────────────────────
test.describe('GUARD — 회귀 0', () => {
  test('처방 셀 미리보기 + 파란글씨 처방완료(FULLWIDTH) 보존', () => {
    const s = DASH();
    expect(s).toContain("checkIn.prescription_status === 'confirmed' ?");
    expect(s).toContain('doctor-call-rx-btn');
  });

  test('처방 게이트(inClinicRxGate) import 보존', () => {
    expect(DASH()).toContain('inClinicRxGate');
  });

  test('차트번호 칼럼(CHARTNO-COL-SPLIT-P1) 보존', () => {
    expect(DASH()).toContain('data-testid="doctor-call-chartno"');
  });

  test('11FIX AC-12 시술 별도 칼럼(ProcedureCell) 보존', () => {
    expect(DASH()).toContain('ProcedureCell');
  });

  test('구 손들기 워크플로(DoctorAckButton/Handshake) 잔존 0', () => {
    // ⚠ T-20260615-foot-SHAKEHAND-NO-COMPLETE 가 TreatmentCompleteButton(별도 명시 완료액션)을 복원했으나,
    //   T-20260616-foot-DOCDASH-COMPLETEBTN-REMOVE (김주연 총괄 확정)가 다시 제거 → 완료 동선을 칸반
    //   '상태 플래그 메뉴 → 진료완료(핑크)'로 일원화. 따라서 이제 TreatmentCompleteButton 도 '잔존 금지' 대상.
    const s = DASH();
    expect(s).not.toContain('function TreatmentCompleteButton('); // 버튼 제거 — 완료는 상태 플래그 메뉴로 이전
    expect(s).not.toContain('<TreatmentCompleteButton');
    expect(s).not.toContain('DoctorAckButton');
    expect(s).not.toContain('Handshake');
  });
});
