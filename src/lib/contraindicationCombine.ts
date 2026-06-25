/**
 * 서류 상용구 동적 조합 엔진 — 풋센터 소견서/진단서 금기증 복수선택 결합.
 *
 * 출처: T-20260623-foot-DOCGEN-CONTRAIND-COMBINE
 *       조합로직 MD `140854_F0BCDEE2D8W_서류상용구_조합로직_20260623.md` §2-2 / §3 / §4
 *
 * 본 파일은 Phase 1a 선착수 범위 — **순수 문자열 가공 엔진만** 담는다.
 *   - combineDiagnoses: 금기증 복수선택 → 우선순위 정렬 → 첫/중간/마지막 문장 가공 → 공백1칸 결합
 *   - substituteHepatitisType: 간염보균자 `B(C)` → B형/C형 전체 치환 (조합 前 적용)
 *
 * 엔진 계약은 `(selectedKeys) → string` 으로 고정한다. 버튼별 원문(body)이 담긴 CSV
 *   (`서류상용구_양식_20260623.csv`)는 아직 미수신이므로 템플릿 레지스트리(CONTRAIND_TEMPLATES)는
 *   현재 비어 있고, CSV 도착 시 이 상수만 결선하면 된다. 호출측/테스트는 두 번째 인자로
 *   템플릿 맵을 주입할 수 있다(기본값 = 레지스트리).
 *
 * 착수 제외(별도 unblock 후): 템플릿 상수파일(CSV 변환), UI 와이어링(복수선택/배타 버튼·사유입력 칸·
 *   날짜 picker·조갑진균증 토글), DocumentPrintPanel/TemplateSection 통합.
 */

/** MD §3 가공 대상이 되는 "마지막 문장". 첫/중간 항목에서 제거, 마지막 항목에서만 유지. */
export const CONTRAIND_LAST_SENTENCE =
  '향후 12-15개월간 외래 추시 및 반복적 보존적 치료를 요함.';

export type HepatitisType = 'B' | 'C';

export interface ContraindTemplate {
  /** 버튼키 (예: '고지혈증') */
  key: string;
  /** 우선순위 (CSV "우선순위" 컬럼, 1~24). 복수 조합 시 오름차순 정렬에 사용. */
  priority: number;
  /** 버튼별 원문. CSV 도착 시 결선(현재 레지스트리는 비어 있음). */
  body: string;
}

/**
 * 템플릿 레지스트리 — 기본값(빈 맵).
 *
 * ★ 데이터소스 결정② (2026-06-23 MSG-6e2x, 문지은 대표원장 옵션B 확정):
 *   상용구 원문 소스 = 별도 CSV가 **아니라** 기존 `form_templates(form_key='opinion_doc')`
 *   `.field_map.sections` jsonb (원장이 직접 최신 문구로 유지, READ-ONLY).
 *   → 실 결선은 정적 상수가 아니라 `buildContraindTemplates(sections)` 로 런타임 빌드한다.
 *   이 상수는 sections 미로딩(폴백)·테스트 기본값 용도로만 비워 둔다.
 */
export const CONTRAIND_TEMPLATES: Record<string, ContraindTemplate> = {};

// ---------------------------------------------------------------------------
// 데이터소스 결선 — form_templates(opinion_doc).field_map.sections → 엔진 템플릿 맵.
//   결정②/옵션B(MSG-6e2x): 원문 소스 = 기존 jsonb. DB 변경 0 (READ-ONLY).
//   엔진 계약 (selectedKeys, templates)→string 고정이라 source만 교체 = rework 0.
// ---------------------------------------------------------------------------

/** form_templates(opinion_doc).field_map.sections 의 옵션 한 건 (OpinionOption 미러). */
export interface OpinionSourceOption {
  /** UI 가 선택값(selectedKeys)으로 넘기는 안정 식별자 (예: 'hyperlipidemia'). */
  key: string;
  /** 버튼 표기(현장 한국어 라벨, 예: '고지혈증'). 우선순위표 매핑의 브리지. */
  label: string;
  /** 자동삽입 원문(body). 원장이 form_templates 에 유지하는 최신 문구. */
  phrase: string;
  /**
   * T-20260625-foot-OPINIONDOC-CONTRAIND-REORDER-SUBCAT — 조합 우선순위 명시값(선택).
   *   ★표시순서 ≠ 조합우선순위 분리(COMBINE 티켓 SSOT 보존): 대분류-소분류 도입으로 표시 라벨을
   *     짧게 바꾼 항목(예: '효과미비', '남성')은 CONTRAIND_PRIORITY[normalize(label)] 매핑이 깨진다.
   *     이때 이 필드로 우선순위를 직접 고정 → 조합 출력순서 회귀 0. 미지정이면 기존 라벨매핑 폴백(=현행).
   */
  priority?: number;
}
export interface OpinionSourceSection {
  title: string;
  options: OpinionSourceOption[];
}

