/**
 * E2E Spec — T-20260721-foot-OPINIONDOC-DIAGCODE-BLANK
 *
 * [P0] 소견서/진단서 출력 시 상병(상병코드·상병명 3칸)이 전부 공란으로 발행.
 *      F-4808: K29.7 / B35.1(조갑진균증) / B35.3 / L60.0 이 상병칸에 안 찍힘.
 *
 * Root Cause (런타임 규명 — 프로드 발행본 데이터 대조, 티켓 RC 정정):
 *   티켓 RC 는 "발행본 스냅샷(form_submissions.field_data)에 저장된 diag_code/name 을 참조하지 않는
 *   바인딩 버그"로 기술됐으나, 프로드 발행본(07/18~20 opinion_doc) field_data 를 실측한 결과
 *   **스냅샷에 diag_code/name 이 없다**(final_text·doctor_name·chart_no 등만 존재). medical_charts.diagnosis
 *   도 해당 방문일 null/행부재. 소견서/진단서 print 경로(handlePrint / printAuthoredMedDoc)는
 *   loadAutoBindContext 가 유일하게 읽던 medical_charts 소스가 비어 상병 3칸이 공란이었다.
 *   실제 상병(K297·B351·B353·L600 등)은 **check_in_services(category_label='상병')** 에 존재하며
 *   (check_in 2c76eea6 = B351/B353/K297/L600 = F-4808 값 일치), 이는 DocumentPrintPanel(배치출력)이 이미
 *   상병 토큰을 채우는 소스와 동일하다(RXPRINT-LAYOUT-4FIX batchDiagItems).
 *
 * Fix (read-path 재배선, db_change=false):
 *   autoBindContext.applyDiagCodesFromVisit(autoValues, checkIn) 신설 — service_charges(상병) 우선,
 *   없으면 check_in_services(상병, loadFootBillingItems) 폴백으로 diag_code_1..N/diag_name_1..N +
 *   diag_row_3/4_style + diag_extra_codes_html 을 채운다(DocumentPrintPanel batchDiagItems 동형).
 *   호출부: OpinionDocTab.handlePrint(발행본 row.check_in_id) / medDocPrintGate.printAuthoredMedDoc(doc.checkInId)
 *   — 발행본의 원 방문 상병을 재현(발행본 스냅샷 참조). 둘 다 미존재(legacy)면 현재 내원으로 폴백.
 *   상병 없으면 종전(medical_charts/공란) 유지 → 회귀 0.
 *
 * AC (canon 티켓):
 *   시나리오1  상병 3건 존재 → 소견서 출력 시 상병 3칸(코드+명) 표시 (F-4808: 4건 → 4칸)
 *   시나리오2  엣지: 상병 0건(미등록) → 종전 값 유지·빈행 깨짐 없음 / 2건 → row3·row4 숨김
 *   회귀       상병 없는 발행본·원장탭 배선 불변, medical_charts 폴백 보존
 *
 * 실행: npx playwright test --project=unit T-20260721-foot-OPINIONDOC-DIAGCODE-BLANK.spec.ts
 * NOTE: applyDiagCodesFromVisit→supabase(DB) I/O 는 배선 계약=정적 소스 가드, 토큰 산출 규칙=순수 로직
 *       재현, 렌더 결과=bindHtmlTemplate 실렌더로 검증(DESK-BLANK/4FIX spec 관행 계승).
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ABC_SRC = fs.readFileSync(path.join(__dirname, '../../src/lib/autoBindContext.ts'), 'utf-8');
const GATE_SRC = fs.readFileSync(path.join(__dirname, '../../src/lib/medDocPrintGate.ts'), 'utf-8');
const TAB_SRC = fs.readFileSync(path.join(__dirname, '../../src/components/doctor/OpinionDocTab.tsx'), 'utf-8');
const PRINT_SRC = fs.readFileSync(path.join(__dirname, '../../src/lib/printOpinionDoc.ts'), 'utf-8');

// ── RC 배선: autoBindContext.applyDiagCodesFromVisit ──────────────────────────
test.describe('RC 배선: applyDiagCodesFromVisit (상병 소스 재배선)', () => {
  test('applyDiagCodesFromVisit export + async + Promise<void>', () => {
    expect(ABC_SRC, 'applyDiagCodesFromVisit export async 아님').toMatch(
      /export\s+async\s+function\s+applyDiagCodesFromVisit/,
    );
    expect(ABC_SRC).toMatch(/\):\s*Promise<void>\s*\{/);
  });

  test('상병 소스 = service_charges(상병) 우선 → check_in_services(loadFootBillingItems) 폴백', () => {
    expect(ABC_SRC, 'service_charges 조회 누락').toContain(".from('service_charges')");
    expect(ABC_SRC, '상병 필터 누락').toMatch(/category_label\s*===\s*'상병'/);
    expect(ABC_SRC, 'check_in_services 폴백(loadFootBillingItems) 누락').toContain('loadFootBillingItems');
    expect(ABC_SRC, 'medical_charts 를 상병 소스로 오사용').not.toMatch(/applyDiagCodesFromVisit[\s\S]*medical_charts/);
  });

  test('행 가시성 + 초과코드 토큰 산출(DocumentPrintPanel 동형)', () => {
    expect(ABC_SRC).toContain('diag_row_3_style');
    expect(ABC_SRC).toContain('diag_row_4_style');
    expect(ABC_SRC).toContain('diag_extra_codes_html');
  });
});

test.describe('AC-1: OpinionDocTab(원장탭) handlePrint 상병 재배선', () => {
  test('applyDiagCodesFromVisit import + 발행본 row.check_in_id 로 호출', () => {
    expect(TAB_SRC).toContain('applyDiagCodesFromVisit');
    expect(TAB_SRC, '발행본 check_in_id 재배선 누락').toMatch(/row\.check_in_id\s*\?\?\s*visitor\.id/);
    expect(TAB_SRC, 'PublishedOpinionRow.check_in_id 필드 누락').toMatch(/check_in_id:\s*\(fd\['check_in_id'\]/);
  });
});

test.describe('AC-2: medDocPrintGate(데스크·수납) printAuthoredMedDoc 상병 재배선', () => {
  test('applyDiagCodesFromVisit import + doc.checkInId 로 호출', () => {
    expect(GATE_SRC).toContain('applyDiagCodesFromVisit');
    expect(GATE_SRC, '발행본 checkInId 재배선 누락').toMatch(/doc\.checkInId\s*\?\?\s*ctx\.checkIn\.id/);
    expect(GATE_SRC, 'AuthoredMedDoc.checkInId 필드 누락').toMatch(/checkInId:\s*\(fd\['check_in_id'\]/);
  });
});

// ── 토큰 산출 규칙 재현 (applyDiagCodesFromVisit 순수 로직) ────────────────────
// autoBindContext.applyDiagCodesFromVisit 의 토큰 주입부와 동일 알고리즘.
function applyDiag(
  autoValues: Record<string, string>,
  diagItems: { code: string; name: string }[],
): Record<string, string> {
  const av = { ...autoValues };
  if (diagItems.length > 0) {
    delete av.diag_code_1; delete av.diag_name_1;
    delete av.diag_code_2; delete av.diag_name_2;
    diagItems.forEach((item, idx) => {
      const n = idx + 1;
      av[`diag_code_${n}`] = item.code;
      av[`diag_name_${n}`] = item.name;
    });
  }
  const diagCount = diagItems.length > 0
    ? diagItems.length
    : (av.diag_code_2 ? 2 : av.diag_code_1 ? 1 : 0);
  av.diag_row_3_style = diagCount >= 3 ? '' : 'display:none';
  av.diag_row_4_style = diagCount >= 4 ? '' : 'display:none';
  const extra = diagItems.slice(2).map((i) => i.code).filter(Boolean);
  av.diag_extra_codes_html = extra.length > 0 ? extra.map((c) => `<br>${c}`).join('') : '';
  return av;
}

// 프로드 실측(F-4808 후보 check_in 2c76eea6)과 동일 상병 세트.
const F4808_DIAG = [
  { code: 'B351', name: '손발톱백선' },
  { code: 'B353', name: '발백선' },
  { code: 'K297', name: '상세불명의 위염' },
  { code: 'L600', name: '내성발톱(감입발톱)' },
];
// medical_charts 가 비어 loadAutoBindContext 가 공란으로 시작하는 상태(RC 재현).
const EMPTY_AUTO = { diag_code_1: '', diag_name_1: '', diag_row_3_style: 'display:none', diag_row_4_style: 'display:none', diag_extra_codes_html: '' };

test.describe('토큰 산출: 상병 소스 → diag_code_1..N 채움', () => {
  test('시나리오1: 상병 3건 → 상병 3칸(코드+명) 표시, row3 노출·row4 숨김', () => {
    const av = applyDiag(EMPTY_AUTO, F4808_DIAG.slice(0, 3));
    expect(av.diag_code_1).toBe('B351');
    expect(av.diag_code_2).toBe('B353');
    expect(av.diag_code_3).toBe('K297');
    expect(av.diag_name_3).toBe('상세불명의 위염');
    expect(av.diag_row_3_style, 'row3 이 숨겨짐(3칸 미표시)').toBe('');
    expect(av.diag_row_4_style).toBe('display:none');
  });

  test('시나리오1(F-4808): 상병 4건 → 4칸 전부 표시 + 초과코드(3·4번째) HTML', () => {
    const av = applyDiag(EMPTY_AUTO, F4808_DIAG);
    expect([av.diag_code_1, av.diag_code_2, av.diag_code_3, av.diag_code_4]).toEqual([
      'B351', 'B353', 'K297', 'L600',
    ]);
    expect(av.diag_row_3_style).toBe('');
    expect(av.diag_row_4_style).toBe('');
    expect(av.diag_extra_codes_html).toBe('<br>K297<br>L600');
  });

  test('시나리오2(엣지): 상병 0건 → medical_charts code1 보존, 빈 슬롯 유지(회귀 0)', () => {
    const withMc = { ...EMPTY_AUTO, diag_code_1: 'M20.1', diag_name_1: '무지외반증' };
    const av = applyDiag(withMc, []);
    expect(av.diag_code_1, 'medical_charts 폴백값이 지워짐(회귀)').toBe('M20.1');
    expect(av.diag_row_3_style).toBe('display:none');
    expect(av.diag_row_4_style).toBe('display:none');
    expect(av.diag_extra_codes_html).toBe('');
  });

  test('시나리오2(엣지): 상병 2건 → row3·row4 모두 숨김, 초과코드 없음', () => {
    const av = applyDiag(EMPTY_AUTO, F4808_DIAG.slice(0, 2));
    expect(av.diag_code_1).toBe('B351');
    expect(av.diag_code_2).toBe('B353');
    expect(av.diag_row_3_style).toBe('display:none');
    expect(av.diag_row_4_style).toBe('display:none');
    expect(av.diag_extra_codes_html).toBe('');
  });
});

// ── 실렌더: 상병 토큰 → diag_opinion(소견서) 템플릿 실제 바인딩 ─────────────────
test.describe('실렌더: 소견서 양식에 상병 3칸 표시', () => {
  const tpl = () => {
    const t = getHtmlTemplate('diag_opinion');
    expect(t, 'diag_opinion 템플릿 로드 실패').toBeTruthy();
    return t as string;
  };
  // 소견서 상병 외 토큰(공란이면 미치환 잔존) 최소 채움 — 렌더 무결성 확인용.
  const BASE = {
    patient_name: '김문재', record_no: 'C-4808', diagnosis_ko: '발행 소견 본문',
    issue_date: '2026-07-21', clinic_name: '오블리브 풋센터 종로', doctor_name: '문지은',
    diag_flag_1: 'V', diag_flag_2: '', diag_flag_3: '', diag_flag_4: '',
  };

  test('상병 3건 → 코드·상병명 3칸 렌더, 미치환 토큰 없음', () => {
    const av = applyDiag({ ...BASE, ...EMPTY_AUTO }, F4808_DIAG.slice(0, 3));
    const html = bindHtmlTemplate(tpl(), av);
    expect(html, '상병코드1 공란').toContain('B351');
    expect(html, '상병코드3 공란(3칸 미표시)').toContain('K297');
    expect(html, '상병명3 공란').toContain('상세불명의 위염');
    // row3 노출(display:none 아님) — 3번째 행 <tr style=""> 로 렌더
    expect(html).not.toMatch(/<tr style="display:none">\s*<td[^>]*>K297/);
    expect(html, '미치환 {{token}} 잔존').not.toMatch(/\{\{[a-z_0-9]+\}\}/);
  });

  test('상병 0건 → 상병칸 공란이어도 렌더 깨짐/미치환 없음(종전 동작)', () => {
    const av = applyDiag({ ...BASE, ...EMPTY_AUTO }, []);
    const html = bindHtmlTemplate(tpl(), av);
    expect(html).toContain('발행 소견 본문');
    expect(html).toContain('소 견 서');
    expect(html, '미치환 {{token}} 잔존').not.toMatch(/\{\{[a-z_0-9]+\}\}/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FIX-REQUEST (이은상 팀장, P0 HOTFIX) — 발행본 스냅샷 field_data 를 1급 상병 소스로 배선.
//   RC 정정: check_in_services 폴백은 재출력이 다른 날 이뤄지면 doc.checkInId 부재 시 오늘 내원으로
//   폴백 → 방문일 미매칭 → 공란/1코드. 발행 시점 스냅샷 field_data.diag_code_1..4 는 불변 →
//   4코드(K29.7/B35.1/B35.3/L60.0) 전부를 채우는 유일 소스. autoValues 뒤 truthy override 로 우선.
// ═══════════════════════════════════════════════════════════════════════════

test.describe('FIX-REQUEST 배선: 발행본 스냅샷 diag_code/name (1급 소스)', () => {
  test('AuthoredMedDoc.diagCodes 필드 + field_data.diag_code_1..4/diag_name_1..4 추출', () => {
    expect(GATE_SRC, 'AuthoredMedDoc.diagCodes 인터페이스 누락').toMatch(/diagCodes:\s*\{/);
    for (let i = 1; i <= 4; i++) {
      expect(GATE_SRC, `diag_code_${i} 추출 누락`).toContain(`fd['diag_code_${i}']`);
      expect(GATE_SRC, `diag_name_${i} 추출 누락`).toContain(`fd['diag_name_${i}']`);
    }
    expect(GATE_SRC, 'printOpinionDoc 로 diagCodes 전달 누락').toMatch(/diagCodes:\s*doc\.diagCodes/);
  });

  test('printOpinionDoc override 는 반드시 ...autoValues 뒤에 위치(빈 autoValues override 방지)', () => {
    const autoIdx = PRINT_SRC.indexOf('...(data.autoValues');
    const diagIdx = PRINT_SRC.indexOf('data.diagCodes?.code1');
    expect(autoIdx, '...autoValues 스프레드 누락').toBeGreaterThan(-1);
    expect(diagIdx, 'diagCodes override 누락').toBeGreaterThan(-1);
    expect(diagIdx, 'diagCodes override 가 autoValues 앞에 위치(빈 override 위험)').toBeGreaterThan(autoIdx);
  });

  test('override = truthy-guard(null 이면 미override → 폴백 유지) + code3/4 시 행 노출', () => {
    // truthy 일 때만 얹는 스프레드 패턴(FIX-① 규칙 계승).
    expect(PRINT_SRC).toMatch(/data\.diagCodes\?\.code1\s*\?\s*\{\s*diag_code_1:/);
    // code3/code4 존재 시 diag_row_3/4_style 동반 노출.
    expect(PRINT_SRC).toMatch(/data\.diagCodes\?\.code3\s*\?\s*\{[^}]*diag_row_3_style:\s*''/);
    expect(PRINT_SRC).toMatch(/data\.diagCodes\?\.code4\s*\?\s*\{[^}]*diag_row_4_style:\s*''/);
  });
});

// printOpinionDoc 의 diag 스냅샷 override 순수 로직 재현(fieldValues 구성부와 동일).
function applySnapshotDiag(
  autoValues: Record<string, string>,
  diagCodes: { code1: string | null; code2: string | null; code3: string | null; code4: string | null;
               name1: string | null; name2: string | null; name3: string | null; name4: string | null } | undefined,
): Record<string, string> {
  const fv = { ...autoValues };
  if (diagCodes?.code1) fv.diag_code_1 = diagCodes.code1;
  if (diagCodes?.name1) fv.diag_name_1 = diagCodes.name1;
  if (diagCodes?.code2) fv.diag_code_2 = diagCodes.code2;
  if (diagCodes?.name2) fv.diag_name_2 = diagCodes.name2;
  if (diagCodes?.code3) { fv.diag_code_3 = diagCodes.code3; fv.diag_row_3_style = ''; }
  if (diagCodes?.name3) fv.diag_name_3 = diagCodes.name3;
  if (diagCodes?.code4) { fv.diag_code_4 = diagCodes.code4; fv.diag_row_4_style = ''; }
  if (diagCodes?.name4) fv.diag_name_4 = diagCodes.name4;
  return fv;
}

// F-4808 발행본 스냅샷 field_data (팀장 확인값).
const F4808_SNAPSHOT = {
  code1: 'K29.7', code2: 'B35.1', code3: 'B35.3', code4: 'L60.0',
  name1: '상세불명의 위염', name2: '조갑진균증', name3: '체부백선', name4: '내향성 발톱',
};

test.describe('FIX-REQUEST 검증: 스냅샷 override 가 폴백보다 우선 + 회귀 0', () => {
  const tpl = () => getHtmlTemplate('diag_opinion') as string;
  const BASE = {
    patient_name: '김문재', record_no: 'C-4808', diagnosis_ko: '조갑진균증으로 인한 내향성 발톱',
    issue_date: '2026-07-21', clinic_name: '오블리브 풋센터 종로', doctor_name: '문지은',
    diag_flag_1: '', diag_flag_2: '', diag_flag_3: '', diag_flag_4: '',
  };

  test('검증1(F-4808): 스냅샷 4코드 → autoValues 공란/미매칭 덮고 4칸 전부 렌더 + 행3·4 노출', () => {
    // check_in 폴백이 오늘 내원 미매칭으로 상병 0건이라 rows 숨겨진 상태(RC 재현).
    const autoBlank = { diag_code_1: '', diag_name_1: '', diag_row_3_style: 'display:none', diag_row_4_style: 'display:none', diag_extra_codes_html: '' };
    const fv = applySnapshotDiag({ ...BASE, ...autoBlank }, F4808_SNAPSHOT);
    expect([fv.diag_code_1, fv.diag_code_2, fv.diag_code_3, fv.diag_code_4]).toEqual(['K29.7', 'B35.1', 'B35.3', 'L60.0']);
    expect(fv.diag_row_3_style, 'row3 숨김 → code3 안보임').toBe('');
    expect(fv.diag_row_4_style, 'row4 숨김 → code4 안보임').toBe('');
    const html = bindHtmlTemplate(tpl(), fv);
    for (const c of ['K29.7', 'B35.1', 'B35.3', 'L60.0']) expect(html, `${c} 미표시`).toContain(c);
    expect(html, 'row3(B35.3) 숨겨진 채 렌더').not.toMatch(/<tr style="display:none">\s*<td[^>]*>B35\.3/);
    expect(html, '미치환 {{token}} 잔존').not.toMatch(/\{\{[a-z_0-9]+\}\}/);
  });

  test('검증2(하드코딩 아님): 다른 환자 스냅샷 → 해당 코드로 채워짐', () => {
    const other = { code1: 'M20.1', code2: null, code3: null, code4: null, name1: '무지외반증', name2: null, name3: null, name4: null };
    const fv = applySnapshotDiag({ ...BASE }, other);
    expect(fv.diag_code_1).toBe('M20.1');
    expect(fv.diag_name_1).toBe('무지외반증');
    // F-4808 값이 새어들지 않음(하드코딩 아님 증명).
    expect(fv.diag_code_2 ?? '').not.toBe('B35.1');
  });

  test('검증3(회귀 0): 스냅샷 전부 null → override 안 함, autoValues 폴백 그대로 보존', () => {
    const fallback = { diag_code_1: 'A00.0', diag_name_1: '폴백상병', diag_row_3_style: 'display:none', diag_row_4_style: 'display:none' };
    const empty = { code1: null, code2: null, code3: null, code4: null, name1: null, name2: null, name3: null, name4: null };
    const fv = applySnapshotDiag({ ...BASE, ...fallback }, empty);
    expect(fv.diag_code_1, '스냅샷 null 이 폴백값을 덮음(회귀)').toBe('A00.0');
    expect(fv.diag_name_1).toBe('폴백상병');
    expect(fv.diag_row_3_style).toBe('display:none');
    expect(fv.diag_row_4_style).toBe('display:none');
  });

  test('검증3(엣지): diagCodes 자체가 undefined → no-op(회귀 0)', () => {
    const fallback = { diag_code_1: 'A00.0', diag_name_1: '폴백상병' };
    const fv = applySnapshotDiag({ ...BASE, ...fallback }, undefined);
    expect(fv.diag_code_1).toBe('A00.0');
  });
});
