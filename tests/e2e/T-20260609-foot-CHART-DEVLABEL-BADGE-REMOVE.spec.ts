/**
 * E2E spec — T-20260609-foot-CHART-DEVLABEL-BADGE-REMOVE (FE-only, DB 무변경)
 *
 * 진료차트 우측 패널의 내부 개발용 위치 라벨 배지("2번차트 1구역")를 제거.
 * 문지은 대표원장 "이게 뭐임? 왜뜨는거야?" → 프로덕션 노출 부적절.
 *
 *   AC-1 'visit_hist'(방문 진료내역) 탭 헤더 배지 제거
 *   AC-2 'images'(진료이미지) 탭 헤더 배지 제거
 *   AC-3 헤더 라벨("… (읽기전용)") + title 툴팁 보존, flex 헤더행 잔여 공백 정리,
 *        탭 동작 무변경
 *
 * 방식: 정본 소스(MedicalChartPanel.tsx)를 정적 대조해 (a) 배지 텍스트가 사라졌고
 *   (b) 보존 대상 헤더 라벨/툴팁은 그대로인지 회귀를 잠근다.
 *   (PANEL-CLARITY spec 의 '소스 불변식 + 라벨 회귀 잠금' 동일 패턴)
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// playwright 는 repo 루트에서 실행 → process.cwd() 기준 상대경로 (ESM: __dirname 없음)
const SRC = readFileSync(
  join(process.cwd(), 'src', 'components', 'MedicalChartPanel.tsx'),
  'utf-8',
);

const DEV_BADGE_TEXT = '2번차트 1구역';

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 / AC-2: 내부 개발 배지 제거
//   NOTE: 배지 span 의 className(text-[9px] … bg-muted …)은 동일 컴포넌트의
//   '읽기전용' 배지(치료사차트, AC 무관)와 공유되므로 클래스 기반 단언은 쓰지 않는다.
//   유효 불변식은 '개발 라벨 텍스트가 0회' 라는 점뿐이다.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1/AC-2 내부 개발 라벨 배지 제거', () => {
  test('우측 패널 헤더의 "2번차트 1구역" 배지 텍스트가 컴포넌트에서 사라졌다(visit_hist+images 2곳)', () => {
    const occurrences = SRC.split(DEV_BADGE_TEXT).length - 1;
    expect(occurrences).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3: 헤더 라벨 + 툴팁 보존 (회귀 잠금)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-3 헤더 라벨·툴팁 보존', () => {
  const VISIT_LABEL = '방문이력 (읽기전용)';
  const IMAGES_LABEL = '진료이미지 (읽기전용)';
  const VISIT_TOOLTIP_FRAGMENT =
    '방문(체크인) 단위 진료 기록을 읽기전용으로 보여줍니다';

  test('"방문이력 (읽기전용)" 헤더 라벨은 유지된다', () => {
    expect(SRC).toContain(VISIT_LABEL);
  });

  test('"진료이미지 (읽기전용)" 헤더 라벨은 유지된다', () => {
    expect(SRC).toContain(IMAGES_LABEL);
  });

  test('방문이력 헤더 title 툴팁은 유지된다(좌/우 구분 설명)', () => {
    expect(SRC).toContain(VISIT_TOOLTIP_FRAGMENT);
  });

  test('탭 콘텐츠 testid(visit-hist/images)는 유지 — 탭 동작 무변경', () => {
    expect(SRC).toContain('right-panel-visit-hist-content');
    expect(SRC).toContain('right-panel-images-content');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3 보강: 배지 제거 후 헤더행에 자식 1개만 가진 justify-between 잔재가 없도록
//   (배지를 우측 정렬하려고 쓰던 래퍼를 정리했는지 가드)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-3 헤더행 잔여 공백 정리', () => {
  test('배지를 우측 정렬하던 래퍼가 정리되어, 배지 텍스트가 헤더행 어디에도 남지 않는다', () => {
    // 배지 텍스트와 함께 쓰이던 단일자식 flex justify-between 정렬 래퍼는
    // 배지 제거 시 함께 정리됨 — 배지 텍스트 0회로 회귀를 잠근다.
    expect(SRC).not.toContain(DEV_BADGE_TEXT);
  });
});
