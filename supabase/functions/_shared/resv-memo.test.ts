/**
 * _shared/resv-memo.test.ts — T-20260804-dopamine-RESVSIDEBAR-MEMO-CRMSYNC-BIDIR-ALLBRANCH (lane B)
 * deno test supabase/functions/_shared/resv-memo.test.ts
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { assembleMemo, isSuspectedTruncationClobber, type MemoEntry } from './resv-memo.ts';

// ── isSuspectedTruncationClobber (INTERIM preserve 가드 진리표) ──
Deno.test('guard: 최경옥 repro — 축약 replace 억제(true)', () => {
  // 기존 예약메모(booking) → 사이드바 "테스트"(축약, 비-superset) → clobber 의심
  assertEquals(isSuspectedTruncationClobber('발톱무좀 재진, 우측 엄지 통증 상담 예정', '테스트'), true);
});
Deno.test('guard: idempotent 동일값 → false(정상 no-op replace)', () => {
  assertEquals(isSuspectedTruncationClobber('상담 메모', '상담 메모'), false);
});
Deno.test('guard: superset/append(기존 포함) → false(정상 replace)', () => {
  assertEquals(isSuspectedTruncationClobber('상담 메모', '상담 메모\n추가: 재방문 예정'), false);
});
Deno.test('guard: 확장(더 김, 비-superset) → false(정상 replace 허용)', () => {
  assertEquals(isSuspectedTruncationClobber('짧은메모', '완전히 다른 더 긴 내용의 메모입니다'), false);
});
Deno.test('guard: 기존 empty → false(보존할 것 없음)', () => {
  assertEquals(isSuspectedTruncationClobber('', '테스트'), false);
  assertEquals(isSuspectedTruncationClobber(null, '테스트'), false);
});
Deno.test('guard: 유입 empty → false(상위 no-op skip 처리)', () => {
  assertEquals(isSuspectedTruncationClobber('기존 메모', ''), false);
});
Deno.test('guard: 짧지만 substring 보존(축약이나 superset이면 아님) — 비-superset+짧음만 true', () => {
  // "가나다라" → "가나" : 비-superset("가나"는 "가나다라"를 포함 안 함) + 더 짧음 → true
  assertEquals(isSuspectedTruncationClobber('가나다라', '가나'), true);
});
Deno.test('guard: trim 후 동일 → false', () => {
  assertEquals(isSuspectedTruncationClobber('  메모  ', '메모'), false);
});

// ── assembleMemo (사이드바 표시용 full memo 조립) ──
const E = (content: string | null, source_system: string | null, created_at: string): MemoEntry => ({ content, source_system, created_at });

Deno.test('assemble: 빈 timeline → null', () => {
  assertEquals(assembleMemo([]), null);
  assertEquals(assembleMemo([E('', null, '2026-08-01T00:00:00Z'), E('   ', 'dopamine', '2026-08-02T00:00:00Z')]), null);
});
Deno.test('assemble: dopamine(외부) 최상단, 그다음 최신순', () => {
  const out = assembleMemo([
    E('사람저작-오래됨', null, '2026-08-01T00:00:00Z'),
    E('도파민메모', 'dopamine', '2026-08-02T00:00:00Z'),
    E('사람저작-최신', null, '2026-08-03T00:00:00Z'),
  ]);
  // 외부(dopamine) 먼저 → 그다음 사람저작 최신순
  assertEquals(out, '도파민메모\n\n사람저작-최신\n\n사람저작-오래됨');
});
Deno.test('assemble: 단일 dopamine 행', () => {
  assertEquals(assembleMemo([E('테스트', 'dopamine', '2026-07-30T09:44:47Z')]), '테스트');
});
Deno.test('assemble: 빈 content 행 제외', () => {
  assertEquals(assembleMemo([E('유효', null, '2026-08-01T00:00:00Z'), E('', null, '2026-08-02T00:00:00Z')]), '유효');
});
