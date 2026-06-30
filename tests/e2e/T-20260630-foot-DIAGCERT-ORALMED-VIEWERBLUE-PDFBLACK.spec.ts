/**
 * Unit + 정적 가드 spec — T-20260630-foot-DIAGCERT-ORALMED-VIEWERBLUE-PDFBLACK (A안 확정)
 *
 * 진단서 경구약 항목: 실장 입력값 정확표시 + 대괄호 제거 + 뷰어 파란글씨 / 서류(PDF) 검정.
 *
 * A안(문지은 대표원장 'a' 선택, MSG-20260630-223241-5xq0):
 *   - 실장 요청서 화면(OpinionRequestBox)에 '경구약 사유' 전용 입력칸 신설(AC6) — staff_memo 매핑 비채택.
 *   - 신규 입력값 = form_submissions.field_data.oral_med_reason(JSONB ADDITIVE, DDL 불요).
 *   - 원장 진단서 작성창에서 oralXReason 으로 prefill → 경구약X 괄호(`[…경구약 복용중]`) 치환(대괄호 제거).
 *   - 뷰어(작성창) 경구약 미리보기 = 파란글씨(text-blue-600). 서류 출력(printOpinionDoc) = plain text(검정).
 *
 * AC1: 실장 작성내용이 대괄호 없이 경구약 섹션에 정확히 노출 (substituteOralXReason / composeOpinionDoc).
 * AC2: 원장 뷰어에서 파란글씨(text-blue-600 프리뷰) — OpinionDocTab.
 * AC3: 서류 발급/PDF = 검정(기본). ★회귀가드 — printOpinionDoc 경로에 파란색 0(파괴적 회귀 차단).
 * AC4: 뷰어 렌더 vs 서류 렌더 경로 분기(기존 render-split 재사용 — 평행 hack 금지).
 * AC5: 실장 미입력 시 기존 동작(빈 reason → 괄호 보존 = 원장 직접 입력 유도).
 * AC6: OpinionRequestBox '경구약 사유' 전용 입력칸 + field_data.oral_med_reason 저장 + 큐→작성창 연동.
 *
 * 순수 함수 + 소스 정적 가드 → auth/page 불요(unit 프로젝트).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  substituteOralXReason,
  composeOpinionDoc,
  needsOralXReason,
  ORAL_X_DEFAULT_REASON,
  ORAL_X_REASON_RE,
  type OpinionGroupSection,
} from '../../src/lib/opinionDocCompose';
import { buildContraindTemplates, type OpinionSourceSection } from '../../src/lib/contraindicationCombine';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

// 운영 DB 템플릿 모사 — 경구약X 진단서 phrase 에 `[…경구약 복용중]` 괄호가 박힌 상태(현장 데이터).
//   (코드 seed/하드코드엔 괄호 없음 — 운영 admin CRUD 로 phrase 편집됨 = 원장 제보 근인.)
const BRACKET_PHRASE = `[${ORAL_X_DEFAULT_REASON}]으로 항진균제 복용이 불가하여 외용제로 치료를 진행합니다.`;
const SECTIONS: OpinionGroupSection[] = [
  {
    title: '진단서',
    options: [{ key: 'oral_x', label: '경구약 X', phrase: BRACKET_PHRASE }],
  },
];

// ── AC1: 실장 입력값으로 정확 치환 + 대괄호 제거 ────────────────────────────────
test('AC1 — substituteOralXReason: 사유 입력 시 대괄호 제거하고 정확히 치환', () => {
  const reason = '갑상선약, 혈압약 복용중';
  const out = substituteOralXReason(BRACKET_PHRASE, reason);
  expect(out).toContain(reason);
  expect(out).not.toContain('['); // 대괄호 완전 제거
  expect(out).not.toContain(']');
  expect(ORAL_X_REASON_RE.test(out)).toBe(false); // placeholder 잔존 0
});

test('AC1 — composeOpinionDoc: 실장 사유가 경구약 항목에 대괄호 없이 합성', () => {
  const reason = '간기능 이상으로 인한 경구약 복용중';
  const text = composeOpinionDoc({
    sections: SECTIONS,
    selectedKeys: ['oral_x'],
    oralXReason: reason,
  });
  expect(text).toContain(reason);
  expect(text).not.toContain('[');
  expect(text).not.toContain(']');
});

// ── AC5: 실장 미입력(빈 reason) → 기존 동작(괄호 보존 = 입력 유도) ───────────────
test('AC5 — 빈 reason 이면 괄호 보존(기존 동작 유지·치환 안 함)', () => {
  expect(substituteOralXReason(BRACKET_PHRASE, '')).toBe(BRACKET_PHRASE);
  expect(substituteOralXReason(BRACKET_PHRASE, null)).toBe(BRACKET_PHRASE);
  expect(substituteOralXReason(BRACKET_PHRASE, undefined)).toBe(BRACKET_PHRASE);
  const text = composeOpinionDoc({ sections: SECTIONS, selectedKeys: ['oral_x'], oralXReason: '' });
  expect(text).toContain('['); // 괄호 보존 → 원장이 직접 입력 유도
});

// ── 마커 검출 — 괄호 있는 phrase 선택 시에만 사유 입력 필요(data-driven) ─────────
test('needsOralXReason — 괄호 phrase 선택 시 true, 미선택 시 false', () => {
  const templates = buildContraindTemplates(SECTIONS as unknown as OpinionSourceSection[]);
  expect(needsOralXReason(['oral_x'], templates)).toBe(true);
  expect(needsOralXReason([], templates)).toBe(false);
});

// ── AC6: 실장 요청서 화면 '경구약 사유' 전용 입력칸 + 데이터 계층 ────────────────
test('AC6 — OpinionRequestBox 경구약 사유 입력칸 + oralMedReason 전달 배선', () => {
  const src = read('src/components/consult/OpinionRequestBox.tsx');
  // 전용 입력칸 노출 + testid
  expect(src).toContain('opinion-req-oralmed-input');
  expect(src).toContain('경구약 사유');
  // 경구약 관련 옵션 선택 시 노출(조건부)
  expect(src).toMatch(/ORAL_MED_REASON_KEYS/);
  expect(src).toMatch(/showOralMedReason/);
  // staff_memo 비채택 — 별도 전용 state/payload
  expect(src).toMatch(/oralMedReason\s*:/); // payload 전달
});

test('AC6 — opinionRequest.ts: field_data.oral_med_reason write & read(staff_memo와 별개 전용 키)', () => {
  const src = read('src/lib/opinionRequest.ts');
  expect(src).toContain('oral_med_reason'); // field_data 키
  expect(src).toMatch(/oralMedReason/);     // input/row 필드
  // write: input.oralMedReason → field_data.oral_med_reason
  expect(src).toMatch(/oral_med_reason:\s*input\.oralMedReason/);
  // read: fd['oral_med_reason'] → row.oralMedReason
  expect(src).toMatch(/oralMedReason:\s*String\(fd\['oral_med_reason'\]/);
});

// ── AC1/AC2 prefill 배선: 큐 → 작성창 oralXReason (강제 빈값 제거) ──────────────
test('AC1/AC2 — DocRequestQueue → OpinionEditorDialog initialOralXReason prefill 연동', () => {
  const queue = read('src/components/doctor/DocRequestQueue.tsx');
  expect(queue).toMatch(/initialOralXReason=\{active\?\.oralMedReason/);

  const tab = read('src/components/doctor/OpinionDocTab.tsx');
  // prop 수신
  expect(tab).toMatch(/initialOralXReason\?:\s*string \| null/);
  // bind 시 강제 '' 가 아니라 initialOralXReason 으로 prefill
  expect(tab).toMatch(/setOralXReason\(\(initialOralXReason \?\? ''\)\.trim\(\)\)/);
  // 회귀 가드: 더 이상 무조건 setOralXReason('') 강제하지 않음
  expect(tab).not.toMatch(/setOralXReason\(''\);\s*\n\s*setDocDate/);
});

// ── AC2 — 뷰어 파란글씨(text-blue-600 프리뷰)는 작성창(원장 뷰어)에 존재 ──────────
test('AC2 — 작성창 경구약 미리보기 파란글씨(text-blue-600) 유지', () => {
  const tab = read('src/components/doctor/OpinionDocTab.tsx');
  expect(tab).toContain('opinion-oralx-preview');
  expect(tab).toContain('text-blue-600');
  // 프리뷰가 oralXReason(실장 입력값) 또는 DEFAULT 를 표시(파란글씨 = 변경사유 강조)
  expect(tab).toMatch(/oralXReason\.trim\(\)\s*\|\|\s*ORAL_X_DEFAULT_REASON/);
});

// ── AC3/AC4 ★회귀가드 — 서류 출력(printOpinionDoc) 경로에 파란색 0(검정) ─────────
test('AC3/AC4 ★회귀가드 — printOpinionDoc(서류/PDF) 경로에 파란색 미적용(검정)', () => {
  const print = read('src/lib/printOpinionDoc.ts');
  // 인쇄 본문은 발행 body plain text 바인딩 — 색상 지정 없음.
  expect(print).not.toMatch(/blue|text-blue|color:\s*blue|#00f|rgb\(\s*0\s*,\s*0\s*,\s*2/i);
  // body 는 발행 스냅샷 그대로(재조회 변조 불가, 색상 className 미주입).
  expect(print).toMatch(/\[bodyField\]:\s*data\.body/);

  // 양식 바인딩 단일 경로(bindHtmlTemplate)도 파란색 강제 주입 없음(plain 치환).
  const bind = read('src/lib/htmlFormTemplates.ts');
  expect(bind).not.toMatch(/text-blue-600|color:\s*blue/i);
});

// ── AC4 — render-split 재사용 확인: 뷰어=text-blue-600, 서류=printOpinionDoc(plain). 평행 hack 0 ─
test('AC4 — 파란색 className 은 뷰어(OpinionDocTab)에만, 서류 출력 경로엔 없음', () => {
  const tab = read('src/components/doctor/OpinionDocTab.tsx');
  const print = read('src/lib/printOpinionDoc.ts');
  expect(tab).toContain('text-blue-600');       // 뷰어 전용 파란글씨
  expect(print).not.toContain('text-blue-600'); // 서류 출력엔 절대 미적용
});
