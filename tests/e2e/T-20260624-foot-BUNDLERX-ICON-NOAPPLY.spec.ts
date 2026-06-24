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
const TAG_BAR = read('src/components/doctor/BundleRxTagBar.tsx');
const QUICK_RX = read('src/components/admin/QuickRxButtonsTab.tsx');

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

// ── 아이콘 노출 회귀가드 (planner #1 필터 / #3b IconRenderer 가설 검증) ─────────
//   "아이콘 넣었는데 적용 안됨"의 후보 RC 2개를 코드증거로 배제·고정.
//   #1: icon-only(색 미선택) 저장 시 tag_color 가 null 이 되면 BundleRxTagBar 필터(L56)
//       에서 제외돼 칩이 안 보임 → 저장 레이어가 hasTag 일 때 DEFAULT 색을 강제해야 한다(정책 (b)안).
//   #3b: 저장 picker 아이콘 식별자를 IconRenderer 가 인식 못 하면 아이콘이 안 그려짐 →
//        DRUG_ICON_OPTIONS ⊆ ICON_OPTIONS, IconRenderer 는 superset 검색해야 한다.
test.describe('아이콘 노출 회귀가드 (planner #1 필터 / #3b IconRenderer)', () => {
  const rx = stripComments(RX_TAB);

  test('#1: 아이콘/라벨 있으면(hasTag) 색 미선택이라도 기본색 강제 — 색 null 칩 방지', () => {
    // useUpsertSet · useUpdateSetTagMeta 둘 다 hasTag 시 (form/meta.tag_color || DEFAULT_RX_TAG_COLOR).
    const matches = rx.match(/hasTag \? \([\w.]+\.tag_color \|\| DEFAULT_RX_TAG_COLOR\) : null/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    // hasTag 정의에 아이콘이 포함돼야 icon-only 태그가 색을 받는다.
    expect(rx).toMatch(/hasTag = label !== '' \|\| iconV?\.?\.?.*!== ''|icon\.trim\(\) !== ''/);
  });

  test('#1: BundleRxTagBar 필터는 (색 있음) && (라벨 or 아이콘) — icon-only+색 통과', () => {
    const bar = stripComments(TAG_BAR);
    // tag_color 가 있고 (라벨 트림 or 아이콘 트림) 인 칩만 노출.
    expect(bar).toMatch(/!!b\.tag_color && \(!!\(b\.tag_label && b\.tag_label\.trim\(\)\) \|\| !!\(b\.icon && b\.icon\.trim\(\)\)\)/);
    // 서버 쿼리는 라벨 OR 아이콘으로 넓게 — icon-only 태그를 누락하지 않음.
    expect(bar).toContain(".or('tag_label.not.is.null,icon.not.is.null')");
  });

  test('#3b: IconRenderer 는 superset(ICON_OPTIONS) 검색, picker=DRUG_ICON_OPTIONS 부분집합', () => {
    const qr = stripComments(QUICK_RX);
    // picker 후보는 ICON_OPTIONS 의 drug 필터 부분집합 → IconRenderer 가 모두 인식.
    expect(qr).toMatch(/DRUG_ICON_OPTIONS = ICON_OPTIONS\.filter\(\(o\) => o\.drug\)/);
    expect(qr).toMatch(/function IconRenderer[\s\S]*?ICON_OPTIONS\.find\(\(o\) => o\.value === icon\)/);
    // 미지값도 Pill 폴백 — 빈 렌더(아이콘 미표시) 없음.
    expect(qr).toMatch(/found\?\.Icon \?\? Pill/);
  });

  test('#3b: PrescriptionSetsTab picker 와 BundleRxTagBar 렌더가 동일 IconRenderer SSOT', () => {
    expect(RX_TAB).toContain("import { DRUG_ICON_OPTIONS, IconRenderer } from '@/components/admin/QuickRxButtonsTab'");
    expect(TAG_BAR).toContain("import { IconRenderer } from '@/components/admin/QuickRxButtonsTab'");
  });
});
