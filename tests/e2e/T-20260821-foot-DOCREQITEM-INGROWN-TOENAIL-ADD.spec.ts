/**
 * Unit spec — T-20260821-foot-DOCREQITEM-INGROWN-TOENAIL-ADD
 *
 * 2번차트 소견서/진단서 발행요청 옵션 그리드 [진단서] 섹션에 [내성발톱] 옵션 1건 ADDITIVE 추가.
 *   - 요청: 김주연 총괄(#foot). 컨펌: 문지은 대표원장(MSG-20260821-221354-5jia, §11.1 게이트 통과).
 *   - 섹션 = [진단서](단일배타). phrase = 원장 verbatim(의료법§22 immutable).
 *   - phrase 내 `[내원일]` 토큰 = 기존 서류날짜(docDate) 자동치환 로직 그대로(발행일 아님).
 *
 * 대상(순수 함수·상수) — auth/page 미사용 → playwright.config 'unit' 프로젝트:
 *   src/components/doctor/OpinionDocTab.tsx  : OPINION_SECTIONS(FE 폴백), parseOpinionSections
 *   src/lib/opinionDocCompose.ts             : needsDate, substituteDatePlaceholder, composeOpinionDoc,
 *                                              classifySelection, buildContraindKeySet, VISIT_DATE_PLACEHOLDER
 *
 * AC(시나리오1 정상동선): 목록에 [내성발톱] 표시(옵션 존재) → 선택 시 발행본문에 원장 verbatim + 내원일 자동삽입.
 * AC(시나리오2 회귀): 기존 진단서/금기증 옵션·문구 무변경.
 */
import { test, expect } from '@playwright/test';
import { OPINION_SECTIONS, parseOpinionSections } from '../../src/components/doctor/OpinionDocTab';
import {
  needsDate,
  substituteDatePlaceholder,
  composeOpinionDoc,
  buildContraindKeySet,
  classifySelection,
  VISIT_DATE_PLACEHOLDER,
  DATE_PLACEHOLDER,
} from '../../src/lib/opinionDocCompose';
import { buildContraindTemplates, type OpinionSourceSection } from '../../src/lib/contraindicationCombine';

// 원장 제공 verbatim(의료법§22 immutable) — 코드/seed/spec 3곳 byte-identical 이어야 함.
const INGROWN_PHRASE =
  '상기환자는 상기증상 및 병명으로 [내원일]에 내원하였고 양측 내향성 발톱 및 염증소견으로 내원하신 분으로, ' +
  '소염제·항생제 등의 약물 치료와 병행하여 발톱의 만곡을 바로잡기 위한 의료진의 내성발톱 치료 의료기기를 ' +
  '부착·조정하는 처치가 필요하여 치료 들어감. 발톱이 새로 자라는 속도에 맞추어 반복적인 부착·조정이 요구되어, ' +
  '향후 12-15개월간 외래 추시 및 반복적 보존적 치료를 요함.';

const 진단서 = () => OPINION_SECTIONS.find((s) => s.title === '진단서')!;
const 내성발톱 = () => 진단서().options.find((o) => o.key === 'ingrown_toenail');

