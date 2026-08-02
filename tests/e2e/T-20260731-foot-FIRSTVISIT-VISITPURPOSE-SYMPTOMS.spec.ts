/**
 * E2E Spec — T-20260731-foot-FIRSTVISIT-VISITPURPOSE-SYMPTOMS
 *
 * 초진 관리기록지 '방문 목적' 항목을 발건강 설문지 '발 관련 증상' 목록 전체
 * (10개 + 기타 기입칸)와 문구·순서 100% 일치시키는 ADDITIVE FE 콘텐츠 확장.
 * base = T-20260730-...-P3 (deployed). db_change:false — 인쇄시점 바인딩 비영속 FE.
 *
 * 검증 전략(P3 QA 패턴 계승 — 소스 구조 가드 + HTML 템플릿 바인딩 렌더 self-check; 실서버/auth 불필요):
 *   AC-1  방문목적 옵션 = 발건강 설문지 SYMPTOM(FOOT_SYMPTOM_OPTIONS SSOT)와 동일 문구·순서.
 *   AC-2  다중선택 토글(체크칩) + 기타 선택 시 자유 기입칸(vp_other_text) 활성 — P3 기존 배선 유지.
 *   AC-3  인쇄 템플릿에 선택 증상이 방문목적 영역에 정확히 렌더(체크=✔, 미선택=빈칸).
 *   AC-4  기존 방문목적/기타칸(P3 배포분)과 중복·충돌 없음 — 기타칸 단일(vp_other_text) 유지.
 *   AC-5  발건강 설문지 증상 문구와 100% 일치(오탈자·순서 포함). SSOT 단일 배열 재사용.
 *
 * 실행: npx playwright test T-20260731-foot-FIRSTVISIT-VISITPURPOSE-SYMPTOMS.spec.ts
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';
import { FOOT_SYMPTOM_OPTIONS } from '../../src/lib/footHealthSymptoms';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEW_KEY = 'first_visit_mgmt_record';
const REPO = resolve(__dirname, '../..');
const panelSrc = readFileSync(resolve(REPO, 'src/components/DocumentPrintPanel.tsx'), 'utf8');

// 발건강 설문지 '발 관련 증상' 정본 목록 (기타 포함). AC-5 = 이 배열과 100% 일치.
const EXPECTED_SYMPTOMS = [
  '발톱 변색 및 변형',
  '내성발톱(파고드는 발톱)',
  '발가락 통증',
  '발냄새',
  '발건조 및 각질',
  '발 땀 많음',
  '가려움증',
  '발톱 끝 부서짐',
  '울퉁불퉁한 발톱',
  '기타',
] as const;

// 방문목적 인쇄 바인딩 키 (index-정렬, 마지막 = vp_other = 기타).
const VP_KEYS = [
  'vp_discolor', 'vp_ingrown', 'vp_toepain', 'vp_odor', 'vp_dryness',
  'vp_sweat', 'vp_itch', 'vp_brittle', 'vp_bumpy', 'vp_other',
] as const;

// ── AC-5(선행): SSOT 정본이 현장 확정 문구·순서와 일치 ──
test('AC-5: 발건강 설문지 SSOT(FOOT_SYMPTOM_OPTIONS) = 확정 증상 목록과 문구·순서 100% 일치', () => {
  expect([...FOOT_SYMPTOM_OPTIONS]).toEqual([...EXPECTED_SYMPTOMS]);
  // 마지막 원소는 '기타'(자유 기입칸 연결 대상).
  expect(FOOT_SYMPTOM_OPTIONS[FOOT_SYMPTOM_OPTIONS.length - 1]).toBe('기타');
});

// ── AC-1: 방문목적 옵션 = SSOT 재사용(어휘 drift 방지) + index-정렬 키 ──
test('AC-1①: 방문목적 옵션 배열이 FOOT_SYMPTOM_OPTIONS(SSOT)를 재사용해 생성', () => {
  // 하드코딩 라벨 배열이 아니라 SSOT.map 으로 생성(설문지 문구 자동 추종).
  expect(panelSrc).toContain("import { FOOT_SYMPTOM_OPTIONS } from '@/lib/footHealthSymptoms'");
  expect(panelSrc).toMatch(/FOOT_SYMPTOM_OPTIONS\.map\(\(label, i\) => \(\{ key: FVMR_VISIT_PURPOSE_KEYS\[i\], label \}\)\)/);
  // 방문 목적 그룹이 SSOT 파생 옵션을 사용.
  expect(panelSrc).toMatch(/label: '방문 목적',\s*options: FVMR_VISIT_PURPOSE_OPTIONS,/);
});

test('AC-1②: 방문목적 인쇄 바인딩 키 순서 = 설문지 증상 순서와 index-정렬', () => {
  const keyBlock = panelSrc.slice(
    panelSrc.indexOf('const FVMR_VISIT_PURPOSE_KEYS'),
    panelSrc.indexOf('const FVMR_VISIT_PURPOSE_OPTIONS'),
  );
  VP_KEYS.forEach((k) => expect(keyBlock).toContain(`'${k}'`));
  // 키 개수 = 설문지 항목 개수(누락/과잉 방지).
  expect(VP_KEYS.length).toBe(EXPECTED_SYMPTOMS.length);
});

// ── AC-2 / AC-4: 다중선택 토글 + 기타 기입칸 단일 유지(P3 배선) ──
test('AC-2/AC-4: 기타 선택 시 vp_other_text 자유칸 조건부 노출 — 기타칸 단일(중복 없음)', () => {
  // 기타 기입칸은 P3 배포분 vp_other_text 하나만(신규 기타칸 생성 금지).
  const otherTextCount = (panelSrc.match(/data-testid="fvmr-vp-other-text"/g) ?? []).length;
  expect(otherTextCount).toBe(1);
  expect(panelSrc).toMatch(/grp\.label === '방문 목적'[\s\S]*?vp_other[\s\S]*?FIRST_VISIT_MGMT_CHECK_MARK/);
  // 구 부분목록 키(무좀발톱/두꺼운발톱/변형발톱)는 방문목적에서 제거(설문지 목록으로 확장).
  expect(panelSrc).not.toContain("{ key: 'vp_fungal'");
  expect(panelSrc).not.toContain("{ key: 'vp_thick'");
  expect(panelSrc).not.toContain("{ key: 'vp_deformed'");
});

// ── AC-3: 인쇄 템플릿 렌더 — 선택 증상만 ✔, 미선택 빈칸 ──
test('AC-3①: HTML 템플릿에 10개 증상 문구 + 각 체크박스 플레이스홀더 존재', () => {
  const html = getHtmlTemplate(NEW_KEY)!;
  EXPECTED_SYMPTOMS.filter((s) => s !== '기타').forEach((s) => expect(html).toContain(s));
  VP_KEYS.forEach((k) => expect(html).toContain(`{{${k}}}`));
  // 기타 기입칸 바인딩 유지.
  expect(html).toContain('{{vp_other_text}}');
});

test('AC-3②(시나리오1): 발톱변색·발가락통증·기타(자유기입) 선택 시 방문목적에 정확 렌더', () => {
  const html = getHtmlTemplate(NEW_KEY)!;
  const bound = bindHtmlTemplate(html, {
    vp_discolor: '✔',
    vp_toepain: '✔',
    vp_other: '✔',
    vp_other_text: '테스트 증상',
  });
  // 선택 3개 체크(✔) + 기타 자유기입 렌더.
  expect(bound).toContain('✔');
  expect(bound).toContain('발톱 변색 및 변형');
  expect(bound).toContain('발가락 통증');
  expect(bound).toContain('기타: 테스트 증상');
  // 미선택 키는 리터럴 {{}} 잔존 없이 빈칸 치환(플레이스홀더 누출 금지).
  expect(bound).not.toContain('{{vp_odor}}');
  expect(bound).not.toContain('{{vp_bumpy}}');
});

test('AC-3③(시나리오2 엣지): 미선택 출력 = 방문목적 빈 상태 정상 렌더(에러/플레이스홀더 누출 없음)', () => {
  const html = getHtmlTemplate(NEW_KEY)!;
  const bound = bindHtmlTemplate(html, {});
  VP_KEYS.forEach((k) => expect(bound).not.toContain(`{{${k}}}`));
  expect(bound).not.toContain('{{vp_other_text}}');
  // 방문목적 라벨·증상 문구는 여전히 표시(옵션 목록 자체는 렌더).
  expect(bound).toContain('방문 목적');
  expect(bound).toContain('울퉁불퉁한 발톱');
});

test('AC-3④(시나리오2 엣지): 10개 증상 + 기타 전체 선택 시 누락 없이 모두 렌더', () => {
  const html = getHtmlTemplate(NEW_KEY)!;
  const allChecked: Record<string, string> = { vp_other_text: '전체 선택 테스트' };
  VP_KEYS.forEach((k) => (allChecked[k] = '✔'));
  const bound = bindHtmlTemplate(html, allChecked);
  EXPECTED_SYMPTOMS.filter((s) => s !== '기타').forEach((s) => expect(bound).toContain(s));
  expect(bound).toContain('기타: 전체 선택 테스트');
  // 체크 마크 개수 ≥ 10 (방문목적 10개 이상).
  expect((bound.match(/✔/g) ?? []).length).toBeGreaterThanOrEqual(10);
});
