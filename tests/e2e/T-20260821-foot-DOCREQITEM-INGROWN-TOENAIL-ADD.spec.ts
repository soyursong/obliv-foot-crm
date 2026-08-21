/**
 * E2E spec — T-20260821-foot-DOCREQITEM-INGROWN-TOENAIL-ADD
 * 풋센터 총괄(김주연, U0ATDB587PV / C0ATE5P6JTH, thread 1787283664.810469):
 *   "풋센터CRM 2번차트 소견서·진단서 발행 요청 항목 목록에 [내성발톱] 추가해줘"
 *
 * 요지: 2번차트 상담내역 탭(실장영역) '소견서 & 진단서 요청' 박스(OpinionRequestBox)의
 *   항목 선택 목록에 [내성발톱] 항목 1건을 ADDITIVE 로 추가. 기존 항목·화면 무변경.
 *
 * ★소스 판정(dev-foot 확인 선행 — 티켓 스펙 요구):
 *   OpinionRequestBox 는 OpinionDocTab 이 export 하는 하드코드 상수 OPINION_SECTIONS 를 직접 렌더한다
 *   (src/components/consult/OpinionRequestBox.tsx: `{OPINION_SECTIONS.map(...)}`). 따라서 이 목록의 소스 =
 *   FE 하드코딩 배열(case c). DB enum/CHECK/테이블 무접촉 → db_change=false, 무DDL, DA CONSULT 불요.
 *
 * ★§11 진료관리 게이트 비저촉 근거:
 *   원장 작성창(OpinionDocTab 옵션 그리드)은 런타임에 DB form_templates(opinion_doc).field_map.sections 를
 *   authoritative 로 사용하고(prod 에 seed 존재, 마이그 20260616160000), 그것이 비었을 때만 OPINION_SECTIONS 로
 *   폴백한다(dbSections.length > 0 ? dbSections : OPINION_SECTIONS). prod DB 는 seed 되어 있으므로 이 상수 추가는
 *   원장 화면 렌더에 영향이 없다 — 시각 변화는 비-게이트 영역인 실장 요청 박스(consult)에만 발생.
 *   또한 doctor compose(composeOpinionDoc)는 미등록 key 를 `filter((k) => !!templates[k])` 로 안전 배제하므로,
 *   실장이 [내성발톱]을 선택해 요청을 보내도 원장측 크래시/오작동 0(회귀 안전).
 *
 * 검증 방식: 현장 계정 PHI → 인증 우회 불가. 정적 소스 구조 검증 + 앱 로드(HTTP 200) + 회귀 가드.
 *   실브라우저 클릭 시나리오는 하단 체크리스트(갤탭 실기기 현장 confirm 대상).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const tab = () => read('src/components/doctor/OpinionDocTab.tsx');
const box = () => read('src/components/consult/OpinionRequestBox.tsx');
const compose = () => read('src/lib/opinionDocCompose.ts');

test.describe('T-20260821-foot-DOCREQITEM-INGROWN-TOENAIL-ADD — 발행 요청 항목에 내성발톱 추가', () => {

  // 회귀 가드: 앱 정상 로드
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── 시나리오 1(정상 동선): 항목 목록에 [내성발톱] 존재 ─────────────────────────
  test('S1: OPINION_SECTIONS 진단서 섹션에 [내성발톱] 항목(key/label/phrase) 추가됨', () => {
    const t = tab();
    // key=ingrown_toenail / label=내성발톱 / phrase(자동삽입 문구) 3필드 완비.
    expect(t).toContain("key: 'ingrown_toenail'");
    expect(t).toContain("label: '내성발톱'");
    expect(t).toMatch(/key: 'ingrown_toenail', label: '내성발톱', phrase: '[^']+'/);
  });

  test('S1: 실장 요청 박스(OpinionRequestBox)가 OPINION_SECTIONS 를 소스로 렌더 → [내성발톱] 선택 가능', () => {
    const b = box();
    // 목록 소스 = 하드코드 OPINION_SECTIONS 직접 렌더(= 이 상수 추가가 곧 목록 노출).
    expect(b).toContain("import { OPINION_SECTIONS }");
    expect(b).toContain('OPINION_SECTIONS.map');
    // 각 옵션은 opinion-req-opt-${opt.key} testid 로 렌더 → 신규 항목은 opinion-req-opt-ingrown_toenail.
    expect(b).toContain('data-testid={`opinion-req-opt-${opt.key}`}');
    // 선택은 handleOptionClick(opt.key) → 요청 selectedKeys 에 'ingrown_toenail' 반영(제출 저장).
    expect(b).toContain('onClick={() => handleOptionClick(opt.key)}');
  });

  // ── 소스 판정(case c): FE 하드코드 배열 — db_change=false, 무DDL ─────────────────
  test('소스: 목록은 FE 하드코드(OPINION_SECTIONS) — 실장 박스가 DB template 그리드를 소비하지 않음', () => {
    const b = box();
    // OpinionRequestBox 는 옵션 그리드를 DB(form_templates.field_map.sections)에서 읽지 않는다(하드코드 직결).
    expect(b).not.toContain('field_map');
    expect(b).not.toContain('parseOpinionSections');
    // 신규 컬럼/enum/CHECK/테이블 도입 없음(항목 1건 배열 추가) — DDL 지시어 부재.
    const t = tab();
    expect(t).not.toContain("ALTER TYPE");
  });

  // ── §11 게이트 비저촉 근거: 원장 그리드는 DB authoritative → 상수 추가 무영향 ────
  test('§11: 원장 작성창 그리드는 DB field_map.sections 우선(폴백만 OPINION_SECTIONS) → 상수 추가 원장화면 무영향', () => {
    const t = tab();
    // dbSections 우선, 비었을 때만 하드코드 폴백 — prod seed 존재하므로 원장 그리드 렌더 불변.
    expect(t).toContain('dbSections.length > 0 ? dbSections : OPINION_SECTIONS');
  });

  test('회귀 안전: doctor compose 는 미등록 key 를 안전 필터(filter templates[k]) → 요청 전달 시 크래시 0', () => {
    const c = compose();
    // composeOpinionDoc: 존재하는 key 만 유지(방어적) — 실장이 보낸 신규 key 를 원장 그리드가 몰라도 무해.
    expect(c).toContain('const present = selectedKeys.filter((k) => !!templates[k]);');
  });

  // ── 시나리오 2(회귀 확인): 기존 항목·화면 무변경 ────────────────────────────────
  test('S2 회귀: 기존 진단서 4항목 + 금기증 대표 항목 보존(항목 제거/개명 0)', () => {
    const t = tab();
    // 진단서 기존 4항목 무회귀.
    expect(t).toContain("key: 'oral_o'");
    expect(t).toContain("key: 'oral_x'");
    expect(t).toContain("key: 'after_1m'");
    expect(t).toContain("key: 'medical_staff'");
    // 금기증 섹션 대표 항목(변경 없음) 표본.
    expect(t).toContain("key: 'gi_disorder'");
    expect(t).toContain("key: 'immune_disease'");
  });

  test('S2 회귀: 요청 박스 기존 산출(서류종류·옵션 그리드·메모·발행 요청) 보존', () => {
    const b = box();
    expect(b).toContain('data-testid="opinion-req-doctype"');
    expect(b).toContain('data-testid="opinion-req-options"');
    expect(b).toContain('data-testid="opinion-req-memo"');
    expect(b).toContain('data-testid="opinion-req-submit"');
    expect(b).toContain('발행 요청');
  });
});

/**
 * 현장 클릭 시나리오 (갤탭 실기기 현장 confirm 체크리스트 — 단계별 확인 의무):
 *
 * [시나리오1] 정상 동선 (티켓 §시나리오1)
 *   1. 로그인 → 풋센터 CRM 진입 → 고객 선택 → 2번차트 열기
 *   2. 상담내역 탭 → '소견서 & 진단서 요청' 박스 → 항목 선택 목록(진단서 섹션)에 [내성발톱] 표시 확인
 *   3. [내성발톱] 항목 클릭(선택) → 선택 강조(aria-pressed) 반영 확인
 *   4. 서류종류 선택 + 발행 요청 클릭
 *   Expected: 요청이 정상 접수(form_submissions draft) + selectedKeys 에 'ingrown_toenail' 반영 저장.
 *     "처리 대기 요청 목록"에 해당 요청이 나타남.
 *
 * [시나리오2] 회귀 확인 (티켓 §시나리오2)
 *   a. 기존 항목(내성발톱 외) 선택·발행 요청 → 종전과 동일하게 정상 동작.
 *   b. 항목 목록 정렬/기존 항목 표시 무변경(진단서 4항목 + 금기증 전 항목 그대로).
 *   c. 원장 진료대시보드 서류작성 화면 그리드는 종전과 동일(DB seed authoritative) — 원장 화면 무변경.
 *
 * 비고(NO-DDL, db_change=false): 항목 목록 소스 = FE 하드코드 OPINION_SECTIONS(case c).
 *   [내성발톱] 1건 배열 추가만 — 신규 컬럼/테이블/enum/CHECK/RLS/RPC = 0. DA CONSULT 불요.
 *   §11 게이트: 원장 그리드는 런타임 DB field_map.sections 를 authoritative 로 사용(prod seed 존재) →
 *   상수 추가는 원장 화면 렌더 무영향, 시각 변화는 비-게이트 영역인 실장 요청 박스에만 발생 → 게이트 비대상.
 *   선례 = T-20260808-foot-DOCTPL-2ADD(서류 항목 추가·ADDITIVE·GO).
 */
