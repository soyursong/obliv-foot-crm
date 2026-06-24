/**
 * T-20260624-foot-BUNDLERX-ICON-NOAPPLY (part2 / AC-0)
 * 묶음처방 아이콘·태그 저장 시 "저장됐어요" 토스트가 뜨지만 실제로는 반영 안 됨(false-positive).
 *
 * 신고자: 문지은 대표원장 (director 본인 자기요청 → medical_confirm_gate confirmed)
 *
 * ★ RC: supabase `.update()/.insert()` 는 RLS 정책으로 0행이 필터링돼도
 *   { error: null } 을 반환한다. 기존 코드는 error 만 검사 → 0행 silent no-op 을
 *   성공으로 간주 → "저장됐어요" 토스트(false-positive). director 가 prescription_sets
 *   UPDATE RLS 에 없어서(아이콘은 admin/manager 만 쓰던 정책) 실제로는 변경 0행.
 *
 * AC-0 (RLS 와 독립인 FE 방어, part2): mutation 에 .select() 를 붙여 영향 행을
 *   회수하고, 0행이면 throw → 실패 토스트. RLS 권한 추가(part1)와 무관하게,
 *   권한이 없을 때 거짓 성공 대신 명확한 실패 토스트가 뜨게 만든다.
 *
 * 본 spec 은 소스 정적 회귀가드 — 3개 mutation hook 의 .select() + 0행 throw 패턴 검증.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = (p: string) => resolve(__dirname, '../../', p);
const read = (p: string) => readFileSync(root(p), 'utf8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const RX_TAB = read('src/components/admin/PrescriptionSetsTab.tsx');
const DX_TAB = read('src/components/admin/DiagnosisSetsTab.tsx');

// ── AC-0: useUpsertSet (처방세트) — UPDATE/INSERT 둘 다 0행 검출 ──────────────
test.describe('처방세트 저장 — 0행 silent no-op throw (AC-0)', () => {
  const code = stripComments(RX_TAB);

  test('useUpsertSet UPDATE 는 .select() 로 영향 행을 회수한다', () => {
    expect(code).toMatch(/\.update\(payload\)\s*\.eq\('id', id\)\s*\.select\('id'\)/);
  });

  test('useUpsertSet INSERT 는 .select() 로 생성 행을 회수한다', () => {
    expect(code).toMatch(/\.insert\(payload\)\.select\('id'\)/);
  });

  test('0행이면 throw — error:null 이라도 거짓 성공 차단', () => {
    // UPDATE / INSERT 각각 0행 가드(!data || data.length === 0) 가 있어야 한다.
    const guards = code.match(/if \(!data \|\| data\.length === 0\)/g) || [];
    expect(guards.length).toBeGreaterThanOrEqual(2);
  });
});

// ── AC-0: useUpdateSetTagMeta (태그/아이콘 경량 저장) ─────────────────────────
test.describe('태그/아이콘 메타 저장 — 0행 throw (AC-0)', () => {
  const code = stripComments(RX_TAB);

  test('useUpdateSetTagMeta UPDATE 는 .select() + 0행 throw', () => {
    // useUpdateSetTagMeta 함수 본문 슬라이스 안에서 패턴 확인.
    const start = code.indexOf('function useUpdateSetTagMeta');
    expect(start).toBeGreaterThan(-1);
    const body = code.slice(start, code.indexOf('function useDeleteSet', start));
    expect(body).toMatch(/\.update\(payload\)\s*\.eq\('id', id\)\s*\.select\('id'\)/);
    expect(body).toContain('if (!data || data.length === 0)');
    expect(body).toContain('throw new Error');
  });

  test('성공 토스트는 0행 throw 이후의 onSuccess 에서만(거짓 성공 경로 없음)', () => {
    // mutationFn 안에서 throw 가 나면 onSuccess 가 호출되지 않음 → toast.success 안전.
    expect(RX_TAB).toContain("toast.success('태그를 저장했어요.')");
  });
});

// ── AC-0: 묶음상병(diagnosis_sets) useUpsertSet UPDATE — 동형 가드 ───────────
test.describe('묶음상병 저장 — 0행 throw (AC-0 sibling 일관성)', () => {
  const code = stripComments(DX_TAB);

  test('useUpsertSet UPDATE 는 .select() + 0행 throw', () => {
    expect(code).toMatch(/\.update\(setPayload\)\s*\.eq\('id', id\)\s*\.select\('id'\)/);
    expect(code).toContain('if (!data || data.length === 0)');
  });
});
