/**
 * E2E spec — T-20260714-dopamine-FOOT-PREVCALL-VISITCONFIRM-SYNC-RENAME
 * 도파민→풋 '내원콜 방문확인' 결과 sync (Part A / receive) + 라벨 rename(분기 A).
 *
 * DA CONSULT-REPLY: DA-20260714-dopamine-FOOT-PREVCALL-VISITCONFIRM-SYNC-RENAME (GO_WARN, supervisor DDL-diff only).
 *   Q2 receive = canonical reachable/absent ADDITIVE 저장(롱레 reservations.visit_call_result 미러).
 *   Q3 rename introspection 결과 = 분기 A (풋 '방문예정'/'방문안함'은 reservation_memo_history 자유텍스트 +
 *      FE 버튼 라벨. CHECK/enum 한글 리터럴 없음 → rename = 순수 FE 표시명 교체 = 비파괴, 값 마이그 0, DDL 0).
 *
 * AC1/AC2 — 도파민 absent/내원예정 → 풋 canonical(absent/reachable) 저장·표시 (receiver EF + FE 라벨).
 * AC3 — 라벨 rename(방문예정→내원예정, 방문안함→부재), 기존 저장값 무손실(append-only 타임라인).
 * AC4 — idempotent 수신(event_id) + LWW(result_at) + DLQ 시맨틱(송신부 책임, 수신 HTTP 신호).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const MIG = 'supabase/migrations/20260715123000_foot_visit_call_result_receive.sql';
const ROLLBACK = 'supabase/migrations/20260715123000_foot_visit_call_result_receive.rollback.sql';
const EF = 'supabase/functions/dopamine-visitcall-receiver/index.ts';
const TYPES = 'src/lib/types.ts';
const CHART = 'src/pages/CustomerChartPage.tsx';

const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf-8');
// 설명 주석(-- ... / // ... / /* */ / {/* */})은 rename 매핑·금지항목을 서술하므로
// negative 매칭 시 코드 라인만 대상으로 삼기 위해 주석을 제거한다.
const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments (JS/TS + {/* */} 내부)
    .split('\n')
    .map((l) => l.replace(/--.*$/, '').replace(/\/\/.*$/, ''))
    .join('\n');

test.describe('아티팩트 존재', () => {
  test('마이그·롤백·receiver EF 존재', () => {
    expect(fs.existsSync(path.resolve(MIG))).toBe(true);
    expect(fs.existsSync(path.resolve(ROLLBACK))).toBe(true);
    expect(fs.existsSync(path.resolve(EF))).toBe(true);
  });
});

test.describe('Part A receive — 마이그 ADDITIVE + canonical CHECK', () => {
  const mig = () => read(MIG);

  test('canonical 컬럼 3종 ADD (nullable)', () => {
    const s = mig();
    expect(s).toMatch(/ADD COLUMN IF NOT EXISTS visit_call_result text/);
    expect(s).toMatch(/ADD COLUMN IF NOT EXISTS visit_call_result_at timestamptz/);
    expect(s).toMatch(/ADD COLUMN IF NOT EXISTS visit_call_result_event_id text/);
  });

  test('named CHECK = governed enum reachable/absent 만 (제3의 값 금지)', () => {
    const s = mig();
    expect(s).toMatch(/reservations_visit_call_result_check/);
    expect(s).toMatch(/ARRAY\['reachable'::text, 'absent'::text\]/);
    // 한글 리터럴 저장 금지(canonical only) — 코드(주석 제외) 기준
    expect(stripComments(s)).not.toMatch(/'내원예정'|'부재'|'방문예정'|'방문안함'/);
  });

  test('ADDITIVE 전용 — 기존 컬럼/테이블 파괴 DDL 없음', () => {
    const s = mig();
    expect(s).not.toMatch(/DROP TABLE/i);
    expect(s).not.toMatch(/DROP COLUMN/i);
    // 기존행 UPDATE 백필 없음(신규 nullable 컬럼이므로 값 마이그 0)
    expect(s).not.toMatch(/UPDATE public\.reservations/i);
  });

  test('롤백 가역 (컬럼 3종 + CHECK + index drop)', () => {
    const r = read(ROLLBACK);
    expect(r).toMatch(/DROP COLUMN IF EXISTS visit_call_result/);
    expect(r).toMatch(/DROP CONSTRAINT IF EXISTS reservations_visit_call_result_check/);
    expect(r).toMatch(/DROP INDEX IF EXISTS public\.idx_reservations_visit_call_event_id/);
  });
});

