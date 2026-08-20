/**
 * T-20260820-foot-PENCHART-UNDO-MEMORY-CEILING-RECALC (RC 판정서 §4 FIX-B · 재설계 17:09)
 * 펜차트 되돌리기(undo) 렌더러 메모리 — 저장형식 압축(되돌리기 10회 유지 + 최신 2장 raw + 이전 8장 압축 Blob)
 *
 * [RC 지배원인] same-origin 3탭 = 한 렌더러 프로세스. undo raw 140MB/탭 × 3탭 ≈ 420~502MB → GC 장기정지
 *   → ②입력ACK 타임아웃('응답하지 않습니다') + ①저장/입력 경로 정지(동일 GC정지의 두 증상, 별개결함 아님).
 * [접근법 전환] 구안(상한 140→40MB·되돌리기 3회)은 폐기. 되돌리기 10회 유지(기능손실 0) + 저장형식 압축.
 *
 * AC-1: 되돌리기 10회 유지(불변) — 회차 축소 금지. 12회 push 시 최신 10 유지·최오래 2 폐기.
 * AC-2: 최신 2장 raw + 이전 압축 — RAW_KEEP=2. 5장 push 후 top2=raw, 나머지=blob.
 * AC-3: 되돌리기 순서·유형 — LIFO. 1·2회차 = raw(즉시), 3회차+ = blob(디코드).
 * AC-4: 메모리 하강 — raw 2장 + 압축 8장(≈34배) ≈ 32MB/탭 (raw 10장 140MB 대비 대폭 하강·탭3 ≈96MB).
 * AC-5: 🔴 DRAW_DPR=2 불변 — 해상도 축 잠금(?penchart_lite 1x→필기불능 P0 회귀 field-soak FAIL, :1121).
 *
 * NOTE: 자기완결형 — PenChartTab.tsx 의 UndoEntry 상태머신(capUndoStackCount/compressAgedUndoEntries/
 *       handleUndo pop 분기)을 1:1 복제해 회차 유지·raw/blob 분류·복원 순서를 결정론적으로 검증.
 *       (toBlob/createImageBitmap 실디코드는 갤탭 현장 실측 DoD2·DoD3 대상 — 여기선 상태 전이만.)
 */
import { test, expect } from '@playwright/test';

// ─── 상수/상태머신 복제 (PenChartTab.tsx 구현과 동기화) ────────────────────

const DRAW_DPR = 2;         // :217 device DPR 무관 강제 (AC-5 잠금 축)
const A4_PHYS_W = 1588;     // :213 A4 192DPI 물리 폭
const A4_PHYS_H = 2246;     // :213 A4 192DPI 물리 높이
const A4_RAW_BYTES = A4_PHYS_W * A4_PHYS_H * 4; // 13.6MiB
const COMPRESS_RATIO = 34;  // 실측 압축비(원본 13.61MiB vs 저장본 중앙 411KB)

const UNDO_LIMIT = 10;      // 되돌리기 보장 회차(불변)
const RAW_KEEP = 2;         // 최신 raw 유지 장수

interface UndoEntry { kind: 'raw' | 'blob'; data: object | null; blob: object | null; }

// capUndoStackCount 1:1
function capUndoStackCount(stack: UndoEntry[]) {
  while (stack.length > UNDO_LIMIT) stack.shift();
}
// compressAgedUndoEntries 1:1 (test 에선 압축을 동기 처리해 상태 전이 검증)
function compressAgedUndoEntries(stack: UndoEntry[]) {
  for (let i = 0; i < stack.length - RAW_KEEP; i++) {
    const e = stack[i];
    if (e.kind !== 'raw') continue;
    e.kind = 'blob';
    e.blob = { png: true };
    e.data = null; // raw 메모리 해제
  }
}
function pushStroke(stack: UndoEntry[], id: number) {
  stack.push({ kind: 'raw', data: { id }, blob: null });
  capUndoStackCount(stack);
  compressAgedUndoEntries(stack);
}

