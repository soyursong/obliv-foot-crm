import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260613-foot-RESVCAL-FOLLOWUP-5FIX — 예약 캘린더 5FIX 후속
 * MQ: MSG-20260613-232101-yr9a (planner NEW-TASK, P1, deadline 2026-06-17).
 *
 * 본 spec 구현 범위 = AC1 (FE-only, DB 무변경, 순수 집계 수식):
 *   AC1-a 힐러 총인원 합산 포함 — REDEFINITION (a) 확정.
 *     날짜 헤더 총건수 = 초진+재진+힐러(c.n + c.r + c.h). nji4 'HL 제외' supersede.
 *     HL 칩(HL N)은 별도 유지 — 합산+별도표기 병존.
 *   AC1-b 슬롯(타임슬롯 리스트) 'HL N' 칩 — FIX-REQUEST MSG-…-fjcc 범위 확대.
 *     슬롯 카운트 칩에서 h(=resvKind==='healer') ≥ 1 이면 'HL {h}' 칩 표기.
 *     ⚠ 렌더 코드는 이미 존재·배포 완료(slot-kind-count, {h > 0 && HL}).
 *       현장 "HL 안 뜸" 증상의 근본원인은 표시 레이어가 아니라 healer_flag 데이터 시맨틱:
 *         (1) healer_flag는 당일 체크인 시 1회성 소모(Dashboard.tsx reset→false)
 *         (2) 캘린더 예약 editor는 healer_flag를 set하지 않음(read-only)
 *       → 캘린더에서 직접 잡았거나 이미 체크인된 힐러 예약은 healer_flag=false → 초/재로 분류.
 *       이 근본원인은 DB/시맨틱 결정 필요(planner FOLLOWUP 발행). 본 spec은 렌더 정합 회귀 고정.
 *
 * 보류(이번 커밋 제외, planner FOLLOWUP):
 *   AC3 '내 예약 ▼' 드롭 — 블로커 재확인. MQ 1차 검증 게이트 발동:
 *     · reservation_registrars(registrar_id/registrar_name)는 자유선택 마스터명
 *       (마이그 20260610110000 L14/L56-57: "staff 계정과 분리된 운영 명단, 동일 인명도 staff FK 아님").
 *       로그인 신원(auth.uid)과 무연계 → '본인 예약' 필터 의미 성립 불가.
 *     · MQ가 지칭한 `reservation_registrars.registrant` 컬럼은 스키마에 부재.
 *     · reservations.created_by(진짜 로그인 신원 앵커)는 insert 경로 미적재
 *       (RESVCAL-DISPLAY-REWORK item7 보일러플레이트 기 문서화).
 *     → 추정 구현 금지, planner FOLLOWUP. 데이터소스 확정 후 별도 착수.
 *
 * 거대 인라인(Reservations.tsx) 관례 = source-integrity gating. 실 렌더는 supervisor field-soak.
 * DB 무관(FE-only).
 */

const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');

