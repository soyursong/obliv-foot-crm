/**
 * E2E Spec — T-20260720-foot-OPINIONDOC-PRINT-4FIX
 *
 * [P0] 소견서 출력물(발급 문서) 4건 정정
 *   - RC-2: 소견서 우측상단 '원부대조필인' 제거 (WONBU-SEAL-REMOVE 가 진료확인서·통원확인서만
 *           삭제하고 소견서(diag_opinion)를 누락 → 소견서만 잔존).
 *   - RC-1: printOpinionDoc 이 autoBindContext 공용 바인더 미사용 → 환자정보(주민번호·성별·생년월일·
 *           연령·주소·연락처)·상병코드·의사 직인(doctor_seal_html) 토큰이 공란으로 조용히 실패.
 *           → OpinionDocTab.handlePrint 가 loadAutoBindContext 산출값을 autoValues 로 주입,
 *             printOpinionDoc 이 이를 base 로 깔고 발행본 스냅샷만 override.
 *
 * AC (canon 티켓 10항목):
 *   AC-1  소견서 우측상단 원부대조필인 박스 없음
 *   AC-2  제목 "소 견 서" 중앙정렬 유지(빈 flex:1 컨테이너 보존)
 *   AC-3  주민번호·성별·생년월일·주소·연락처 정상 출력 (rrn 마스킹 없이 하이픈)
 *   AC-4  연령 "만 N세" 숫자 출력
 *   AC-5  상병코드·상병명·특정기호 정상 출력
 *   AC-6  의사 성명 옆 진료의 개인 직인(doctor_seal_html) 출력
 *   AC-7  직인이 진료의 축(doctor_seal_html) — 법인 인감(institution_seal_html) 아님
 *   AC-8  소견 본문·병원정보·발행일 회귀 없음
 *   AC-9  DocumentPrintPanel/medDocPrintGate 경로 소견서 회귀 없음(autoValues 옵셔널)
 *   AC-10 상병코드 미등록 환자 → 빈 행 깨짐 없음
 *
 * FIX-REQUEST (MSG-20260720-210050, deploy-ready 회수 → 회귀 correctness 2건 보완):
 *   FIX-① null-safe override — 발행본 스냅샷 필드가 null/공란이면 autoValues base 정상값을
 *          빈 문자열로 덮어써 소실(환자명·차트번호 등)시키던 RC 차단. truthy 일 때만 override.
 *   FIX-② customer_phone: null 하드코딩(as CheckIn 캐스팅 우회) 제거 →
 *          check_ins.customer_phone 실값을 loadAutoBindContext patient_phone 폴백에 주입.
 *   AC-13 visitor 없이 발행이력 [출력] → 환자명·차트번호 유지(소실 없음). FIX-① 검증.
 *   AC-14 고객 전화번호 없는 환자 → patient_phone 공란 시 깨짐 없이, 있으면 정상 출력. FIX-② 검증.
 *
 * 실행: npx playwright test --project=unit T-20260720-foot-OPINIONDOC-PRINT-4FIX.spec.ts
 * NOTE: 템플릿은 const 리터럴 → 정적 소스 검증 + getHtmlTemplate/bindHtmlTemplate 실렌더로 확인.
 *       autoBindContext/printOpinionDoc(window.open) 은 브라우저 의존 → 바인딩 계약은 실렌더+소스 가드로 검증.
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_SRC = fs.readFileSync(
  path.join(__dirname, '../../src/lib/htmlFormTemplates.ts'),
  'utf-8',
);
const PRINT_SRC = fs.readFileSync(
  path.join(__dirname, '../../src/lib/printOpinionDoc.ts'),
  'utf-8',
);
const TAB_SRC = fs.readFileSync(
  path.join(__dirname, '../../src/components/doctor/OpinionDocTab.tsx'),
  'utf-8',
);

/** `const NAME = \`...\`;` 형태의 템플릿 리터럴 본문 추출 */
function extractTemplate(name: string): string {
  const start = TEMPLATES_SRC.indexOf(`const ${name} = \``);
  expect(start, `${name} 템플릿을 찾지 못함`).toBeGreaterThanOrEqual(0);
  const bodyStart = TEMPLATES_SRC.indexOf('`', start) + 1;
  const bodyEnd = TEMPLATES_SRC.indexOf('`;', bodyStart);
  expect(bodyEnd, `${name} 종료 백틱을 찾지 못함`).toBeGreaterThan(bodyStart);
  return TEMPLATES_SRC.slice(bodyStart, bodyEnd);
}

