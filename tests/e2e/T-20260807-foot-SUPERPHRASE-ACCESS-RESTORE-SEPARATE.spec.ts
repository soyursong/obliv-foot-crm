/**
 * E2E spec — T-20260807-foot-SUPERPHRASE-ACCESS-RESTORE-SEPARATE
 * 진료차트 3구역(파랑박스, MedicalChartPanel 우측 패널) — 슈퍼상용구(발행서류/템플릿) 불러오기 진입점 복원 + 상용구/슈퍼상용구 분리.
 *
 * 배경(문지은 대표원장 U0ALGAAAJAV 직접 신고):
 *   3ZONE 배포(08526db9, 2026-07-31) Phase B '슈퍼상용구'→'발행서류' 개칭 + Phase A '발행 서류 (일자별)' 리스트를
 *   발행서류 탭 상단에 배치한 이후, applySuperPhrase 템플릿 '불러오기' 진입점이 일자별 리스트 아래로 묻혀
 *   현장 인지상 '진입점 소실' 회귀 발생.
 *
 * AC-1(① 회귀 복원): 발행서류 탭에서 슈퍼상용구(발행서류/템플릿) '불러오기' 진입점이 다시 보이고 동작.
 *                    applySuperPhrase 도달·실행 가능. 개칭 명칭 '발행서류'는 유지(라벨 되돌리지 않음).
 * AC-2(② 분리 별도경로): 상용구(phrase 탭)와 슈퍼상용구(발행서류/super 탭)가 서로 다른 별도 경로. 두 기능 한 탭 통합 안 됨.
 *                       상용구 탭/경로 삭제하지 않고 유지(원 캐논 '상용구 삭제' 취소).
 * AC-3(무근거 재구현 금지): applySuperPhrase(3ZONE phaseB) 재사용, 새 데이터소스/쿼리 신설 없음, db_change=false.
 * AC-4(무회귀): 3ZONE 배포분(발행 서류 일자별 리스트·1·2구역·2탭삭제) 무회귀. rx(처방세트) step3 HOLD 무간섭.
 *
 * 검증 전략:
 *   MedicalChartPanel.tsx 정본 소스 정적 검증(데이터 비의존·결정적) — repo 다수 spec과 동일한 fs 소스레벨 패턴.
 *   ⚠ 진료차트 深 패널(의사 로그인 + 실고객 컨텍스트)은 dev 로컬 검증 불가 →
 *     supervisor QA(staging 실데이터급) + field-soak(prod 실 의사컨텍스트)로 라우팅(3ZONE phaseC_browser_confirm_gate 계승).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PANEL_SRC = resolve(__dirname, '../../src/components/MedicalChartPanel.tsx');

function readSrc(p: string): string {
  return readFileSync(p, 'utf8');
}

const src = readSrc(PANEL_SRC);

// ── 시나리오 1: 슈퍼상용구 불러오기 경로 복원 (AC-1) ───────────────────────────
test.describe('시나리오1: 슈퍼상용구(발행서류/템플릿) 불러오기 진입점 복원 (AC-1)', () => {
  test('발행서류 탭에 명시 진입점 헤더 "서류 템플릿 불러오기" 존재', () => {
    expect(src).toContain('서류 템플릿 불러오기');
    expect(src).toContain('data-testid="super-phrase-template-section"');
  });

  test('applySuperPhrase 클릭 경로(super-phrase-option 버튼) 도달 가능', () => {
    expect(src).toContain('data-testid="super-phrase-option"');
    expect(src).toContain('onClick={() => applySuperPhrase(sp)}');
  });

  test('개칭 명칭 "발행서류" 탭 라벨 유지 (라벨 되돌리기 아님)', () => {
    // super 탭 라벨은 '발행서류'로 유지(3ZONE Phase B 개칭 존치)
    expect(src).toContain("{ key: 'super', label: '발행서류' }");
  });

  test('진입점(서류 템플릿 불러오기)이 발행 서류 일자별 리스트보다 상단에 위치 (묻힘 해소)', () => {
    const templateIdx = src.indexOf('data-testid="super-phrase-template-section"');
    const issuedIdx = src.indexOf('data-testid="issued-docs-section"');
    expect(templateIdx).toBeGreaterThan(-1);
    expect(issuedIdx).toBeGreaterThan(-1);
    // 템플릿 불러오기 섹션이 일자별 리스트 섹션보다 먼저 렌더(상단 복원)
    expect(templateIdx).toBeLessThan(issuedIdx);
  });
});

// ── 시나리오 2: 상용구/슈퍼상용구 분리 별도경로 (AC-2) ─────────────────────────
test.describe('시나리오2: 상용구/슈퍼상용구 분리 별도경로 유지 (AC-2)', () => {
  test('상용구(phrase) 탭 유지 — 삭제 안 됨', () => {
    expect(src).toContain("{ key: 'phrase', label: '상용구' }");
    expect(src).toContain("rightTab === 'phrase'");
  });

  test('슈퍼상용구(발행서류/super) 탭 별도 유지', () => {
    expect(src).toContain("{ key: 'super', label: '발행서류' }");
    expect(src).toContain("rightTab === 'super'");
  });

  test('두 기능이 서로 다른 탭 key(phrase ≠ super)로 분리 — 한 탭 통합 아님', () => {
    // 상단 행 탭 정의에 phrase / super 가 각각 별도 항목으로 존재
    const tabRow = src.slice(src.indexOf("{ key: 'rx', label: '처방세트' }"), src.indexOf("{ key: 'super', label: '발행서류' }") + 40);
    expect(tabRow).toContain("{ key: 'phrase', label: '상용구' }");
    expect(tabRow).toContain("{ key: 'super', label: '발행서류' }");
  });
});

// ── 시나리오 3: 무근거 재구현 금지 + 무회귀 (AC-3 / AC-4) ─────────────────────
test.describe('시나리오3: 재사용·무회귀 (AC-3 / AC-4)', () => {
  test('AC-3: applySuperPhrase 함수 재사용(신규 재구현 없음)', () => {
    expect(src).toContain('function applySuperPhrase(');
    // super_phrases 소스 조회 재사용
    expect(src).toContain(".from('super_phrases')");
  });

  test('AC-4: 발행 서류 일자별 리스트(Phase A) 무회귀 — 섹션/testid 보존', () => {
    expect(src).toContain('data-testid="issued-docs-section"');
    expect(src).toContain('발행 서류 (일자별)');
    expect(src).toContain('data-testid="issued-docs-list"');
    expect(src).toContain('data-testid="issued-doc-row"');
  });

  test('AC-4: super 탭 컨테이너 testid(right-panel-super-content) 보존', () => {
    expect(src).toContain('data-testid="right-panel-super-content"');
  });

  test('AC-4: rx(처방세트) 탭 무간섭 — 탭·콘텐츠 보존', () => {
    expect(src).toContain("{ key: 'rx', label: '처방세트' }");
    expect(src).toContain('data-testid="right-panel-rx-content"');
  });

  test('AC-4: 3ZONE 삭제분(상담/임상사진 탭) 무부활 — 탭 key 미존재', () => {
    expect(src).not.toContain("{ key: 'consult'");
    expect(src).not.toContain("{ key: 'clinical_photos'");
  });
});
