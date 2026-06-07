/**
 * T-20260607-foot-RXQUICK-ICON-DRUGFILTER
 * 빠른처방 아이콘 picker: 전체 노출 → 약·처방 관련 서브셋만 필터
 *
 * AC-1: 추가/편집 picker는 약 관련 아이콘(DRUG_ICON_OPTIONS) 서브셋만 노출
 * AC-2: 기존 저장값 회귀 없음 — ICON_OPTIONS 전체 레지스트리에 레거시 비-약 아이콘 보존
 *       (IconRenderer가 차트/목록에서 저장값을 그대로 렌더 → 항목 제거 금지)
 * AC-3: 약 서브셋 충분성 — 8개 이상 확보
 *
 * 큐레이션 약 아이콘(10종): pill 알약 / tablets 정제 / syringe 주사 /
 *   flask-conical 물약 / flask-round 시럽 / droplet 점안액 / droplets 수액 /
 *   beaker 조제 / briefcase-medical 약상자 / test-tube 검체
 * 레거시 비-약(picker 비노출·렌더 보존): activity, zap, heart, stethoscope, thermometer, bandage
 *
 * QuickRxButtonsTab.tsx 소스 정적 검사 + 큐레이션 목록 로직 재현.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TAB_SRC = resolve(__dirname, '../../src/components/admin/QuickRxButtonsTab.tsx');
const src = readFileSync(TAB_SRC, 'utf8');

// 큐레이션 정의(구현과 동기) — 소스 회귀 시 즉시 깨지도록 명시 열거
const DRUG_VALUES = [
  'pill', 'tablets', 'syringe', 'flask-conical', 'flask-round',
  'droplet', 'droplets', 'beaker', 'briefcase-medical', 'test-tube',
];
const LEGACY_NONDRUG_VALUES = [
  'activity', 'zap', 'heart', 'stethoscope', 'thermometer', 'bandage',
];

// ── AC-1: picker가 DRUG 서브셋만 노출 ───────────────────────────────────────
test.describe('아이콘 picker 약 서브셋 노출 — AC-1', () => {
  test('DRUG_ICON_OPTIONS 파생 + picker가 이를 map 한다(ICON_OPTIONS 전체 아님)', () => {
    expect(src).toContain('export const DRUG_ICON_OPTIONS = ICON_OPTIONS.filter((o) => o.drug)');
    // picker는 약 서브셋만 순회
    expect(src).toContain('{DRUG_ICON_OPTIONS.map(({ value, label, Icon })');
    // 이전: 전체 ICON_OPTIONS 노출 회귀 가드
    expect(src).not.toContain('{ICON_OPTIONS.map(({ value, label, Icon })');
  });

  test('약 아이콘 10종이 drug:true 로 등록됨', () => {
    for (const v of DRUG_VALUES) {
      const re = new RegExp(`value: '${v}',[\\s\\S]{0,80}drug: true`);
      expect(src, `${v} 가 drug:true 여야 함`).toMatch(re);
    }
  });
});

// ── AC-2: 레거시 비-약 아이콘 렌더 보존(회귀 금지) ────────────────────────────
test.describe('기존 저장값 회귀 없음 — AC-2', () => {
  test('레거시 비-약 아이콘이 레지스트리에 보존(IconRenderer 렌더 호환)', () => {
    for (const v of LEGACY_NONDRUG_VALUES) {
      expect(src, `${v} 레지스트리 항목 제거 금지`).toContain(`value: '${v}'`);
    }
  });

  test('레거시 아이콘은 drug:false(picker 비노출)', () => {
    for (const v of LEGACY_NONDRUG_VALUES) {
      const re = new RegExp(`value: '${v}',[\\s\\S]{0,80}drug: false`);
      expect(src).toMatch(re);
    }
  });

  test('IconRenderer는 전체 ICON_OPTIONS에서 저장값을 해석(서브셋 아님)', () => {
    expect(src).toContain('const found = ICON_OPTIONS.find((o) => o.value === icon)');
  });

  test('저장 payload는 form.icon 식별자 그대로 — 컬럼/식별자 불변', () => {
    expect(src).toContain('icon: form.icon');
  });
});

// ── AC-3: 약 서브셋 충분성(8개+) ────────────────────────────────────────────
test.describe('약 서브셋 충분성 — AC-3', () => {
  test('drug:true 항목 ≥ 8개', () => {
    const count = (src.match(/drug: true/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(8);
  });

  test('큐레이션 목록은 정확히 10종(중복 없음)', () => {
    const unique = new Set(DRUG_VALUES);
    expect(unique.size).toBe(10);
  });

  test('신규 폼 기본 아이콘(pill)은 약 서브셋에 포함 — picker 하이라이트 정상', () => {
    expect(src).toContain("icon: 'pill'");
    expect(DRUG_VALUES).toContain('pill');
  });
});