const DIAG_OPINION = extractTemplate('DIAG_OPINION_HTML');
const TREAT_CONFIRM = extractTemplate('TREAT_CONFIRM_HTML');

// ── AC-1/AC-2: 원부대조필인 제거 + 제목 중앙정렬 보존 (RC-2) ──────────────────
test.describe('AC-1/2: 소견서 원부대조필인 제거 + 제목 중앙정렬', () => {
  test('AC-1: DIAG_OPINION_HTML 에 원부대조필 도장 박스 없음(가시 아티팩트 기준)', () => {
    // 제거를 설명하는 HTML 주석에는 단어가 남을 수 있으나(선례 관행) 비가시 → 가시 요소로 검증.
    expect(DIAG_OPINION, '소견서에 원부대조필 stamp-box 렌더 잔존').not.toContain('stamp-box');
    expect(DIAG_OPINION, '소견서에 원부대조필인 도장 텍스트 렌더 잔존').not.toContain(
      '원부대조필<br>인',
    );
  });

  test('AC-2: 제목 "소 견 서" 유지 + 빈 flex:1 컨테이너 보존(중앙정렬 불변)', () => {
    expect(DIAG_OPINION).toContain('소 견 서');
    // 좌우 대칭 빈 flex:1 컨테이너가 2개 이상이어야 제목이 중앙에 고정
    const emptyFlex = (DIAG_OPINION.match(/flex:1/g) ?? []).length;
    expect(emptyFlex, '좌우 flex:1 컨테이너 부족 → 중앙정렬 붕괴').toBeGreaterThanOrEqual(2);
  });

  test('회귀: 진료확인서 원부대조필 stamp-box 는 이미 제거된 상태 유지', () => {
    expect(TREAT_CONFIRM).not.toContain('원부대조필<br>인');
  });
});

// ── AC-3~AC-7: 소견서 템플릿에 환자정보·상병·직인 토큰 존재 ────────────────────
test.describe('AC-3~7: 소견서 바인딩 토큰 존재', () => {
  test('AC-3: 주민번호·성별·생년월일·주소·연락처 placeholder 존재', () => {
    for (const tok of [
      '{{patient_rrn}}',
      '{{patient_gender}}',
      '{{patient_birthdate}}',
      '{{patient_address}}',
      '{{patient_phone}}',
    ]) {
      expect(DIAG_OPINION, `소견서에 ${tok} 누락`).toContain(tok);
    }
  });

  test('AC-4: 연령 "만 N세" placeholder 존재', () => {
    expect(DIAG_OPINION).toContain('{{patient_age}}');
    expect(DIAG_OPINION).toMatch(/만.*\{\{patient_age\}\}.*세/s);
  });

  test('AC-5: 상병코드·상병명·특정기호 placeholder 존재', () => {
    for (const tok of ['{{diag_code_1}}', '{{diag_name_1}}', '{{diag_flag_1}}']) {
      expect(DIAG_OPINION, `소견서에 ${tok} 누락`).toContain(tok);
    }
  });

  test('AC-6/7: 의사 직인 = doctor_seal_html (법인 인감 institution_seal_html 아님)', () => {
    expect(DIAG_OPINION, '소견서 직인 토큰 누락').toContain('{{doctor_seal_html}}');
    expect(DIAG_OPINION, '소견서에 법인 인감 토큰 오용(금지2)').not.toContain(
      '{{institution_seal_html}}',
    );
  });
});