test.describe('receiver EF — auth · canonical · 멱등 · LWW · HTTP 시맨틱', () => {
  const ef = () => read(EF);

  test('X-Callback-Secret 인증 게이트 (401)', () => {
    const s = ef();
    expect(s).toMatch(/DOPAMINE_CALLBACK_SECRET/);
    expect(s).toMatch(/X-Callback-Secret/);
    expect(s).toMatch(/UNAUTHORIZED.*401|401.*UNAUTHORIZED/s);
  });

  test('canonical only 검증 (INVALID_RESULT 400)', () => {
    const s = ef();
    expect(s).toMatch(/CANONICAL = new Set\(\['reachable', 'absent'\]\)/);
    expect(s).toMatch(/INVALID_RESULT/);
  });

  test('key = crm_reservation_id (cue_card_id 아님)', () => {
    const s = ef();
    expect(s).toMatch(/crm_reservation_id/);
    expect(s).toMatch(/\.eq\('id', crmReservationId\)/);
    // 코드(주석 제외)에서 cue_card_id 를 key 로 쓰지 않음
    expect(stripComments(s)).not.toMatch(/cue_card_id/);
  });

  test('멱등 — 동일 event_id 재수신 duplicate skip', () => {
    const s = ef();
    expect(s).toMatch(/visit_call_result_event_id === eventId/);
    expect(s).toMatch(/reason: 'duplicate'/);
  });

  test('LWW — result_at 오래된 결과 stale skip', () => {
    const s = ef();
    expect(s).toMatch(/resultAtMs < storedMs/);
    expect(s).toMatch(/reason: 'stale'/);
  });

  test('HTTP 시맨틱 — 404(예약 미존재, 재시도가능) / 500(일시장애)', () => {
    const s = ef();
    expect(s).toMatch(/RESERVATION_NOT_FOUND.*404|404/s);
    expect(s).toMatch(/applied: true/);
  });
});

test.describe('AC3 rename(분기 A) — FE 표시라벨 교체, 비파괴', () => {
  test('canonical→FE 라벨 매핑 (reachable→내원예정 / absent→부재)', () => {
    const t = read(TYPES);
    expect(t).toMatch(/VISIT_CALL_RESULT_LABEL/);
    expect(t).toMatch(/reachable: '내원예정'/);
    expect(t).toMatch(/absent: '부재'/);
  });

  test('버튼 라벨 rename 적용 (방문 예정/방문 안함 제거)', () => {
    const c = read(CHART);
    expect(c).toMatch(/내원예정 ✓/);
    expect(c).toMatch(/부재 ✗/);
    expect(c).not.toMatch(/방문 예정 ✓/);
    expect(c).not.toMatch(/방문 안함 ✗/);
  });

  test('메모 기록 라벨 rename (신규 기록만; 기존 타임라인 불변=무손실)', () => {
    const c = stripComments(read(CHART));
    expect(c).toMatch(/\[방문확인\] 내원예정/);
    expect(c).toMatch(/\[방문확인\] 부재/);
    expect(c).not.toMatch(/\[방문확인\] 방문 예정/);
    expect(c).not.toMatch(/\[방문확인\] 방문 안함/);
  });

  test('AC4 수신값 렌더 배지 (canonical→라벨)', () => {
    const c = read(CHART);
    expect(c).toMatch(/visit-call-result-badge/);
    expect(c).toMatch(/VISIT_CALL_RESULT_LABEL\[nextResv\.visit_call_result\]/);
  });
});
