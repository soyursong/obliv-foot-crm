import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { resvKind, aggregateByTimeSlot } from '../../src/lib/resvSlotAgg';

/**
 * T-20260614-foot-HEALER-RESV-CLASSIFY-DEF — '힐러 N건(HL N)' 칩, 힐러 예약 영속 식별 (Option A 확정)
 * 원천: 김주연 총괄(C0ATE5P6JTH, thread 1781359796.150899). 부모 5FIX AC1-b 데이터 시맨틱 분리.
 *
 * 근본원인(부모 0f5c 진단): healer_flag 는 ① 체크인 시 1회성 소모(Dashboard HL-blink) ②
 *   캘린더 직접예약 시 미설정 → 슬롯의 힐러가 초/재로 분류되어 'HL N' 칩 미표기.
 * Option A 확정(김주연 총괄 2026-06-14T21:28): reservations.is_healer_intent(영속) 신설 + 예약팝업 힐러 ON/OFF 토글.
 *   · 현재 구조 유지(CustomerChartPage pending_healer_flag→다음 미래예약 healer_flag 자동세팅) — 미변경.
 *   · 분류 SSOT = (is_healer_intent 영속 || healer_flag 레거시). 체크인 후에도 캘린더 힐러 분류 유지.
 *
 * 검증 = ① resvKind/aggregate 순수 로직(is_healer_intent 우선) ② Reservations.tsx source-integrity(토글·payload·preload)
 *   ③ 마이그레이션(영속 컬럼+backfill+rollback) ④ 시간대 패널 select 컬럼 추가.
 * 거대 인라인(Reservations.tsx) = source-integrity gating. 실 렌더는 supervisor field-soak.
 */

const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');
const AGG = fs.readFileSync(path.resolve('src/lib/resvSlotAgg.ts'), 'utf-8');
const PANEL = fs.readFileSync(path.resolve('src/components/ReservationDayTimeslotPanel.tsx'), 'utf-8');
const MIG_DIR = path.resolve('supabase/migrations');