// ── RC-1 바인딩 경로: printOpinionDoc autoValues base + 스냅샷 override ─────────
test.describe('RC-1: printOpinionDoc autoValues 주입 + 스냅샷 override', () => {
  test('printOpinionDoc: autoValues 옵셔널 필드 존재', () => {
    expect(PRINT_SRC).toMatch(/autoValues\?:\s*Record<string,\s*string>/);
  });

  test('printOpinionDoc: autoValues 를 base 로 spread + 스냅샷 필드 override', () => {
    // fieldValues 안에서 ...data.autoValues 가 스냅샷 필드보다 앞(=base)에 와야 override 우선
    const spreadIdx = PRINT_SRC.indexOf('...(data.autoValues');
    const doctorIdx = PRINT_SRC.indexOf('doctor_name: data.issuedByName');
    expect(spreadIdx, 'autoValues spread 누락').toBeGreaterThanOrEqual(0);
    expect(doctorIdx, 'issuedByName override 누락').toBeGreaterThan(spreadIdx);
  });

  test('OpinionDocTab.handlePrint: loadAutoBindContext 로드 후 autoValues 주입', () => {
    expect(TAB_SRC).toContain("import { loadAutoBindContext } from '@/lib/autoBindContext'");
    expect(TAB_SRC).toMatch(/handlePrint\s*=\s*async/);
    expect(TAB_SRC).toContain('await loadAutoBindContext(checkIn)');
    expect(TAB_SRC).toMatch(/autoValues,?\s*\n?\s*\}\);/);
  });
});

// ── 실렌더 검증: autoValues 주입 시 공란 채워짐 / 스냅샷 보존 / 원부대조필인 부재 ──
test.describe('실렌더: bindHtmlTemplate(diag_opinion) 계약', () => {
  const tpl = () => {
    const t = getHtmlTemplate('diag_opinion');
    expect(t, 'diag_opinion 템플릿 로드 실패').toBeTruthy();
    return t as string;
  };

  // printOpinionDoc 의 병합 로직을 그대로 재현 (autoValues base + 스냅샷 override)
  function renderWithMerge(autoValues: Record<string, string>, snapshot: Record<string, string>) {
    const fieldValues = { ...autoValues, ...snapshot };
    return bindHtmlTemplate(tpl(), fieldValues);
  }

  // ⚠ PHI 금지(phi_redaction_standard §4): 실제 RRN 패턴(NNNNNN-NNNNNNN) 금지 → 합성 센티넬 사용.
  //   토큰 바인딩(치환) 검증이 목적이므로 값의 형식은 무관.
  const RRN_SENTINEL = 'RRN_BIND_SENTINEL';
  const AUTO = {
    patient_rrn: RRN_SENTINEL,
    patient_gender: '남',
    patient_birthdate: '1990년 05월 15일',
    patient_age: '35',
    patient_address: '서울시 종로구 1',
    patient_phone: '010-1234-5678',
    diag_code_1: 'M20.1',
    diag_name_1: '무지외반증',
    diag_flag_1: 'V',
    doctor_seal_html: '<img src="seal.png" />',
  };
  const SNAP = {
    record_no: 'C-0001',
    patient_name: '홍길동',
    diagnosis_ko: '발행 소견 본문',
    issue_date: '2026-07-20',
    clinic_name: '오블리브 풋센터 종로',
    doctor_name: '문지은',
    doctor_license_no: '12345',
  };

  test('AC-3/4/5/6: 환자정보·상병·연령·직인 렌더됨(공란 아님)', () => {
    const html = renderWithMerge(AUTO, SNAP);
    expect(html).toContain(RRN_SENTINEL); // rrn 토큰 치환 확인(합성 센티넬)
    expect(html).toContain('남'); // gender
    expect(html).toContain('1990년 05월 15일'); // birthdate
    expect(html).toMatch(/만.*35.*세/s); // age
    expect(html).toContain('M20.1'); // diag code
    expect(html).toContain('무지외반증'); // diag name
    expect(html).toContain('seal.png'); // doctor seal img
  });

  test('AC-8: 발행본 스냅샷(본문·성명·병원·발행일) 보존 + 미치환 토큰 없음', () => {
    const html = renderWithMerge(AUTO, SNAP);
    expect(html).toContain('발행 소견 본문');
    expect(html).toContain('홍길동');
    expect(html).toContain('문지은');
    expect(html).toContain('2026-07-20');
    expect(html, '미치환 {{token}} 잔존').not.toMatch(/\{\{[a-z_0-9]+\}\}/);
  });

  test('AC-1: 렌더 결과에 원부대조필 도장 텍스트 없음(가시 아티팩트)', () => {
    // NOTE: COMMON_STYLE 이 .stamp-box CSS 클래스 정의를 포함하므로(비가시) 렌더 html 에는
    //   'stamp-box' 문자열이 남는다. 가시 도장 요소는 '원부대조필<br>인' 콘텐츠로만 판별.
    const html = renderWithMerge(AUTO, SNAP);
    expect(html).not.toContain('원부대조필<br>인');
  });

  test('AC-9: autoValues 미주입(기존 경로) — 렌더 실패/미치환 없음', () => {
    // DocumentPrintPanel/medDocPrintGate 경로 = autoValues 없이 스냅샷 9필드만
    const html = bindHtmlTemplate(tpl(), SNAP);
    expect(html).toContain('발행 소견 본문');
    expect(html).toContain('홍길동');
    // 미주입 토큰은 공란으로 안전 치환(깨짐/에러 없음)
    expect(html, '미치환 {{token}} 잔존(회귀)').not.toMatch(/\{\{[a-z_0-9]+\}\}/);
  });

  test('AC-10: 상병코드 미등록(빈 문자열) — 빈 행 깨짐 없음', () => {
    const emptyDiag = { ...AUTO, diag_code_1: '', diag_name_1: '', diag_flag_1: '' };
    const html = renderWithMerge(emptyDiag, SNAP);
    expect(html, '미치환 {{token}} 잔존').not.toMatch(/\{\{[a-z_0-9]+\}\}/);
    // 여전히 소견서 구조 유지(제목·본문)
    expect(html).toContain('소 견 서');
    expect(html).toContain('발행 소견 본문');
  });
});