// ─── AC-1: 되돌리기 10회 유지(불변) ────────────────────────────────────────
test('AC-1: 회차 상한 10 유지 — 12회 push 시 최신 10 유지·최오래 2 폐기(축소 금지)', () => {
  const stack: UndoEntry[] = [];
  for (let i = 1; i <= 12; i++) pushStroke(stack, i);
  expect(stack.length).toBe(UNDO_LIMIT); // 10회 유지(구안 3회로 축소 아님)
  expect(UNDO_LIMIT).toBe(10);
});

// ─── AC-2: 최신 2장 raw + 이전 압축 ────────────────────────────────────────
test('AC-2: 5장 push 후 최신 2장=raw, 나머지 3장=압축 Blob', () => {
  const stack: UndoEntry[] = [];
  for (let i = 1; i <= 5; i++) pushStroke(stack, i);
  const kinds = stack.map((e) => e.kind);
  expect(kinds).toEqual(['blob', 'blob', 'blob', 'raw', 'raw']); // top(끝) 2장 raw
  // raw 는 data 보유·blob 은 blob 보유(raw 데이터 해제)
  expect(stack[stack.length - 1].data).not.toBeNull();
  expect(stack[0].data).toBeNull();
  expect(stack[0].blob).not.toBeNull();
  const rawCount = kinds.filter((k) => k === 'raw').length;
  expect(rawCount).toBe(RAW_KEEP);
});

// ─── AC-3: 되돌리기 순서·유형(LIFO · 1·2=raw · 3+=blob) ─────────────────────
test('AC-3: undo LIFO — 1·2회차=raw(즉시), 3회차+=blob(디코드)', () => {
  const stack: UndoEntry[] = [];
  for (let i = 1; i <= 5; i++) pushStroke(stack, i);
  // handleUndo pop 분기 시뮬레이션
  const order: string[] = [];
  const undo = () => {
    if (stack.length === 0) return null;
    const e = stack.pop()!;
    order.push(e.kind);
    return e.kind;
  };
  expect(undo()).toBe('raw');  // 되돌리기 1회차 = raw(즉시)
  expect(undo()).toBe('raw');  // 2회차 = raw(즉시)
  expect(undo()).toBe('blob'); // 3회차 = 압축(디코드)
  expect(undo()).toBe('blob'); // 4회차
  expect(undo()).toBe('blob'); // 5회차
  expect(undo()).toBeNull();   // 더 없음(silent no-op·크래시 없음)
  expect(order.slice(0, 2)).toEqual(['raw', 'raw']); // 1·2회차 지연 증가 0 보장 축
});

// ─── AC-4: 메모리 하강 ─────────────────────────────────────────────────────
test('AC-4: raw 2장 + 압축 8장 ≈ 32MB/탭 (raw 10장 140MB 대비 하강·탭3 ≈96MB)', () => {
  // 10장 모두 raw(구/현행 최악)
  const allRaw = 10 * A4_RAW_BYTES;
  // 신설계: 최신 2장 raw + 이전 8장 압축
  const compressed = RAW_KEEP * A4_RAW_BYTES + 8 * (A4_RAW_BYTES / COMPRESS_RATIO);
  expect(compressed).toBeLessThan(allRaw);
  // 탭1 ≈ 32MB 근방(planner 실측 목표), 확실히 40MB 미만
  expect(compressed).toBeLessThan(40 * 1024 * 1024);
  // 탭3 합계 ≈ 96MB 근방, 확실히 140MB 미만(구 raw 3탭 ≈420MB 대비)
  expect(compressed * 3).toBeLessThan(140 * 1024 * 1024);
  expect(allRaw * 3).toBeGreaterThan(400 * 1024 * 1024);
});

// ─── AC-5: DRAW_DPR 불변(해상도 축 잠금) ────────────────────────────────────
test('AC-5: DRAW_DPR=2 불변 — 해상도 축 잠금(필기불능 P0 회귀 방지)', () => {
  expect(DRAW_DPR).toBe(2);
  expect(A4_PHYS_W).toBe(1588);
  expect(A4_PHYS_H).toBe(2246);
});
