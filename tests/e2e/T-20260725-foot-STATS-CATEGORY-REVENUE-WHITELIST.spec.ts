/**
 * E2E spec — T-20260725-foot-STATS-CATEGORY-REVENUE-WHITELIST
 * 통계 > "시술 종류별 매출"(Stats.tsx → CategorySection) 6개 화이트리스트 표시 필터.
 *
 * 요구(planner NEW-TASK MSG-20260725-212206-71dv):
 *   비가열레이저 / 가열레이저 / 포돌로게(내성) / Reborn(각질) / 풋화장품 / 진찰료(기본·서류·검사비)
 *   6개만 표기. 나머지 카테고리는 단순 숨김('기타' 합산 없음). 매출 산식/집계 불변 — 표시만 필터.
 *
 * 검증 구성:
 *   AC1 (순수 함수, DB 비의존): applyCategoryWhitelist 가 2026-07-25 prod 방출 코드셋을
 *        정확히 6버킷으로 매핑·합산하고, 화이트리스트 외 코드(풋케어·수액·처방약·상병·기타·처방·
 *        trial·preconditioning·iv)를 전부 제외한다. '기타' 합산 버킷 미생성.
 *   AC2 (순수 함수): 진찰료 버킷이 기본+검사+진료 3코드를 하나로 합산(세부 항목 묶임).
 *   AC3 (순수 함수): 고정 표시 순서 + 매출 산식 불변(방출 sessions/amount 를 합산만).
 *   AC4 (소스 정적 가드): categoryLabel(wl_*) 6버킷 라벨 SSOT + CategorySection 이 필터 적용.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {
  applyCategoryWhitelist,
  categoryLabel,
  CATEGORY_WHITELIST,
  type CategoryRow,
} from '../../src/lib/stats';

// 2026-07-25 prod 실측(foot_stats_by_category 서울오리진점 방출) 대표 코드셋.
const PROD_EMIT: CategoryRow[] = [
  { category: 'unheated_laser', sessions: 860, amount: 196_320_000 },
  { category: 'heated_laser', sessions: 141, amount: 38_400_000 },
  { category: 'podologue', sessions: 101, amount: 26_850_000 },
  { category: '상병', sessions: 113, amount: 3_430_890 },
  { category: '기본', sessions: 67, amount: 1_943_100 },
  { category: 'trial', sessions: 121, amount: 1_455_000 },
  { category: '풋케어', sessions: 45, amount: 1_359_120 },
  { category: 'reborn', sessions: 3, amount: 1_050_000 },
  { category: '처방약', sessions: 39, amount: 1_041_240 },
  { category: '검사', sessions: 20, amount: 982_900 },
  { category: '기타', sessions: 11, amount: 102_200 },
  { category: '풋화장품', sessions: 3, amount: 42_000 },
];

test.describe('T-20260725 STATS-CATEGORY-REVENUE-WHITELIST — 시술 종류별 매출 6버킷 화이트리스트', () => {
  test('AC1: prod 방출 코드셋 → 6버킷만 노출, 화이트리스트 외 전부 제외', () => {
    const out = applyCategoryWhitelist(PROD_EMIT);
    const labels = out.map((r) => categoryLabel(r.category));

    // 6개 화이트리스트 라벨만 (풋케어·상병·처방약·기타·trial 등은 숨김)
    expect(labels).toEqual([
      '비가열레이저',
      '가열레이저',
      '포돌로게(내성)',
      'Reborn(각질)',
      '풋화장품',
      '진찰료(기본/서류/검사비)',
    ]);

    // '기타' 합산 버킷이 생기지 않는다(단순 숨김)
    expect(labels.some((l) => l.includes('기타'))).toBe(false);

    // 숨겨진 카테고리의 매출이 어떤 버킷에도 새어들어가지 않았다
    const HIDDEN = ['상병', 'trial', '풋케어', '처방약', '기타'];
    const hiddenAmount = PROD_EMIT.filter((r) => HIDDEN.includes(r.category))
      .reduce((s, r) => s + r.amount, 0);
    const shownAmount = out.reduce((s, r) => s + r.amount, 0);
    const emitAmount = PROD_EMIT.reduce((s, r) => s + r.amount, 0);
    expect(shownAmount).toBe(emitAmount - hiddenAmount);
  });

  test('AC2: 진찰료 버킷 = 기본 + 검사 + 진료 세부항목 합산', () => {
    const rows: CategoryRow[] = [
      { category: '기본', sessions: 10, amount: 100_000 }, // 기본 진찰료(+제증명 서류는 category=기본 로 적재)
      { category: '검사', sessions: 5, amount: 50_000 }, // 검사비
      { category: '진료', sessions: 2, amount: 20_000 }, // 진료
      { category: '처방약', sessions: 9, amount: 999_999 }, // 숨김
    ];
    const out = applyCategoryWhitelist(rows);
    expect(out).toHaveLength(1);
    expect(categoryLabel(out[0].category)).toBe('진찰료(기본/서류/검사비)');
    expect(out[0].sessions).toBe(17); // 10+5+2
    expect(out[0].amount).toBe(170_000); // 100k+50k+20k, 처방약 미포함
  });

  test('AC3: 고정 표시 순서 + 매출 산식 불변(합산만)', () => {
    // 입력 순서를 뒤섞어도 화이트리스트 정의 순서로 방출
    const shuffled: CategoryRow[] = [
      { category: '풋화장품', sessions: 1, amount: 1000 },
      { category: 'reborn', sessions: 1, amount: 2000 },
      { category: 'unheated_laser', sessions: 1, amount: 3000 },
    ];
    const out = applyCategoryWhitelist(shuffled);
    expect(out.map((r) => r.category)).toEqual(['wl_unheated', 'wl_reborn', 'wl_cosmetic']);
    // 매출/회차 수치는 방출값 그대로(가공 없음)
    expect(out.find((r) => r.category === 'wl_unheated')!.amount).toBe(3000);
    expect(out.find((r) => r.category === 'wl_cosmetic')!.sessions).toBe(1);

    // 빈 입력·전부 숨김 → 빈 배열(빈 0원 버킷 미표기)
    expect(applyCategoryWhitelist([])).toEqual([]);
    expect(applyCategoryWhitelist([{ category: '수액', sessions: 9, amount: 9 }])).toEqual([]);
  });

  test('AC4: 6버킷 라벨 SSOT + CategorySection 이 화이트리스트 필터 적용(소스 가드)', () => {
    // 화이트리스트 정의 = 6개, 라벨/순서 고정
    expect(CATEGORY_WHITELIST.map((b) => b.label)).toEqual([
      '비가열레이저',
      '가열레이저',
      '포돌로게(내성)',
      'Reborn(각질)',
      '풋화장품',
      '진찰료(기본/서류/검사비)',
    ]);
    // categoryLabel 이 wl_ 버킷 코드를 라벨로 환원
    for (const b of CATEGORY_WHITELIST) {
      expect(categoryLabel(b.code)).toBe(b.label);
    }
    // CategorySection 이 실제로 applyCategoryWhitelist 를 적용한다(회귀 가드)
    const SRC = fs.readFileSync(
      path.resolve('src/components/stats/CategorySection.tsx'),
      'utf-8',
    );
    expect(SRC).toContain('applyCategoryWhitelist');
  });
});