// ── FIX-① AC-13: null-safe override — 스냅샷 null 시 autoValues base 보존 ──────────
test.describe('FIX-① / AC-13: null-safe override (스냅샷 null → autoValues base 유지)', () => {
  const tpl = () => {
    const t = getHtmlTemplate('diag_opinion');
    expect(t, 'diag_opinion 템플릿 로드 실패').toBeTruthy();
    return t as string;
  };

  // printOpinionDoc FIX-① 재현: 스냅샷 값이 truthy 일 때만 override (falsy 는 autoValues base 유지)
  function renderNullSafe(
    autoValues: Record<string, string>,
    snapshot: Record<string, string>,
  ) {
    const merged: Record<string, string> = { ...autoValues };
    for (const [k, v] of Object.entries(snapshot)) {
      if (v) merged[k] = v; // truthy 일 때만 override
    }
    return bindHtmlTemplate(tpl(), merged);
  }

  // ⚠ PHI 금지: 실제 RRN 패턴 금지 → 합성 센티넬. (앞 describe 의 AUTO/SNAP 는 블록 스코프라 재정의)
  const AUTO: Record<string, string> = {
    patient_rrn: 'RRN_BIND_SENTINEL',
    patient_gender: '남',
    patient_birthdate: '1990년 05월 15일',
    patient_age: '35',
    patient_address: '서울시 종로구 1',
    patient_phone: '010-1234-5678',
    diag_code_1: 'M20.1',
    diag_name_1: '무지외반증',
    diag_flag_1: 'V',
    doctor_seal_html: '<img src="seal.png" />',
  };
  const SNAP: Record<string, string> = {
    record_no: 'C-0001',
    patient_name: '홍길동',
    diagnosis_ko: '발행 소견 본문',
    issue_date: '2026-07-20',
    clinic_name: '오블리브 풋센터 종로',
    doctor_name: '문지은',
    doctor_license_no: '12345',
  };

  test('AC-13 source: printOpinionDoc 스냅샷 override 가 null-safe 조건부(truthy) 적용', () => {
    expect(PRINT_SRC, 'patient_name null-safe 조건부 spread 누락').toMatch(
      /\.\.\.\(data\.patientName\s*\?\s*\{\s*patient_name:\s*data\.patientName\s*\}\s*:\s*\{\}\)/,
    );
    expect(PRINT_SRC, 'record_no(chartNo) null-safe 조건부 spread 누락').toMatch(
      /\.\.\.\(data\.chartNo\s*\?\s*\{\s*record_no:\s*data\.chartNo\s*\}\s*:\s*\{\}\)/,
    );
    expect(PRINT_SRC, 'doctor_name(issuedByName) null-safe 조건부 spread 누락').toMatch(
      /\.\.\.\(data\.issuedByName\s*\?\s*\{\s*doctor_name:\s*data\.issuedByName\s*\}\s*:\s*\{\}\)/,
    );
    // body(본문 스냅샷)는 항상 그대로 출력(조건부 아님) — 발행 body 불변
    expect(PRINT_SRC).toMatch(/\[bodyField\]:\s*data\.body\s*\?\?\s*''/);
  });

  test('AC-13: visitor 없는 발행이력 출력 — patient_name/record_no null → autoValues base 유지(소실 없음)', () => {
    // visitor 부재 시 handlePrint 는 patientName=null, chartNo=null 로 호출 → falsy.
    const autoValues = { ...AUTO, patient_name: '김환자', record_no: 'C-9999' };
    const snapshotNulls = { ...SNAP, patient_name: '', record_no: '' }; // null → falsy
    const html = renderNullSafe(autoValues, snapshotNulls);
    expect(html, '환자명 소실(FIX-① 회귀)').toContain('김환자');
    expect(html, '차트번호 소실(FIX-① 회귀)').toContain('C-9999');
    expect(html, '미치환 {{token}} 잔존').not.toMatch(/\{\{[a-z_0-9]+\}\}/);
  });

  test('AC-13 회귀: 스냅샷 실값이면 여전히 override 우선(법정 의무기록 불변 보존)', () => {
    const autoValues = { ...AUTO, patient_name: 'AUTO명', record_no: 'AUTO-1', doctor_name: 'AUTO의사' };
    const html = renderNullSafe(autoValues, SNAP); // SNAP: 홍길동 / C-0001 / 문지은
    expect(html).toContain('홍길동');
    expect(html).toContain('C-0001');
    expect(html).toContain('문지은');
    expect(html, 'autoValues 라이브값이 스냅샷을 덮음(불변성 위반)').not.toContain('AUTO명');
    expect(html).not.toContain('AUTO-1');
    expect(html).not.toContain('AUTO의사');
  });
});