/**
 * 라벨 정규화 — 모든 공백 제거.
 * 사유: 엔진 `CONTRAIND_PRIORITY` 키는 무공백 한국어('경구약복용후위장장애')인데,
 *   form_templates 옵션 라벨은 공백 포함('경구약복용후 위장장애')일 수 있다.
 *   라벨(한국어)이 두 키 공간(영문 option.key ↔ 한국어 우선순위 키)의 유일한 브리지.
 */
export function normalizeContraindLabel(label: string): string {
  return (label ?? '').replace(/\s+/g, '');
}

/**
 * form_templates(opinion_doc).field_map.sections → 조합 엔진 템플릿 맵 빌드.
 *
 * - map key  = option.key   (UI selectedKeys 와 동일 키 공간 — 영문 안정 식별자)
 * - body     = option.phrase (원장 유지 최신 원문)
 * - priority = CONTRAIND_PRIORITY[normalize(option.label)] (MD §4 우선순위표).
 *              미등재 라벨(예: 진단서 단일선택 옵션 '경구약 O')은 큰 fallback 값 →
 *              정렬 영향 최소(진단서는 단일선택이라 우선순위 무의미).
 *
 * 호출측(UI, item 2)은 이 맵을 combineDiagnoses 두 번째 인자로 주입한다.
 * sections 가 null/빈 배열이면 빈 맵 반환(empty-safe — 폴백 OPINION_SECTIONS 처리는 호출측).
 *
 * @param sections form_templates 에서 로드한 섹션 배열(없으면 폴백 섹션을 호출측이 전달)
 * @returns key→ContraindTemplate 맵
 */
export function buildContraindTemplates(
  sections: OpinionSourceSection[] | null | undefined,
): Record<string, ContraindTemplate> {
  const map: Record<string, ContraindTemplate> = {};
  if (!Array.isArray(sections)) return map;

  // 우선순위표 미등재 옵션은 1000+ 순차값 — 등재 옵션(1~24) 뒤로 안정 정렬.
  let fallbackSeq = 1000;
  for (const section of sections) {
    const options = section?.options;
    if (!Array.isArray(options)) continue;
    for (const opt of options) {
      if (!opt?.key) continue;
      const norm = normalizeContraindLabel(opt.label);
      // 우선순위 해석 순서: ① 옵션 명시 priority(표시라벨 디커플링) → ② 라벨매핑(현행) → ③ 폴백seq.
      const priority =
        (typeof opt.priority === 'number' ? opt.priority : CONTRAIND_PRIORITY[norm]) ?? fallbackSeq++;
      map[opt.key] = {
        key: opt.key,
        priority,
        body: opt.phrase ?? '',
      };
    }
  }
  return map;
}

/**
 * MD §4 우선순위표(1~24). CSV "우선순위" 컬럼의 정본. 원문(body)은 CSV 대기.
 * CSV 결선 시 priority 정합 검증(키 누락/충돌)용 참조표로 사용 가능.
 */
export const CONTRAIND_PRIORITY: Readonly<Record<string, number>> = {
  고지혈증: 1,
  위장장애: 2,
  혈압약: 3,
  심혈관약: 4,
  간염보균자: 5,
  신장질환: 6,
  통풍약: 7,
  갑상선약: 8,
  남성탈모약: 9,
  여성탈모약: 10,
  항정신과약: 11,
  간질환: 12,
  경구약복용후위장장애: 13,
  항암중: 14,
  항암후추적: 15,
  임신준비중: 16,
  임신중: 17,
  수유중: 18,
  파일럿: 19,
  운전기사: 20,
  면역질환: 21,
  당뇨: 22,
  소아: 23,
  경구약효과미비: 24,
};