test.describe('T-20260821 INGROWN-TOENAIL — 진단서 섹션 옵션 추가(ADDITIVE)', () => {
  test('AC1-1: OPINION_SECTIONS [진단서] 섹션에 내성발톱 옵션 1건 표시(목록 노출)', () => {
    const opt = 내성발톱();
    expect(opt).toBeTruthy();
    expect(opt!.label).toBe('내성발톱');
    expect(opt!.key).toBe('ingrown_toenail');
  });

  test('AC1-2: phrase = 원장 verbatim(byte-identical) + [내원일] 토큰 보존', () => {
    expect(내성발톱()!.phrase).toBe(INGROWN_PHRASE);
    expect(내성발톱()!.phrase).toContain(VISIT_DATE_PLACEHOLDER); // '[내원일]'
  });

  test('AC1-3: 내성발톱은 진단서(단일배타) 그룹 — 금기증 아님', () => {
    const contraindSet = buildContraindKeySet(OPINION_SECTIONS as unknown as OpinionSourceSection[]);
    expect(contraindSet.has('ingrown_toenail')).toBe(false);
    const { diagnosisKeys, contraindKeys } = classifySelection(['ingrown_toenail'], contraindSet);
    expect(diagnosisKeys).toEqual(['ingrown_toenail']);
    expect(contraindKeys).toEqual([]);
  });

  test('AC1-4: 선택 시 needsDate=true([내원일] 트리거)', () => {
    const templates = buildContraindTemplates(OPINION_SECTIONS as unknown as OpinionSourceSection[]);
    expect(needsDate(['ingrown_toenail'], templates)).toBe(true);
  });

  test('AC1-5: 발행본문 = 원장 문구 + 내원일 자동삽입(YYYY년 MM월 DD일)', () => {
    const body = composeOpinionDoc({
      sections: OPINION_SECTIONS,
      selectedKeys: ['ingrown_toenail'],
      dateISO: '2026-08-21',
    });
    // [내원일] 토큰이 한국어 날짜로 치환 + 잔존 토큰 0
    expect(body).toContain('2026년 08월 21일에 내원하였고');
    expect(body).not.toContain(VISIT_DATE_PLACEHOLDER);
    // 원장 문구 핵심 문장 보존
    expect(body).toContain('의료진의 내성발톱 치료 의료기기를 부착·조정하는 처치가 필요하여 치료 들어감');
    expect(body).toContain('향후 12-15개월간 외래 추시 및 반복적 보존적 치료를 요함');
  });

  test('AC1-6: 날짜 미지정 시 [내원일] 원문 보존(오각인 방지)', () => {
    const body = composeOpinionDoc({
      sections: OPINION_SECTIONS,
      selectedKeys: ['ingrown_toenail'],
      dateISO: null,
    });
    expect(body).toContain(VISIT_DATE_PLACEHOLDER);
  });

  test('AC1-7: parseOpinionSections(DB field_map) 라운드트립 — 내성발톱 옵션 보존', () => {
    // DB seed field_map 형태를 미러(진단서 sections[0] 에 내성발톱 포함).
    const fieldMap = {
      sections: [
        { title: '진단서', options: [{ key: 'ingrown_toenail', label: '내성발톱', phrase: INGROWN_PHRASE }] },
      ],
    };
    const parsed = parseOpinionSections(fieldMap);
    const opt = parsed[0].options.find((o) => o.key === 'ingrown_toenail');
    expect(opt).toBeTruthy();
    expect(opt!.label).toBe('내성발톱');
    expect(opt!.phrase).toBe(INGROWN_PHRASE);
  });
});

test.describe('T-20260821 INGROWN-TOENAIL — 회귀(시나리오2)', () => {
  test('AC2-1: 기존 진단서 옵션 4종 무변경(내성발톱만 추가)', () => {
    const keys = 진단서().options.map((o) => o.key);
    // 기존 4종 그대로 + 내성발톱 1건 추가 = 총 5종.
    expect(keys).toEqual(['oral_o', 'oral_x', 'after_1m', 'medical_staff', 'ingrown_toenail']);
  });

  test('AC2-2: 기존 [날짜] 토큰 치환 로직 무회귀([날짜]/[내원일] 동형)', () => {
    expect(substituteDatePlaceholder(`${DATE_PLACEHOLDER} 방문`, '2026-08-21')).toBe('2026년 08월 21일 방문');
    expect(substituteDatePlaceholder(`${VISIT_DATE_PLACEHOLDER} 방문`, '2026-08-21')).toBe('2026년 08월 21일 방문');
  });

  test('AC2-3: 금기증 섹션 옵션 개수/키 무변경(내성발톱 미유입)', () => {
    const contra = OPINION_SECTIONS.find((s) => s.title === '금기증')!;
    expect(contra.options.some((o) => o.key === 'ingrown_toenail')).toBe(false);
    // 대표 기존 키 잔존 확인
    expect(contra.options.some((o) => o.key === 'diabetes')).toBe(true);
    expect(contra.options.some((o) => o.key === 'liver_disease')).toBe(true);
  });
});