// ── FIX-② AC-14: customer_phone 실값 주입 (null 하드코딩 제거) ─────────────────────
test.describe('FIX-② / AC-14: patient_phone 폴백 실값 + 공란 안전', () => {
  const tpl = () => getHtmlTemplate('diag_opinion') as string;
  const render = (av: Record<string, string>) =>
    bindHtmlTemplate(tpl(), { ...av, ...{ patient_name: '홍길동', diagnosis_ko: '본문' } });

  const AUTO_PHONE = {
    patient_rrn: 'RRN_SENTINEL',
    patient_gender: '여',
    patient_birthdate: '1988년 01월 01일',
    patient_age: '38',
    patient_address: '서울',
    diag_code_1: '',
    diag_name_1: '',
    diag_flag_1: '',
    doctor_seal_html: '',
  };

  test('AC-14 source: OpinionDocTab — customer_phone null 하드코딩 제거 + 실값 주입', () => {
    // 종전: `customer_phone: null,` 하드코딩(as CheckIn 캐스팅 우회) → 제거되어야 함
    expect(TAB_SRC, 'customer_phone: null 하드코딩 잔존(FIX-②)').not.toMatch(
      /customer_phone:\s*null,/,
    );
    // 합성 checkIn 에 내원행 실 전화 주입
    expect(TAB_SRC).toContain('customer_phone: visitor.customer_phone ?? null');
    // 폴백 실값 공급원 — 쿼리 select 에 customer_phone 포함
    expect(TAB_SRC).toMatch(/\.select\([^)]*customer_phone/);
    // VisitorRow 타입에 customer_phone 필드
    expect(TAB_SRC).toMatch(/customer_phone:\s*string\s*\|\s*null/);
    // 매핑에서 row 값 주입
    expect(TAB_SRC).toMatch(/customer_phone:\s*\(row\['customer_phone'\]/);
  });

  test('AC-14: patient_phone 실값 정상 출력', () => {
    const html = render({ ...AUTO_PHONE, patient_phone: '010-1234-5678' });
    expect(html).toContain('010-1234-5678');
    expect(html, '미치환 {{token}} 잔존').not.toMatch(/\{\{[a-z_0-9]+\}\}/);
  });

  test('AC-14: patient_phone 공란(고객·내원행 모두 전화 없음) — 렌더 깨짐 없음', () => {
    const html = render({ ...AUTO_PHONE, patient_phone: '' });
    expect(html, '미치환 {{token}} 잔존').not.toMatch(/\{\{[a-z_0-9]+\}\}/);
    expect(html).toContain('소 견 서');
    expect(html).toContain('홍길동');
  });
});