// ═══════════════════════════════════════════════════════════════════════════
// AC1 — 분류 SSOT: is_healer_intent(영속) 우선, healer_flag(레거시) fallback (순수 로직)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC1: resvKind 영속 is_healer_intent 분류', () => {
  test('AC1-1: is_healer_intent=true → healer (healer_flag 소모와 무관)', () => {
    // 체크인 후 healer_flag 가 소모(false)되어도 영속 is_healer_intent 로 힐러 유지 (근본원인 해소)
    expect(resvKind({ is_healer_intent: true, healer_flag: false, visit_type: 'returning' })).toBe('healer');
    expect(resvKind({ is_healer_intent: true, healer_flag: false, visit_type: 'new' })).toBe('healer');
  });

  test('AC1-2: 레거시 호환 — healer_flag=true(영속값 없음) → healer 유지', () => {
    // 현재 구조(CustomerChartPage healer_flag 흐름) 미변경 — fallback 으로 계속 힐러 분류.
    expect(resvKind({ healer_flag: true, visit_type: 'returning' })).toBe('healer');
  });

  test('AC1-3: 둘 다 false/없음 → visit_type 기준 분류 (회귀)', () => {
    expect(resvKind({ is_healer_intent: false, healer_flag: false, visit_type: 'new' })).toBe('new');
    expect(resvKind({ visit_type: 'returning' })).toBe('returning');
    expect(resvKind({ visit_type: 'experience' })).toBe('other');
  });

  test('AC1-4: aggregateByTimeSlot — is_healer_intent 예약이 h 카운트에 집계', () => {
    const rows = [
      { reservation_time: '10:00', visit_type: 'returning', is_healer_intent: true, healer_flag: false, status: 'checked_in' as const },
      { reservation_time: '10:00', visit_type: 'new', is_healer_intent: false, healer_flag: false, status: 'confirmed' as const },
      { reservation_time: '10:00', visit_type: 'returning', healer_flag: true, status: 'confirmed' as const }, // 레거시 힐러
    ];
    const slot = aggregateByTimeSlot(rows)[0].counts;
    expect(slot.h, '영속+레거시 힐러 모두 h 집계').toBe(2);
    expect(slot.n).toBe(1);
    expect(slot.total).toBe(3);
  });

  test('AC1-5: resvSlotAgg 소스 — is_healer_intent 우선 분기 + ResvKindInput 필드', () => {
    expect(AGG, 'is_healer_intent 분류 분기 누락').toContain('if (r.is_healer_intent || r.healer_flag) return \'healer\'');
    expect(AGG, 'ResvKindInput.is_healer_intent 필드 누락').toMatch(/is_healer_intent\?:\s*boolean\s*\|\s*null/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC2 — 예약 팝업 힐러 ON/OFF 토글 + 영속 저장 (Reservations.tsx source-integrity)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC2: 예약 팝업 힐러 토글 + is_healer_intent 영속', () => {
  test('AC2-1: 힐러 ON/OFF 토글 UI 신설 (data-testid + ON/OFF 2값)', () => {
    // testid 는 런타임에 healer-intent-on / healer-intent-off 로 렌더(템플릿 키 기반).
    expect(RESV_PAGE, '힐러 토글 testid 템플릿 누락').toContain('data-testid={`healer-intent-${key}`}');
    expect(RESV_PAGE, '힐러 토글 ON/OFF 2값 정의 누락').toMatch(/\['off', false, 'OFF'\][\s\S]*?\['on', true, 'ON'\]/);
    expect(RESV_PAGE, '힐러 토글 라벨 누락').toContain('힐러 예약');
    expect(RESV_PAGE, '토글 → update(is_healer_intent) 바인딩 누락').toContain("update('is_healer_intent'");
  });

  test('AC2-2: 신규 생성 payload 에 is_healer_intent 영속 저장', () => {
    expect(RESV_PAGE, '생성 payload is_healer_intent 누락').toContain('is_healer_intent: input.is_healer_intent ?? false');
    expect(RESV_PAGE, '생성 호출 인자 is_healer_intent 누락').toContain('is_healer_intent: state.is_healer_intent ?? false');
  });

  test('AC2-3: 수정(UPDATE) payload 에 is_healer_intent 반영', () => {
    // 수정 payload 블록에도 is_healer_intent 포함 (state.is_healer_intent ?? false 가 생성 호출과 수정 payload 양쪽 충족)
    const occurrences = (RESV_PAGE.match(/is_healer_intent: state\.is_healer_intent \?\? false/g) || []).length;
    expect(occurrences, '수정 payload + 생성 호출 2곳 모두에 is_healer_intent 필요').toBeGreaterThanOrEqual(2);
  });

  test('AC2-4: openEdit — 기존 예약의 is_healer_intent(또는 레거시 healer_flag) 프리로드', () => {
    expect(RESV_PAGE, 'openEdit is_healer_intent 프리로드 누락')
      .toContain('is_healer_intent: !!(r.is_healer_intent ?? r.healer_flag)');
  });

  test('AC2-5: ReservationDraft / CanonicalCreateInput 타입에 is_healer_intent', () => {
    expect(RESV_PAGE, 'draft 타입 is_healer_intent 누락').toMatch(/is_healer_intent\?:\s*boolean;/);
  });

  test('AC2-6: 카드 힐러 라벨 — resvKind 기반(healer_flag 단독 의존 제거)', () => {
    expect(RESV_PAGE, '카드 라벨이 resvKind 기반 아님')
      .toContain("resvKind(r) === 'healer' ? '힐러' : VISIT_TYPE_KO[r.visit_type]");
    expect(RESV_PAGE, '다음 힐러 indicator 가 resvKind 기반 아님')
      .toContain("resvKind(r) !== 'healer' && r.status !== 'cancelled'");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC3 — 마이그레이션(영속 컬럼 + backfill + rollback) + 시간대 패널 select
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC3: 마이그레이션 + 패널 select', () => {
  const mig = fs.readFileSync(path.join(MIG_DIR, '20260614130000_reservation_is_healer_intent.sql'), 'utf-8');
  const rollback = fs.readFileSync(path.join(MIG_DIR, '20260614130000_reservation_is_healer_intent.rollback.sql'), 'utf-8');

  test('AC3-1: ADDITIVE — reservations.is_healer_intent 컬럼 + IF NOT EXISTS + DEFAULT false', () => {
    expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS is_healer_intent boolean NOT NULL DEFAULT false/);
    expect(mig, '컬럼 코멘트(분류 SSOT) 누락').toContain('COMMENT ON COLUMN public.reservations.is_healer_intent');
  });

  test('AC3-2: backfill — 현재 healer_flag=true 를 영속 컬럼에 승계', () => {
    expect(mig).toMatch(/UPDATE public\.reservations[\s\S]*?SET is_healer_intent = true[\s\S]*?WHERE healer_flag = true/);
  });

  test('AC3-3: rollback — DROP COLUMN IF EXISTS', () => {
    expect(rollback).toContain('DROP COLUMN IF EXISTS is_healer_intent');
  });

  test('AC3-4: 시간대 현황 패널 select 에 is_healer_intent 추가', () => {
    expect(PANEL, '패널 select is_healer_intent 누락')
      .toContain("select('reservation_time, visit_type, is_healer_intent, healer_flag, status')");
    expect(PANEL, 'TimeslotRow.is_healer_intent 타입 누락').toMatch(/is_healer_intent:\s*boolean\s*\|\s*null/);
  });
});