// ═══════════════════════════════════════════════════════════════════════════
// AC1 — 날짜 헤더 총건수에 힐러(HL) 합산 포함 (REDEFINITION (a))
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC1: 힐러 총인원 합산 포함', () => {
  test('AC1-1: 날짜 헤더 총건수 = 초진+재진+힐러 (c.n + c.r + c.h)', () => {
    expect(RESV_PAGE, '총건수 합산 수식이 c.n + c.r + c.h 아님 (HL 미포함)')
      .toContain('총 {c.n + c.r + c.h}');
    expect(RESV_PAGE, '구(舊) HL 제외 수식 잔존 (총 {c.n + c.r})')
      .not.toContain('총 {c.n + c.r}<');
  });

  test('AC1-2: HL 칩(HL N)은 별도 유지 — 합산+별도표기 병존', () => {
    // 합산에 포함되더라도 노란 HL 칩은 별도 렌더(c.h > 0 조건)되어야 함.
    expect(RESV_PAGE, 'HL 별도 칩 렌더 누락 (병존 위반)')
      .toMatch(/c\.h > 0 &&[\s\S]*?HL \{c\.h\}/);
    expect(RESV_PAGE, 'HL 칩 노란색(yellow) 스타일 누락')
      .toMatch(/c\.h > 0 &&[\s\S]*?bg-yellow-100[\s\S]*?HL \{c\.h\}/);
  });

  test('AC1-3: dayKindCounts가 힐러 카운트(h)를 집계 (수식의 데이터 소스)', () => {
    const m = RESV_PAGE.match(/const dayKindCounts = useMemo\(\(\) => \{([\s\S]*?)\}, \[rows\]\);/);
    expect(m, 'dayKindCounts useMemo 파싱 실패').toBeTruthy();
    const body = m![1];
    expect(body, '힐러 카운트(cur.h) 증가 분기 누락').toContain("kind === 'healer') cur.h += 1");
    expect(body, '취소 예약 제외 가드 누락(회귀)').toContain("row.status === 'cancelled') continue");
  });

  test('AC1-4: REDEFINITION supersede 주석으로 의도 명시', () => {
    expect(RESV_PAGE, 'AC1 supersede 주석 누락 (의도 추적 불가)')
      .toMatch(/RESVCAL-FOLLOWUP-5FIX AC1[\s\S]*?HL[\s\S]*?포함/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC1-b — 슬롯(타임슬롯 리스트) 'HL N' 칩 렌더 정합 (FIX-REQUEST 범위 확대)
//   렌더 코드는 기 존재·배포. 본 블록은 'h≥1 → HL 칩' 조건이 슬롯 칩에 유지됨을 회귀 고정.
//   (증상 근본원인=healer_flag 데이터 시맨틱은 planner FOLLOWUP — 표시 레이어 무관)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC1-b: 슬롯 카운트 칩 HL 표기', () => {
  // slot-kind-count 칩 IIFE 블록 전체 추출 (const 선언부 포함, 헤더 day-summary 와 분리)
  const SLOT = (() => {
    const m = RESV_PAGE.match(/const active = list\.filter[\s\S]*?slot-kind-count-\$\{dateStr\}-\$\{time\}[\s\S]*?\}\)\(\)\}/);
    return m ? m[0] : '';
  })();

  test('AC1-b-1: 슬롯 칩 블록 존재 (slot-kind-count testid)', () => {
    expect(SLOT, '슬롯 카운트 칩 블록(slot-kind-count) 소실').not.toBe('');
  });

  test('AC1-b-2: 슬롯 칩이 힐러 카운트 h = resvKind==="healer" 로 집계', () => {
    expect(SLOT, '힐러 카운트 h 파생 누락')
      .toMatch(/const h = active\.filter\(\(r\) => resvKind\(r\) === 'healer'\)\.length/);
  });

  test('AC1-b-3: h ≥ 1 이면 HL 칩 렌더 (조건 누락/0건 스킵 방지)', () => {
    expect(SLOT, '슬롯 HL 칩 조건부 렌더 누락 ({h > 0 && ... HL {h}})')
      .toMatch(/h > 0 &&[\s\S]*?HL \{h\}/);
    expect(SLOT, '슬롯 HL 칩 노란색(yellow) 스타일 누락')
      .toMatch(/h > 0 &&[\s\S]*?bg-yellow-100[\s\S]*?HL \{h\}/);
  });

  test('AC1-b-4: 슬롯 초/재 칩도 병존 (회귀 — HL만 추가, 기존 유지)', () => {
    expect(SLOT, '슬롯 초진 칩 누락').toMatch(/n > 0 &&[\s\S]*?초 \{n\}/);
    expect(SLOT, '슬롯 재진 칩 누락').toMatch(/rr > 0 &&[\s\S]*?재 \{rr\}/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 회귀 — RESVCAL-DISPLAY-REWORK · WEEKCAL-HEADER-CARD-REDESIGN 동선 무파괴
// ═══════════════════════════════════════════════════════════════════════════
test.describe('회귀: 기 배포 캘린더 동선 무파괴', () => {
  test('REG-1: 초/재 칩 카운트 표기 유지 (DISPLAY-REWORK item1)', () => {
    expect(RESV_PAGE, '초진 칩(초 N) 누락').toMatch(/초 \{c\.n\}/);
    expect(RESV_PAGE, '재진 칩(재 N) 누락').toMatch(/재 \{c\.r\}/);
  });

  test('REG-2: 날짜 요약 testid 유지 (field-soak/회귀 셀렉터 안정)', () => {
    expect(RESV_PAGE, 'day-summary testid 누락')
      .toContain('data-testid={`day-summary-${format(d, \'yyyy-MM-dd\')}`}');
  });

  test('REG-3: 전건 0(초+재+힐러) 시 요약 null 렌더 가드 유지', () => {
    expect(RESV_PAGE, '전건 0 null 가드 누락')
      .toContain('if (!c || (c.n === 0 && c.r === 0 && c.h === 0)) return null');
  });

  test('REG-4: 카드 유형색 코딩(초진=emerald/재진=blue/힐러=yellow) 유지', () => {
    const m = RESV_PAGE.match(/const KIND_CARD_STYLE: Record<ResvKind, string> = \{([\s\S]*?)\};/);
    expect(m, 'KIND_CARD_STYLE 소실(회귀)').toBeTruthy();
    const body = m![1];
    expect(body).toMatch(/new:\s*'[^']*emerald/);
    expect(body).toMatch(/returning:\s*'[^']*blue/);
    expect(body).toMatch(/healer:\s*'[^']*yellow/);
  });
});