/**
 * MD §2-2: 간염보균자 원문의 `B(C)` 표기를 선택한 타입(B형/C형)으로 **전체 치환**.
 * 조합(combineDiagnoses) **前**에 먼저 수행해야 한다(MD §3-5).
 * @param text  원문(또는 조합 입력 전 단일 원문)
 * @param type  'B' | 'C'
 * @returns `B(C)` 가 나타나는 모든 위치를 type 으로 치환한 문자열
 */
export function substituteHepatitisType(text: string, type: HepatitisType): string {
  // split/join 으로 리터럴 전체 치환 (괄호가 정규식 메타문자라 정규식 회피)
  return text.split('B(C)').join(type);
}

/**
 * 원문에서 마지막 문장 제거 (MD §3-2 첫/중간 항목).
 * `\n향후...` 패턴과 `향후...` 패턴 모두 처리(일부 원문은 줄바꿈 없이 이어짐).
 * trim 은 호출측 규칙에 맡긴다(첫 항목=trim, 중간 항목=split 후 trim).
 */
function removeLastSentence(body: string): string {
  return body
    .replace('\n' + CONTRAIND_LAST_SENTENCE, '')
    .replace(CONTRAIND_LAST_SENTENCE, '');
}

/**
 * 첫 문장 제거 (MD §3-2 중간/마지막 항목).
 * 기준 = 마침표+공백(`. `) split 의 index 0. `.\n` 은 split 대상 아님(MD §3-5).
 * 남은 문장들을 `. ` 로 재결합 후 trim.
 */
function removeFirstSentence(body: string): string {
  const sentences = body.split('. ');
  sentences.shift();
  return sentences.join('. ').trim();
}

/**
 * MD §3 금기증 복수선택 조합 엔진. 계약: `(selectedKeys) → string`.
 *
 * - 0개 → `''`
 * - 1개 → 원문 그대로(가공 없음)
 * - 2개+ → 우선순위 오름차순 정렬 후:
 *     - 첫 항목(i=0): 마지막 문장 제거 + trim
 *     - 중간 항목(1..N-2): 마지막 문장 제거 + 첫 문장 제거 + `또한 ` 접두
 *     - 마지막 항목(N-1): 첫 문장 제거 + `또한 ` 접두 (마지막 문장 유지)
 *   → 공백 1칸 join
 *
 * 간염보균자 `B(C)` 치환은 이 함수 호출 **前**에 substituteHepatitisType 으로 수행한다(MD §3-5).
 *
 * @param selectedKeys 선택된 버튼키 배열(입력 순서 무관 — 우선순위로 정렬됨)
 * @param templates    키→템플릿 매핑. 기본값=CONTRAIND_TEMPLATES(CSV 결선). 테스트는 픽스처 주입.
 * @returns 결합된 단일 문장
 */
export function combineDiagnoses(
  selectedKeys: string[],
  templates: Record<string, ContraindTemplate> = CONTRAIND_TEMPLATES,
): string {
  if (selectedKeys.length === 0) return '';

  const bodyOf = (key: string): string => {
    const tpl = templates[key];
    if (!tpl) {
      throw new Error(`combineDiagnoses: 템플릿 원문 없음 — '${key}'`);
    }
    return tpl.body;
  };

  if (selectedKeys.length === 1) return bodyOf(selectedKeys[0]);

  // 우선순위 오름차순 정렬 (원본 배열 불변)
  const sorted = [...selectedKeys].sort((a, b) => {
    const pa = templates[a]?.priority ?? Number.MAX_SAFE_INTEGER;
    const pb = templates[b]?.priority ?? Number.MAX_SAFE_INTEGER;
    return pa - pb;
  });

  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const body = bodyOf(sorted[i]);
    if (i === 0) {
      // 첫 번째: 마지막 문장만 제거
      parts.push(removeLastSentence(body).trim());
    } else if (i === sorted.length - 1) {
      // 마지막: 첫 문장 제거, 마지막 문장 유지
      parts.push('또한 ' + removeFirstSentence(body));
    } else {
      // 중간: 마지막 문장 제거 + 첫 문장 제거
      parts.push('또한 ' + removeFirstSentence(removeLastSentence(body)));
    }
  }

  return parts.join(' ');
}
