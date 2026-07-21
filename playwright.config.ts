import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env (Supabase URL/key) + .env.test (테스트 전용 플래그) 를 모두 로드
dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config({ path: path.join(__dirname, '.env.test') });
// .env.local (gitignored, 비커밋) — SUPABASE_ACCESS_TOKEN 등 DB정책 E2E 비밀 로드.
// 미존재 시 무시 → DB 정책 spec 은 test.skip 로 안전 강등(스킵 사유 명확).
dotenv.config({ path: path.join(__dirname, '.env.local'), override: true });

// ── QA 워크트리 .env.local 폴백 (FIX-REQUEST MSG-20260715-161411-l4bf ·
//    ROOTFIX T-20260716-foot-DOCFEE-E2E-ENV-WIRING-ROOTFIX MSG-20260716-133036) ──────
//   배경: `.env.local`(TEST_PASSWORD + Supabase 비밀)은 gitignored 라 fresh QA 워크트리
//         (git worktree --detach + npm ci / 신규 clone)에는 존재하지 않는다. 그 결과
//         auth 의존 spec(로그인→/admin/closing 등)이 auth.setup 의 "TEST_PASSWORD env
//         required (no plaintext fallback)" 에서 즉시 실패했다.
//   해법: 로컬 .env.local 로 TEST_PASSWORD 가 채워지지 않았으면(=워크트리에 비밀 부재)
//         정본 체크아웃(canonical checkout)의 .env.local 을 폴백 로드한다.
//         - 비밀은 여전히 미커밋(gitignored) — 커밋되는 것은 "경로"뿐(보안 property 불변).
//         - 후보 우선순위: (1) env FOOT_QA_ENV_LOCAL (2) ~/GitHub/obliv-foot-crm/.env.local
//           (macstudio 정본) (3) ~/Documents/GitHub/obliv-foot-crm/.env.local (macbook 정본).
//           → homedir 레이아웃 차이를 모두 커버해 어느 머신의 clean detach 든 env 재요청 없이 로드.
//         - 정본 == 현재 dir 이면 이미 위에서 로드됨 → 폴백은 no-op(동일 파일 재로드 무해).
//   ROOTFIX 핵심(env 재배달 루프 차단): 후보가 하나도 없으면 조용히 넘기지 않고 원인을
//         명시 경고한다. env "부재"가 아니라 "배선/워크트리" 문제(=fallback 이전 커밋의 stale
//         워크트리에서 QA, 또는 정본 체크아웃 .env.local 삭제)임을 알려 재요청 반복을 끊는다.
if (!process.env.TEST_PASSWORD && !process.env.TEST_USER_PASSWORD) {
  const selfEnvLocal = path.join(__dirname, '.env.local');
  const candidates = [
    process.env.FOOT_QA_ENV_LOCAL,
    path.join(os.homedir(), 'GitHub', 'obliv-foot-crm', '.env.local'),
    path.join(os.homedir(), 'Documents', 'GitHub', 'obliv-foot-crm', '.env.local'),
  ].filter((p): p is string => !!p && p !== selfEnvLocal);

  const hit = candidates.find((p) => fs.existsSync(p));
  if (hit) {
    dotenv.config({ path: hit, override: true });
    // eslint-disable-next-line no-console
    console.log(`[playwright.config] .env.local 폴백 로드 → ${hit}`);
  } else if (!process.env.CI) {
    // eslint-disable-next-line no-console
    console.warn(
      '[playwright.config] ⚠ TEST_PASSWORD 미설정 + 정본 .env.local 폴백 후보 전무.\n' +
        `    self=${selfEnvLocal}\n    후보=${candidates.join(', ') || '(없음)'}\n` +
        '    → env 재요청 전 확인: (a) 현재 워크트리 config 에 이 폴백 블록이 있는지(=fallback 커밋 이후인지)\n' +
        '      (b) 정본 체크아웃(~/GitHub/obliv-foot-crm)에 .env.local 이 실재하는지.',
    );
  }
}

const AUTH_FILE = path.join(__dirname, '.auth', 'user.json');

// ── foot 전용 E2E 포트 8091 SSOT 전파 (FIX-REQUEST MSG-20260716-214106-of5k) ──────────
//   RC: cross-CRM 포트 충돌. foot·scalp2·women 이 모두 8089 하드코딩 → macstudio 동시 QA 시
//       먼저 뜬 형제(scalp2 vite)가 8089 점유 → foot Playwright reuseExistingServer 로 그 형제
//       서버 재사용 → auth.setup 세션 미인식/대시보드 timeout. foot 을 고유 포트 8091 로 격리.
//   문제: 다수 spec 이 `process.env.<BASE_URL|APP_URL|PLAYWRIGHT_BASE_URL> ?? 'http://localhost:8089'`
//         로 8089 를 절대경로 fallback 한다(baseURL 우회). config 는 Playwright 테스트 프로세스에서
//         평가되므로, 여기서 세 env 를 8091 로 선세팅하면 91개 spec 을 개별 수정하지 않고도 모든
//         절대경로 fallback 이 8091(=webServer 가 실제 기동하는 foot dev 서버)로 수렴한다.
//         (이미 외부에서 값을 준 경우는 존중 → ??= 로 미설정시에만 주입.)
const FOOT_E2E_ORIGIN = 'http://localhost:8091';
process.env.BASE_URL ??= FOOT_E2E_ORIGIN;
process.env.APP_URL ??= FOOT_E2E_ORIGIN;
process.env.PLAYWRIGHT_BASE_URL ??= FOOT_E2E_ORIGIN;

export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/helpers.ts'],
  // RC#0(PROD 픽스처 누적) 구조적 차단:
  //   globalSetup  = run 시작 전 직전 잔존 픽스처 pre-sweep (hard-kill 보강)
  //   globalTeardown = run 종료 시 성공/실패 무관 전수 스윕 (잔존 0건 보장)
  globalSetup: path.join(__dirname, 'tests', 'global-setup.ts'),
  globalTeardown: path.join(__dirname, 'tests', 'global-teardown.ts'),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // CI 한정 재시도 (T-20260720-foot-CHART-OPENGATE-SEED-ISOLATION-HARDEN QA#3):
  //   cross-run cleanup race 는 run-scoped 마커 격리로 구조적으로 제거됐다(fixtures sweepScoped).
  //   그럼에도 dev=prod 공유 라이브 DB + Vite cold-start(첫 페이지 로드 컴파일)로 seeded 카드가
  //   첫 시도에서 12~16s 늦게 렌더돼 waitFor 가 tight-timeout 으로 flaky RED 를 냈다(gate 첫 실행
  //   G1 16s·G3 17s, G3 시드 status=confirmed 로 잔존 확인 = 삭제 race 아님·순수 렌더 지연).
  //   재시도 시 서버가 warm 이라 결정적으로 green → AC-3(≥10 rerun green) 안정 수렴. 회귀 검출은
  //   행위 assert + G6 정적 가드가 유지하므로 재시도가 실회귀를 가리지 않는다. 로컬(비-CI)은 0 유지
  //   (실 flake 를 개발 중 즉시 노출 + 빠른 피드백).
  retries: process.env.CI ? 2 : 0,
  // per-test 타임아웃 60s (기본 30s → 상향, QA#3): gotoDashboard(login + dashboard-root 대기)
  //   + 20s 카드 렌더 대기(cold-start 흡수) + waitForChartOpen 이 한 attempt 안에서 30s 를 넘겨
  //   카드 대기 도달 전 test-timeout 으로 잘리던 것을 방지. 정적/빠른 spec 은 영향 없음(즉시 종료).
  timeout: 60_000,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    // ⚠ foot 전용 E2E 포트 8091 (RC: cross-CRM 포트 충돌 — FIX-REQUEST MSG-20260716-214106-of5k).
    //   배경: foot·scalp2·women 이 모두 8089 를 하드코딩 → macstudio 동시 QA 시 먼저 뜬 형제
    //         (관측: obliv-scalp2-crm vite = '오블리브 두피센터 CRM')가 8089 를 점유. foot Playwright 는
    //         reuseExistingServer:!CI 로 그 형제 서버를 재사용(VITE_DISABLE_AUTH_LOCK=1 미적용 + 다른
    //         Supabase ref) → auth.setup 이 주입한 sb-{foot-ref}-auth-token 미인식 → /login 리다이렉트 →
    //         '대시보드' 미표시 timeout. → foot 을 형제와 겹치지 않는 8091 로 격리(8081 derm·8082 body·8089
    //         scalp2/women·8085 dev-default 회피). 8091 은 형제 config·현재 리스너 모두 미사용 확인.
    baseURL: 'http://localhost:8091',
    screenshot: 'on',
    trace: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },

  outputDir: './test-results',

  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      // unit: auth 불필요 순수 함수 테스트 (htmlFormTemplates, formTemplates 등)
      // T-20260521-foot-CLINIC-INFO-SYNC PUSH 대응: 전종 검증 스펙 포함
      // T-20260521-foot-DOC-PRINT-UNIFY: 서류 출력 경로 통일 락 스펙 추가
      name: 'unit',
      testMatch: [
        // T-20260721-foot-COPAY-PROVISIONAL-RELABEL: 진료비 서류 3종 급여항목 본인부담 확정 라벨 「본인부담금」
        //   재라벨 (§2-2-6 제3안 B, DA GO, 총괄 confirm). 법정 필수 칸 밖 설명 라인 정적 가드 + 렌더 노출 +
        //   공단값 canon(공단=0)·합계 산식 무변경 역가드. label-layer only(db_change=false). auth/server 불요.
        '**/T-20260721-foot-COPAY-PROVISIONAL-RELABEL.spec.ts',
        // T-20260721-foot-BILLDOC-GONGDAN-ROUND-2DOC: 진료비 서류 2종 정확성 — 계산서·영수증 신양식
        //   ⑧환자부담총액/⑩납부할금액 10원 절사(computeBillDetailRounding SSOT, 세부내역서 합계 정합=2c)
        //   + ⑪납부한금액 합계칸 기본 바인딩(2d). 순수 산식 + 템플릿 정적 가드(auth/server 불요, 결정론).
        //   CANON-GATE(공단부담금 1a/2b)는 미접촉 — ⑦공단부담총액 {{insurance_covered}} 회귀 가드 포함.
        '**/T-20260721-foot-BILLDOC-GONGDAN-ROUND-2DOC.spec.ts',
        // T-20260721-foot-OPINIONDOC-DESK-BLANK: 소견서/진단서 데스크(서류탭·수납 미니창) 출력 환자정보·상병 공란
        //   — 4FIX(원장탭 전용) 미커버 호출부 확장. printAuthoredMedDoc 에 checkIn 인자 추가 → 내부
        //   loadAutoBindContext(checkIn) 로 autoValues 로드 → printOpinionDoc 주입. 소스 배선 가드 + 실렌더
        //   (환자정보 7필드·상병 채움 / 스냅샷 override 보존 / checkIn 미전달 회귀0). auth/server 불요.
        '**/T-20260721-foot-OPINIONDOC-DESK-BLANK.spec.ts',
        // T-20260721-foot-OPINIONDOC-DIAGCODE-BLANK: 소견서/진단서 출력 상병(3칸) 공란 — RC 정정(스냅샷엔
        //   diag 없음, 실제 상병은 check_in_services). applyDiagCodesFromVisit(service_charges 우선→
        //   check_in_services 폴백) 신설 + handlePrint/printAuthoredMedDoc 재배선(발행본 check_in_id 기준).
        //   배선 정적 가드 + 토큰 산출 로직 재현 + diag_opinion 실렌더(상병3칸/엣지0·2건). db_change=false, auth 불요.
        '**/T-20260721-foot-OPINIONDOC-DIAGCODE-BLANK.spec.ts',
        // T-20260721-foot-OPINIONDOC-SEAL-DOCTOR-MATCH: 소견서 담당의사-도장 매칭 오류(문지은 발행에 김윤기
        //   도장). RC=이름란(발행자 스냅샷)↔도장(내원 치료의 독립해석) 소스 분기. 발행자-앵커 결선
        //   (loadAutoBindContext 에 issued_by_doctor_id/issued_by_name 전달) — 배선 정적 가드 + clinicDoctor
        //   해석 규칙 재현(F-4808 실측: 치료의 김윤기여도 발행자 문지은 직인) + 07-14 빌링 법인인감 회귀 0.
        '**/T-20260721-foot-OPINIONDOC-SEAL-DOCTOR-MATCH.spec.ts',
        // T-20260720-foot-CHART-OPENGATE-SEED-ISOLATION-HARDEN: cross-run 시드 격리 불변식 가드.
        //   scoped 마커(`[QA-FIXTURE]|token|ts`)로 cleanupAll 전수 스윕이 다른 run 의 in-flight
        //   시드를 못 지움을 DB 직접 검증(교대성 RED 구조적 부재 = AC-2/3/4). auth/server 불요.
        '**/T-20260721-foot-CHART-OPENGATE-SEED-ISOLATION-CROSSRUN.spec.ts',
        // T-20260720-foot-OPINIONDOC-PRINT-4FIX: 소견서 출력물 4정정 — 원부대조필인 제거(RC-2) +
        //   printOpinionDoc autoBindContext 공용바인더 주입으로 환자정보·상병코드·의사직인 렌더(RC-1).
        //   HTML 템플릿 리터럴 정적 가드 + getHtmlTemplate/bindHtmlTemplate 실렌더(공란 채움·스냅샷 보존·회귀0). auth 불요.
        '**/T-20260720-foot-OPINIONDOC-PRINT-4FIX.spec.ts',
        // T-20260630-foot-PERM-UNLOCK-EXPORT-AUTOSEND: ④고객 export PII-egress audit + ⑨opt-out soft-delete 법적 guard
        //   + 권한 3역할 ADDITIVE 확대. 정적 소스/계약 검증(auth·server 불요). re-cut 시 unit testMatch 등록(원 커밋 미등록 갭 치유).
        '**/T-20260630-foot-PERM-UNLOCK-EXPORT-AUTOSEND.spec.ts',
        // T-20260718-foot-FLAG-EMOJI-WEBFONT-PORT: 국적 국기 이모지 Windows 코드깨짐 웹폰트 해결(derm Option C 이식).
        //   src/index.css @font-face(unicode-range 국기 한정)·html 스택 선두 prepend 정적 가드 +
        //   page.setContent computed font-family 렌더 단언. CSS-only(신규 npm/DB 0). auth/server 불요.
        //   진짜 게이트 = 현장 Windows 국기 실렌더(supervisor field-soak).
        '**/T-20260718-foot-FLAG-EMOJI-WEBFONT-PORT.spec.ts',
        // T-20260718-foot-SALESREPORT-ARPU-UNIQUE-DENOM: 일간매출보고 xlsx 상담객단가 분모 통일
        //   (÷상담건수 → ÷distinct 상담고객수 = 화면 배포본 canonical). RPC avg_amount 직접 소비 + 합계 분모=Σ상담고객.
        //   순수 로직: 헤더/상담건수 컬럼 불변 · 실장별=avg_amount · 분모0→빈칸 · 합계=Σ매출÷Σ상담고객. auth·server 불요.
        '**/T-20260718-foot-SALESREPORT-ARPU-UNIQUE-DENOM.spec.ts',
        // T-20260717-foot-PKGPAY-RECEIPT-MISSING-SYSTEMIC-FIX: 회수1 phantom 미수 치유 (R1, effectiveNetPaid 중앙화).
        //   순수 로직 불변식 — AC1 완납 phantom소멸 / AC2 회수≥2 회귀0 / AC3 매출 split 불변 + F-4857 archive 가드. auth 불요.
        '**/T-20260717-foot-PKGPAY-RECEIPT-MISSING-SYSTEMIC-FIX.spec.ts',
        // T-20260717-foot-RECEIPT-UPLOAD-TABLET-CAMERA-DLG-MISS: 태블릿 카메라 업로드 후 "영수증 매출 연동"
        //   팝업 미표시(가설A: 카메라 앱 전환 리마운트/컨텍스트 교란) 해소 — 재조회前 즉시오픈+persist 복원+비차단 갱신.
        //   소스 불변식 가드 + page.setContent 실DOM 뷰포트 포지셔닝(B 회귀가드). auth·server 불요. 실기 갤탭=field-soak.
        '**/T-20260717-foot-RECEIPT-UPLOAD-TABLET-CAMERA-DLG-MISS.spec.ts',
        // T-20260716-foot-MEDCHART-THERAPISTMEMO-LAG-DATALOSS(-FIX/-RCA) + MEMO-HISTORY:
        //   치료메모 입력 격리(렉해소)·sessionStorage draft(무손실)·edit RLS 0-row 에러화 — 순수 소스 정적 가드.
        //   실 입력 체감/재렌더/이탈 무손실은 supervisor 갤탭 field-soak(김주연 총괄 확인). auth 불요.
        '**/T-20260716-foot-MEDCHART-THERAPISTMEMO-LAG-DATALOSS-FIX.spec.ts',
        '**/T-20260716-foot-MEDCHART-THERAPISTMEMO-INPUT-LAG-DATALOSS-RCA.spec.ts',
        '**/T-20260520-foot-MEMO-HISTORY.spec.ts',
        // T-20260707-foot-PKGTICKET-USAGE-EDIT-THERAPIST-RLS: 시술내역 수정 치료사 권한(RC=FE 게이트, prod RLS 이미 허용).
        //   permissions lib 순수 단언 + 소스 정적 가드(저장 핸들러 단일행 UPDATE·derived 차감 불변식·canEditClinicMgmt 부재)
        //   + Management API(SUPABASE_ACCESS_TOKEN) prod 정책 실측(package_sessions_write=ALL therapist 허용·clinic_id 부재).
        //   시나리오 (1) 정상 저장 + (2.3) 저장 후 차감 카운트 정합(누락/중복 0). db_change=false(추가 마이그 no-op). auth 불요.
        '**/T-20260707-foot-PKGTICKET-USAGE-EDIT-THERAPIST-RLS.spec.ts',
        // T-20260710-foot-KOHRESULT-DOC-PRINT-ENABLE: 검사결과 탭 KOH 출력(旣 KohResultDialog) + 서류출력 명단 koh_result
        //   항목(DOCLIST/FALLBACK/CATEGORY) + 명단 출력 시 발행 field_data 바인딩(공란 방지) + 라이브 HTML 경로. auth 불요.
        '**/T-20260710-foot-KOHRESULT-DOC-PRINT-ENABLE.spec.ts',
        // T-20260706-foot-DOCCONFIRM-LAYOUT-5FIX: 진료확인서·통원확인서 레이아웃 5항목(상단/하단 50:50·성명 빈셀제거·용도 너비·상기인칸 3배).
        //   HTML 템플릿 리터럴 정적 가드 + getHtmlTemplate/bindHtmlTemplate 실렌더. 실 출력은 supervisor 갤탭 field-soak. auth 불요.
        '**/T-20260706-foot-DOCCONFIRM-LAYOUT-5FIX.spec.ts',
        // T-20260701-foot-DASH-GLASS-SHADOW-SOFTEN-PASTBANNER-COMPACT: 유리 outer 그림자 완화 + 과거날짜 배너 컴팩트.
        //   순수 CSS/JSX 시각 조정 → box-shadow 값·배너 유틸 클래스 정적 소스 가드. auth.setup 우회(TEST_PASSWORD 불요).
        //   실 렌더는 supervisor 갤탭 field-soak. (FIX-REQUEST MSG-20260701-204705-zyhy: QA 워크트리 .env.local 부재 대응)
        '**/T-20260701-foot-DASH-GLASS-SHADOW-SOFTEN-PASTBANNER-COMPACT.spec.ts',
        // T-20260630-foot-DATEFMT-YMD-RELATIVE-PURGE: 날짜 표시 YYYY.MM.DD SSOT 포매터 유닛 + 소스 grep 잔존0 가드 (auth·server 불요)
        '**/T-20260630-foot-DATEFMT-YMD-RELATIVE-PURGE.spec.ts',
        // T-20260625-foot-COLOR-CONVENTION-UNIFY-CANDIDATES: A안 색상 컨벤션(초진 파랑·재진 초록·힐러 노랑)
        //   4 surface 전면 적용 — 카드·dot·칩·배지·팝업의 토큰 매핑 + carve-out(칸반 teal/error 빨강/재진 emerald) 보존
        //   소스 정적 가드. 신규색 0(tailwind 旣정의 토큰 재사용). 실 색상 렌더는 supervisor field-soak. auth 불요.
        '**/T-20260625-foot-COLOR-CONVENTION-UNIFY-CANDIDATES.spec.ts',
        '**/T-20260520-foot-PRINT-FORM-BIND.spec.ts',
        '**/T-20260521-foot-CLINIC-INFO-SYNC-FULLSUITE.spec.ts',
        '**/T-20260521-foot-DOC-PRINT-UNIFY.spec.ts',
        // T-20260523-foot-FORM-TEMPLATE-REGEN: pen_chart 이미지 오매핑 회귀 방지 (파일시스템 검증)
        '**/T-20260523-foot-FORM-TEMPLATE-REGEN.spec.ts',
        // T-20260523-foot-PENCHART-INSURANCE: [보험차트] 명칭 + 자동채움 위치 (소스 grep, DB 검증)
        '**/T-20260523-foot-PENCHART-INSURANCE.spec.ts',
        // T-20260524-foot-RESV-TREAT-REFORMAT: 시술내역 5컬럼 재편성 소스 정적 검증
        '**/T-20260524-foot-RESV-TREAT-REFORMAT.spec.ts',
        // T-20260525-foot-PENCHART-FORM-BLACK: 검정 화면 + 튕김 수정 — 폴백 UI + Dialog 단일 인스턴스
        '**/T-20260525-foot-PENCHART-FORM-BLACK.spec.ts',
        // T-20260525-foot-CLOSING-CALC-BUG: 일마감 합계 불일치 + 탭 hash persist — 정적 소스 검증
        '**/T-20260525-foot-CLOSING-CALC-BUG.spec.ts',
        // T-20260525-foot-ROLE-PERM-CUSTOM: consultant messaging 권한 + 제외 3종 검증
        '**/T-20260525-foot-ROLE-PERM-CUSTOM.spec.ts',
        // T-20260525-foot-DOC-AUTOBIND-REGRESS: 서류 자동 바인딩 회귀 — 고객정보/처방약/상병코드
        '**/T-20260525-foot-DOC-AUTOBIND-REGRESS.spec.ts',
        // T-20260525-foot-INS-FIELD-BIND: 보험청구서 field_map 바인딩 누락 수정
        '**/T-20260525-foot-INS-FIELD-BIND.spec.ts',
        // T-20260526-foot-DOC-FORM-7FIX: 서류 7종 양식 수정 — 주민번호 하이픈/도장/병명 라벨/납입증명서
        '**/T-20260526-foot-DOC-FORM-7FIX.spec.ts',
        // T-20260526-foot-DOC-DIAG-TRUNC: 서류 상병코드 3~4건 전건 노출 (truncation 수정)
        '**/T-20260526-foot-DOC-DIAG-TRUNC.spec.ts',
        // T-20260601-foot-DOC-PRINT-8FIX: 서류 출력 8영역 — 도장 재발/성별·연령 주민번호 산출/처방전 QR·팩스/비급여·공단부담금
        '**/T-20260601-foot-DOC-PRINT-8FIX.spec.ts',
        // T-20260601-foot-DOC-SEAL-NULL-FALLBACK: DB seal_image_url null 회귀 — 로컬자산 fallback 복구
        '**/T-20260601-foot-DOC-SEAL-NULL-FALLBACK.spec.ts',
        // T-20260601-foot-DOC-SEAL-2DOCS: 도장 잔존 누락 2건 — 진료의뢰서·의무기록사본 placeholder 추가
        '**/T-20260601-foot-DOC-SEAL-2DOCS.spec.ts',
        // T-20260601-foot-DOC-SEAL2-RXQR: field-soak 잔여 — 단일/미리보기 경로 도장 fallback 정렬(getStampUrl)
        '**/T-20260601-foot-DOC-SEAL2-RXQR.spec.ts',
        // T-20260601-foot-RX-QR-LABEL: 처방전 우측 상단 보관용 라벨 제거 + QR 가림 해소
        '**/T-20260601-foot-RX-QR-LABEL.spec.ts',
        // T-20260526-foot-RX-PRINT-DUAL: 처방전 2장 출력 (순수 함수 — page 미사용 → unit 편입).
        //   RX-QR-LABEL이 보관용 라벨을 superseded(완전 제거) → 라벨 단언은 "제거됨" 회귀 가드로 전환.
        '**/T-20260526-foot-RX-PRINT-DUAL.spec.ts',
        // T-20260522-foot-TABLET-DUAL-LAYOUT: 태블릿 이중 레이아웃 — 순수 정적 소스 검증 (browser 불필요)
        // desktop-chrome(auth 의존) 대신 unit 프로젝트로 이동 → auth.setup 우회
        '**/T-20260522-foot-TABLET-DUAL-LAYOUT.spec.ts',
        // T-20260520-ins-COPAY-CALC AC-4: 본인부담 산출 순수 함수 단위테스트 (20 TC)
        '**/insurance-calc.spec.ts',
        // T-20260602-multi-CALLBACK-EF-4-NEW: 도파민 콜백 outbox 정적 검증 (마이그레이션/EF/롤백 파일 단언, browser 불필요)
        '**/T-20260602-multi-CALLBACK-EF-4-NEW.spec.ts',
        // T-20260714-foot-LIFECYCLE-CALLBACK-OUTBOX-EMIT: 풋→도파민 lifecycle emit(step2) — reschedule CHECK+트리거,
        //   FOOT_CALLBACK_SECRET 폴백, 단일 타깃(cancel-callback fan-out 금지), payload 계약키 정적 단언. browser 불요.
        '**/T-20260714-foot-LIFECYCLE-CALLBACK-OUTBOX-EMIT.spec.ts',
        // T-20260606-foot-AUTOCOMPLETE-CROSS-PATIENT-AUDIT: 자동완성 cross-patient 누설 분류 불변식 (page 미사용 순수 로직)
        '**/T-20260606-foot-AUTOCOMPLETE-CROSS-PATIENT-AUDIT.spec.ts',
        // T-20260609-foot-PHRASE-SLASH-DROPDOWN-POS: 임상경과 `//` 드롭다운 caret 좌표/wrap 폭 정합 (정본 로직 + page.setContent 실DOM, auth 불요)
        '**/T-20260609-foot-PHRASE-SLASH-DROPDOWN-POS.spec.ts',
        // T-20260612-foot-CLINICAL-SINGLELINE-DROPDOWN-POS: 진료대시보드 한 줄 임상경과 단축어 드롭다운 portal/fixed/flip 좌표 + 실DOM stacking (정본 로직 + page.setContent, auth 불요)
        '**/T-20260612-foot-CLINICAL-SINGLELINE-DROPDOWN-POS.spec.ts',
        // T-20260609-foot-DRUGINFO-MANUFACTURER: 우측 약물 패널/검색 row 제약사 표기 — 데이터 파이프라인 정적 가드 + 실DOM NULL fallback (auth 불요)
        '**/T-20260609-foot-DRUGINFO-MANUFACTURER.spec.ts',
        // T-20260609-foot-RECEIPT-LASER-MISSING: 진료비 영수증 합산 = 진료 항목 SSOT(computeFootBilling.grandTotal) — 레이저 포함, 결제분류 무관 (순수 함수 + 소스 가드, auth 불요)
        '**/T-20260609-foot-RECEIPT-LASER-MISSING.spec.ts',
        // T-20260609-foot-DOCDASH-LABEL-RX-REFINE: 진료대시보드 헤더/처방 내용 라벨/약 한 줄/중앙정렬/처방나감 필터 (순수 로직 모사 + 소스 정적 가드, auth 불요)
        '**/T-20260609-foot-DOCDASH-LABEL-RX-REFINE.spec.ts',
        // T-20260610-foot-DOCDASH-CLINICAL-UX-REFINE: 임상경과 인라인 패널 UX 정제 (소스 정적 검증)
        '**/T-20260610-foot-DOCDASH-CLINICAL-UX-REFINE.spec.ts',
        // T-20260609-foot-FORM-UPLOAD-DOWNSCALE-GUARD: 양식 업로드 폭 1588 다운스케일 가드 (소스 정적 가드 + 실 canvas 동작, auth 불요)
        '**/T-20260609-foot-FORM-UPLOAD-DOWNSCALE-GUARD.spec.ts',
        // T-20260611-foot-REFERRAL-PRINT-CLIP-CENTER: 진료의뢰서 출력 짤림/중앙배치 — form-wrap 폭·margin 정적 검증 + 바인딩 회귀 (auth 불요)
        '**/T-20260611-foot-REFERRAL-PRINT-CLIP-CENTER.spec.ts',
        // T-20260611-foot-DOC-FEATURE-AUDIT-HARDENING: 서류 전 기능 회귀방지 우산 — P0 근인 고정 + 3경로 non-empty 스모크 + L-006 단일경로 가드 (순수 SSOT + 소스 introspection, auth 불요)
        '**/T-20260611-foot-DOC-FEATURE-AUDIT-HARDENING.spec.ts',
        // T-20260614-foot-THEME-MONOCHROME-RECOLOR: 확정 5색 warm-monochrome 팔레트 회귀 락
        //   (정적 소스 가드 + 공개 /login 실렌더, auth 불요)
        '**/T-20260614-foot-THEME-MONOCHROME-RECOLOR.spec.ts',
        // T-20260615-foot-THEME-MONO-REFINE-3AREA: 통합시간표 슬롯/2번차트/치료사탭 국소 모노톤 정제
        //   (정적 소스 가드 + 컴파일 CSS 가드, auth 불요)
        '**/T-20260615-foot-THEME-MONO-REFINE-3AREA.spec.ts',
        // T-20260615-foot-MONOTONE-TIMETABLE-CHART2-THERAPISTGREEN: 형제 재발행(스크린샷 동봉) —
        //   치료사 필터칩 선택-상태 green 원복(brown 누수 정정) 가드 추가 (정적 소스 가드, auth 불요)
        '**/T-20260615-foot-MONOTONE-TIMETABLE-CHART2-THERAPISTGREEN.spec.ts',
        // T-20260615-foot-DOCDASH-NAME-EMOJI-CLINICAL-3FIX: 진료 알림판 이름클릭→차트 / 차트칼럼 제거 /
        //   빈 임상경과 클릭편집·진한톤 (소스 정적 grep, auth 불요). 서브탭 라벨 역전(item7)은 RX-DISPLAY-REVAMP로 이관.
        '**/T-20260615-foot-DOCDASH-NAME-EMOJI-CLINICAL-3FIX.spec.ts',
        // T-20260615-foot-DOCDASH-MEMO-ICON-TOOLTIP: 이름 아래 메모텍스트 제거 → 상태셀 빨간 종 + hover 전문 툴팁
        //   (page.setContent 실 Chromium 렌더 hover 토글 + 소스 정적 가드, auth 불요)
        '**/T-20260615-foot-DOCDASH-MEMO-ICON-TOOLTIP.spec.ts',
        // T-20260615-foot-RESVTAB-MEMO-ICON-SCROLLFIX: 예약메모 표시(✏️)↔편집 토글 + 체류시간 스크롤 재한정
        //   (소스 미러 정적 가드 + page.setContent 실DOM 스크롤 containment, auth 불요)
        '**/T-20260615-foot-RESVTAB-MEMO-ICON-SCROLLFIX.spec.ts',
        // T-20260616-foot-RXSET-QUICKRX-UI-REFINE-5FIX (Stage A ①②③): 처방세트(DrugFoldersTab) 우측
        //   약 검색영역 — 외겹박스 제거/약물목록 table화/분류해제 케밥+확인다이얼로그 (정적 소스 가드, auth 불요)
        '**/T-20260616-foot-RXSET-QUICKRX-UI-REFINE-5FIX.spec.ts',
        // T-20260616-foot-E2E-PROD-WRITE-ISOLATION: RC#0 픽스처 누적 차단 — cleanupAll orphan 스윕 +
        //   globalSetup/Teardown 안전망 회귀 가드 (service_role DB 직접 검증, page/auth 불요)
        '**/T-20260616-foot-E2E-PROD-WRITE-ISOLATION.spec.ts',
        // T-20260718-foot-SIM-HARNESS-TEARDOWN-HYGIENE: 시뮬/CI 하네스 위생(registry teardown POST=DELETE
        //   + is_simulation opt-in + E.164 seed) — service_role DB 직접 검증(page/auth 불요).
        '**/T-20260718-foot-SIM-HARNESS-TEARDOWN-HYGIENE.spec.ts',
        // T-20260703-foot-JONGNO-PACKAGE-TRIPLE-DEFECT: 패키지 3중 결함(양도 이중환불·잔여 리셋·선수금 미차감)
        //   금액/회차 정합 불변식 — transfer_package_atomic + consume_package_sessions_for_checkin RPC
        //   직접 검증(service_role, page/auth 불요). ※RPC 미배포 시 실패 → supervisor DDL apply 후 PASS.
        '**/T-20260703-foot-JONGNO-PACKAGE-TRIPLE-DEFECT.spec.ts',
        // T-20260616-foot-CHART2-RECEIPT-RESTRUCTURE: 영수증·수납내역 표시 재구성 (DISPLAY-ONLY).
        //   ★CRITICAL 회귀가드 = 영수증 업로드 write 경로(package_payments.insert + paid_amount update) 보존
        //   + 표시 필터(feePayments/directPkgPayments/pkgPayments) + readOnly 뷰어 (정적 소스 가드, auth 불요)
        '**/T-20260616-foot-CHART2-RECEIPT-RESTRUCTURE.spec.ts',
        // T-20260620-foot-CHART2-PAYMENT-MISU-HISTORY: 수납내역 탭 [미수이력] 섹션 ADDITIVE 추가 (DISPLAY-ONLY).
        //   발생(packages)+납부(package_payments) 시계열 + 유형 레이블(패키지 잔금/진료비 미수, AC#5) +
        //   열[날짜|유형|금액|처리상태](AC#6). ★회귀가드 = RESTRUCTURE 필터/뷰어 보존 + SSOT 재사용 + §4-A 합산금지.
        '**/T-20260620-foot-CHART2-PAYMENT-MISU-HISTORY.spec.ts',
        // T-20260617-foot-DUMMYRESV-VISITTYPE-INACTIVE: 더미생성 visit_type 을 고객 SSOT 에서 파생
        //   (resolveVisitType 불변식 — reservation.visit_type === customers.visit_type, 순수 함수, auth 불요)
        '**/T-20260617-foot-DUMMYRESV-VISITTYPE-INACTIVE.spec.ts',
        // T-20260617-foot-DOCDASH-DOCLIST-5FIX: 진료대시보드 가로스크롤(A1)/진료완료행 우정렬(A2)/
        //   임상경과 폭초과 dedup(A3)/서브탭·헤더 라벨 역전(B1·A4) (소스 정적 grep, auth 불요). B2 별도.
        '**/T-20260617-foot-DOCDASH-DOCLIST-5FIX.spec.ts',
        // T-20260617-foot-DOCFORM-POPUP-OVERHAUL (Phase 1): 진료대시보드 원장영역 연동 — 행 '서류' 진입점 일원화
        //   (소견서/서류발급/KOH 허브). visitorFromCheckIn 매핑·단일 Dialog 불변식 순수 로직 + 재사용·무회귀
        //   소스 정적 가드(불변 트리거·L-006·기존 탭 병행 보존). auth 불요.
        '**/T-20260617-foot-DOCFORM-POPUP-OVERHAUL.spec.ts',
        // T-20260620-foot-KOHDASH-PATIENTCOL-NAILFMT: 균검사지 진료대시보드 명단 7컬럼(AC-1/AC-8) +
        //   채취조갑 컴팩트 'R1' 2글자(AC-2/§B) + 생년(만나이)(AC-6) — 표시변환 순수 로직 모사(신규 스키마 0, auth 불요)
        '**/T-20260620-foot-KOHDASH-PATIENTCOL-NAILFMT.spec.ts',
        // T-20260623-foot-DOCGEN-CONTRAIND-COMBINE (Phase 1a 엔진): 금기증 복수선택 조합 +
        //   간염 B(C) 치환 순수 함수. MD §3-3 워크드 예시 1:1 + 0/1/2/3개 경계 (auth/CSV 불요).
        '**/T-20260623-foot-DOCGEN-CONTRAIND-COMBINE.spec.ts',
        // T-20260623-foot-DOCGEN-CONTRAIND-COMBINE (item2 합성계층): opinionDocCompose 순수 함수 —
        //   §B 치환순서(① B(C) → ② 날짜 → ③ 경구약X 사유) + §3 조합 + 그룹분류 + data-driven 마커검출.
        //   임신중 §B-3 무처리(scope 제외) 가드. auth/CSV 불요.
        '**/T-20260623-foot-DOCGEN-COMPOSE.spec.ts',
        // T-20260623-foot-OPINIONDOC-AUTOLINK-HEALTHQ: 소견서 체크박스 ← 발건강 질문지 자동 pre-check 매핑
        //   (computeAutoCheckedKeys) + '간염보균자' 옵션 추가. 정본 로직 1:1 모사 + 소스 라벨 동기화 가드
        //   (HealthQMobilePage 상수 ↔ HEALTHQ_AUTOCHECK_MAP, TabletChecklistPage 무관 가드). auth 불요.
        '**/T-20260623-foot-OPINIONDOC-AUTOLINK-HEALTHQ.spec.ts',
        // T-20260623-foot-DOCCHART-PASTHX-TAB: 의사 진료차트 '과거력' 탭 — 발건강 질문지 자동 (-/+) prefill
        //   (pastHistory 순수 함수) + 실장 더블체크·확정(append-only) + 마이그/RLS/결선 정적 미러 가드. auth 불요.
        '**/T-20260623-foot-DOCCHART-PASTHX-TAB.spec.ts',
        // T-20260624-foot-BUNDLERX-ICON-NOAPPLY (part2/AC-0): 처방세트·태그·묶음상병 저장 mutation 의
        //   .select() + 0행 throw 가드 — RLS 0행 silent no-op 의 false-positive 성공토스트 차단 (소스 정적, auth 불요)
        '**/T-20260624-foot-BUNDLERX-ICON-NOAPPLY.spec.ts',
        // T-20260625-foot-FOREIGN-LANG-SAVE: 국적 자동연결 언어값 customers.language 저장.
        //   국적→언어 매핑·LANGUAGE_OPTIONS 값셋은 src/lib/foreign 직접 import 로 실제 동작 단언 +
        //   폼 배선(언어셀렉트·NULL-가드 자동제안·등록/수정 양경로 nullable 저장)·마이그 ADDITIVE 정적 가드.
        //   (이전 desktop-chrome 自체로그인 spec 은 포트 5173↔8089 불일치+seed hold 로 전 케이스 skip →
        //    insufficient_verification NO-GO. unit 으로 재작성해 skip 0·결정론 확보.) auth/webServer 불요.
        '**/T-20260625-foot-FOREIGN-LANG-SAVE.spec.ts',
        // T-20260625-foot-OPINIONDOC-CONTRAIND-REORDER-SUBCAT: 소견서 금기증 21셀 행우선 재정렬 +
        //   대분류-소분류 표시그룹(경구약/간질환/탈모약/임신). 비파괴(24+4키 보존)·표시순서≠조합우선순위
        //   (priority? 가산필드)·간염 B(C) 드롭다운 회귀無 정적/순수함수 단언. auth 불요.
        '**/T-20260625-foot-OPINIONDOC-CONTRAIND-REORDER-SUBCAT.spec.ts',
        // T-20260629-foot-STAFFCAL-CROSSMONTH-SCHEDULE: 직원 근무 캘린더 월경계 교차 주(6/28~7/4)
        //   직원 스케줄 0건 미표시 — dutySheet 파서가 날짜 행의 '다음 달' 라벨('7월')을 헤더로
        //   오인해 그 주를 통째 누락하던 버그. parseMonthHeader 가드(날짜 행≥3 → 헤더 제외) 회귀
        //   방지. 실측 시트 구조 모사 CSV 로 파서 직접 단언(순수 함수, auth/CSV fetch 불요).
        '**/T-20260629-foot-STAFFCAL-CROSSMONTH-SCHEDULE.spec.ts',
        // T-20260629-foot-DOCOUTPUT-PRINT-CENTER-LAYOUT: 출력물 중앙·여백 배치 전면 재검토 — 프린트 엔진
        //   @page 물리 여백 중앙배치 모델(엔진-충실 측정 + 메커니즘 소스 가드). 직전 CENTER-ALIGN 정밀화.
        '**/T-20260629-foot-DOCOUTPUT-PRINT-CENTER-LAYOUT.spec.ts',
        '**/T-20260629-foot-DOCPRINT-CENTER-ALIGN.spec.ts',
        // T-20260630-foot-CONSENT-MARKETING-COL-ROLLBACK: customers.consent_marketing DROP
        //   (비-SSOT divergent 명칭 수렴복원, DA NO-GO as-named). 직전 ...CUSTOMERS-CONSENT-MARKETING-COL
        //   (additive)을 retire 하고 rollback spec 으로 교체. EF 참조 제거 정적 가드(가드B) + DROP 마이그
        //   정합 + 멱등 회귀 0 + AC-LIVE(컬럼無 신규 INSERT 201 & consent_marketing 동반 INSERT 거부).
        //   광고동의 canonical 거처 = consent_ad(consent_marketing 재추가 금지). page/auth 불요.
        '**/T-20260630-foot-CONSENT-MARKETING-COL-ROLLBACK.spec.ts',
        // T-20260630-foot-DOCPRINT-WONBU-SEAL-REMOVE: 진료확인서·통원확인서 2종 한정 우상단 '원부대조필인'
        //   삭제(총괄 김주연 P0). 진단서·소견서 stamp-box 유지(회귀 0) + 제목 중앙정렬 불변.
        //   템플릿 정적 가드 + getHtmlTemplate/bindHtmlTemplate 실 렌더 검증. page/auth 불요.
        '**/T-20260630-foot-DOCPRINT-WONBU-SEAL-REMOVE.spec.ts',
        // T-20260630-foot-DIAGCERT-ORALMED-VIEWERBLUE-PDFBLACK (A안): 진단서 경구약 항목 — 실장 '경구약 사유'
        //   전용 입력칸(field_data.oral_med_reason ADDITIVE) → 원장 작성창 oralXReason prefill(대괄호 제거) →
        //   뷰어 파란글씨(text-blue-600)/서류 검정(printOpinionDoc plain). 순수 함수 + render-split 정적 회귀가드.
        //   ★서류 출력 파란색 0 가드(파괴적 회귀 차단). auth/page 불요.
        '**/T-20260630-foot-DIAGCERT-ORALMED-VIEWERBLUE-PDFBLACK.spec.ts',
        // T-20260701-foot-ASSIGNORDER-COMPACT-LAYOUT: RotationOrderDialog 컨테이너 여백 컴팩트(밀도만)
        //   + 드래그/저장경로/권한 불변 회귀가드. 순수 소스 정적 단언(page/auth 불요).
        '**/T-20260701-foot-ASSIGNORDER-COMPACT-LAYOUT.spec.ts',
        // T-20260706-foot-INTAKE-REVISIT-JUDGE-365: 초진/재진 분류 = 최근 완료방문 365일 recency(서버 KST).
        //   순수 판정 함수(classifyVisitByRecency/diffDaysISO) 경계값(365/366) off-by-one + 무이력 회귀가드
        //   + NewCheckInDialog 배선(resolveVisitTypeByRecency) 소스 정적 가드. page/auth/server 불요.
        '**/T-20260706-foot-INTAKE-REVISIT-JUDGE-365.spec.ts',
        // T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN: daily_closings/closing_manual RLS SELECT over-open 제거
        //   검증. DC-1/DC-2/AC-4 = Management API(request fixture, SUPABASE_ACCESS_TOKEN) 직결 prod 정책 assert,
        //   DC-FE = permissions lib 순수 단언. page/auth.setup/webServer 불요.
        //   ★unit 편입 사유(FIX-REQUEST MSG-20260706-114959-rb3f): desktop-chrome(auth.setup 의존)에 있으면
        //     TEST_PASSWORD 없는 QA 워크트리에서 setup 실패→DB 검증 skip=insufficient_verification 재발.
        //     spec 이 브라우저/로그인 불요이므로 unit 으로 이동해 skip 0·결정론 확보(FOREIGN-LANG-SAVE 선례 동일).
        '**/T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN.spec.ts',
        // T-20260708-foot-BRIEFMEMO-TIMETABLE-CHIPONLY-EDIT: 통합시간표 간략메모 '선택 칩만 표시(수기 제외)'
        //   판정(isBriefNoteChip/BRIEF_NOTE_CHIPS SSOT) 순수 단언 + Dashboard 표시게이트·팝업 편집 UI 소스 정적 가드.
        //   page/auth/server 불요(FE-only, 스키마 무변경). 실 렌더·저장은 supervisor 갤탭 field-soak.
        '**/T-20260708-foot-BRIEFMEMO-TIMETABLE-CHIPONLY-EDIT.spec.ts',
        // T-20260708-foot-PENCHART-REGRESSION-3FIX: 펜차트 회귀 3종 — 화이트 도구 v3(source-atop 부분 덮기·통삭제 없음)
        //   + 라벨 13px + 상용구 조작 핸들. 순수 로직 + about:blank canvas page.evaluate(auth/server/로그인 불요).
        //   실기기 브러시 렌더·현장 confirm 은 supervisor 갤탭 field-soak. unit 편입 → auth.setup 우회(skip 0).
        '**/T-20260708-foot-PENCHART-REGRESSION-3FIX.spec.ts',
        // T-20260709-foot-LAYOUT-WHITESPACE-REDUCE: 발건강질문지 별도창 form row 세로폭 축소
        //   (상/하 패딩 8→4·행간 1.45→1.35, 가로 13px 불변). 소스 정적 가드 + page.setContent 실 DOM
        //   측정(row 높이 축소·잘림0·겹침0). FE-only spacing, DB/스키마 무변경. auth/server 불요.
        '**/T-20260709-foot-LAYOUT-WHITESPACE-REDUCE.spec.ts',
        // T-20260710-foot-DASHBOARD-PAGELOAD-ERROR: 현장 "모든 메뉴 오류" = stale 번들 → lazy chunk purge →
        //   ChunkErrorBoundary fallback. RC = lazyWithRetry 재시도 가드가 영구 단발 플래그라 한 번 세워지면
        //   자가치유 영구 무력화. 처방 = 시간 윈도우 가드 SSOT(@/lib/chunkReload)로 교체 + ChunkErrorBoundary
        //   eval-time chunk 에러 자동 하드리로드(1회, 루프 차단). 순수 단위/소스 정적(page/auth/server 불요).
        '**/T-20260710-foot-DASHBOARD-PAGELOAD-ERROR.spec.ts',
        // T-20260707-foot-DOCPRINT-INSURANCE-SPLIT-RECUR: 급여/비급여 본인·공단 split (grade-null → 본인=급여전액/공단=0).
        //   pure-path SSOT 단언(SPLIT-RECUR) + AC-3 실브라우저 인쇄 미리보기 렌더 evidence(RENDER, page.setContent+print media
        //   로 세부산정내역·계산서영수증 × grade-null/실재 4문서 스크린샷). auth/server 불요(setContent 정적 렌더).
        '**/T-20260707-foot-DOCPRINT-INSURANCE-SPLIT-RECUR.spec.ts',
        '**/T-20260707-foot-DOCPRINT-INSURANCE-SPLIT-RECUR-RENDER.spec.ts',
        // T-20260714-foot-DOCPRINT-GONGDAN-HIDE-COPAY-ONLY (B안): 계산서·영수증/세부산정내역 '합계' = 급여 본인부담금 + 비급여
        //   (공단 제외). 공단부담금 칸/금액 표시는 유지. SSOT 렌더(computeFootBilling/buildBillReceiptFeeGridHtml/
        //   buildBillDetailItemsHtml) + page.setContent+print media 인쇄 미리보기 스크린샷(AC-5) + 합계·공단표시 단언. auth/server 불요.
        '**/T-20260714-foot-DOCPRINT-GONGDAN-HIDE-COPAY-ONLY.spec.ts',
        // T-20260716-foot-DOCPRINT-GONGDAN-SUM-REGRESSION: 결제창(PATH-4) 서류 '계'·'합계'·총진료비 공란 회귀 hotfix.
        //   PMW 바인딩에 detail_subtotal/detail_total/receipt_total(=본인부담+비급여, 공단 제외) 재바인딩 복구.
        //   SSOT 렌더 + page.setContent print media 인쇄 미리보기 + RC/AC-7 역가드. auth/server 불요.
        '**/T-20260716-foot-DOCPRINT-GONGDAN-SUM-REGRESSION.spec.ts',
        // T-20260714-foot-NONCOVERED-CONSENT-TABLET-SCROLL: 비급여동의서 서명 뷰 태블릿 스크롤 불가 픽스
        //   (vh→dvh + flex 컬럼·shrink-0 푸터). page.setContent 실 DOM 스크롤 측정(태블릿 768×1024 /
        //   PC 1280×800) + 旧 구조 대조 + ConsentFormDialog.tsx 소스 정적 가드. auth/server 불요.
        '**/T-20260714-foot-NONCOVERED-CONSENT-TABLET-SCROLL.spec.ts',
        // T-20260714-foot-DOCFEE-BODYCENTER-REDESIGN: 진료비 계산서·영수증 신양식(bill_receipt_new) 코드-레벨 불변식
        //   (AC3 대표자={{receipt_representative}} rebind · AC4 병원 고정정보 · AC5 격리 · fallback field_map).
        //   src 정적 grep + page.setContent 결정론 렌더. 스펙 자체가 "로그인 불요·결정론적" 선언 → unit 편입.
        //   (FIX-REQUEST MSG-20260716-003500-sg9r: 미편입 시 desktop-chrome 매치 → auth.setup 기동 →
        //    TEST_PASSWORD 없는 QA 워크트리 env_missing 실패. unit 편입 + desktop-chrome testIgnore 로 우회.)
        '**/T-20260714-foot-DOCFEE-BODYCENTER-REDESIGN.spec.ts',
        // T-20260714-foot-OBLIVORIGIN-INSTNAME-REPPRINT: 요양기관명 축(hira_institution_name) 재배선 +
        //   대표자 print 분리(CEO Q2). getHtmlTemplate/bindHtmlTemplate + buildAutoBindValues 순수 함수 —
        //   축 분리·affirmative(silent 폴백 금지)·진료의({{doctor_name}}) 보존 단언. 실기기 렌더는 supervisor 게이트. auth/server 불요.
        '**/T-20260714-foot-OBLIVORIGIN-INSTNAME-REPPRINT.spec.ts',
        // T-20260713-foot-CLOSING-REFUND-PAYTYPE-GROUPING-ITEMSELECT: 일마감 환불창 유형 구분(패키지/진료비/단건)
        //   + 항목 선택 환불 + [FOLD] 완전환불행 재환불 방지. 순수 로직(selectedSum/isFullyRefunded money-path
        //   가드) + Closing.tsx 정적 소스 가드로 AC-1~6·AC-B1~B3 결정론 검증. real-browser 렌더는 갤탭 field-soak.
        //   (FIX-REQUEST MSG-20260717-141523-ydgt: phase2 spec_missing — desktop-chrome 단독 매칭 시
        //    QA 워크트리 TEST_PASSWORD 부재로 auth.setup 기동/실패 → "No tests found". unit 편입으로 차단.)
        '**/T-20260713-foot-CLOSING-REFUND-PAYTYPE-GROUPING-ITEMSELECT.spec.ts',
        // T-20260716-foot-DOCPRINT-BILLDETAIL-SUBTOTAL-TOTAL-BLANK: 세부산정내역 '계'/'합계'(detail_subtotal/
        //   detail_total) 공란(0) 회귀 가드. DocumentPrintPanel bill_detail 바인딩을 SSOT(computeFootBilling/
        //   buildFootBillDetailItems)로 replay → 계/합계 = 본인부담+비급여(공단 제외, B안 보존) 단언 +
        //   공단 칸 표시 유지(AC4) + 항목 0건 '0' 표시 + page.setContent 인쇄 미리보기 캡처. auth/server 불요.
        '**/T-20260716-foot-DOCPRINT-BILLDETAIL-SUBTOTAL-TOTAL-BLANK.spec.ts',
        // T-20260715-foot-CHART-SUSU-EXPPAY-INCLUDE: 고객 차트 '수납내역' 탭에 체험(회수1·단건)
        //   패키지 구입 영수증결제(memo='영수증 업로드(회수1…')도 표시(현장 '결제없음' 오인 해소, RC-A).
        //   DISPLAY-ONLY read 필터 확장 — feePayments 필터 회수1 포함 분기 + 일반 영수증 업로드 제외
        //   유지 + 순서/중복 불변식 런타임 단언(정본 소스 미러). write-path·집계 무접점. auth/server 불요.
        '**/T-20260715-foot-CHART-SUSU-EXPPAY-INCLUDE.spec.ts',
        // T-20260715-foot-SAMEDAY-VISITTYPE-DISPLAY-CHECKINS-SOURCE: 당일 초진/재진 표기 소스를
        //   check_ins.visit_type(접수 스냅샷) 으로 교정. 순수 함수(classifyVisitByRecency/diffDaysISO)
        //   + Closing/visitRecency/NewCheckInDialog 정적 소스 가드. page/auth/server 불요.
        //   ★unit 편입 사유(FIX-REQUEST MSG-20260715-124201-dcp9): unit 프로젝트 testMatch 미등록 시
        //     `npx playwright test <file> --project=unit` 이 "No tests found" → spec_fail_new.
        //     desktop-chrome 로 흘러가면 auth.setup(TEST_PASSWORD) 끌어들여 QA 워크트리 실패.
        //     → unit 등록(실행) + desktop-chrome testIgnore(무-project QA 시 setup 미기동)로 결정론 확보.
        '**/T-20260715-foot-SAMEDAY-VISITTYPE-DISPLAY-CHECKINS-SOURCE.spec.ts',
        // T-20260715-foot-RESVDETAIL-CUSTMEMO-C2Z1-SYNC: 5개 화면 [고객메모] 단일 저장소(customer_note) 수렴.
        //   read `customer_note ?? customer_memo` / write `customer_note` 정적 가드(예약팝업·2번차트·체크인·
        //   고객목록/편집·신규등록) + service-role DB 왕복(양방향 공유 컬럼) + 3구역 예약메모 seed(customer_memo) 무회귀.
        //   page/auth/server 불요(fs 소스 정적 + service-role DB, 비파괴 원본 복원). db_change=false.
        '**/T-20260715-foot-RESVDETAIL-CUSTMEMO-C2Z1-SYNC.spec.ts',
        // T-20260716-foot-DOCFEE-NONPAY-SEAL (AC2 슬롯키드 직인) + reconcile 세트 — 순수 바인딩/템플릿/격리 단언.
        //   대표자란=법인 인감(institution_seal_html) / 원장 서명란=개인직인(doctor_seal_html). auth/server 불요.
        '**/T-20260716-foot-DOCFEE-NONPAY-SEAL.spec.ts',
        '**/T-20260713-foot-DOCPRINT-SEAL-MOON-INSTITUTION-AC6V2.spec.ts',
        '**/T-20260715-foot-RECEIPT-REPNAME-SEAL-BODYPORT.spec.ts',
        // T-20260719-foot-DOCTAB-NEW-CREATE: 2번차트 [서류] 탭 신규(additive) — 예약내역 목록+행별 재출력+
        //   당일 서류 발행 별도 팝업. 소스 미러 정적 가드 + page.setContent 실DOM 시나리오(auth/server 불요).
        '**/T-20260719-foot-DOCTAB-NEW-CREATE.spec.ts',
        // T-20260719-foot-DOCHIST-MULTIPATH-EXTEND item②: 결제 미니창 발행이력 조회+재출력(DocumentPrintPanel 이식).
        //   소스 미러 정적 가드 + page.setContent 버튼→모달 토글(auth/server 불요).
        '**/T-20260719-foot-DOCHIST-MULTIPATH-EXTEND.spec.ts',
        // T-20260719-foot-MEDCALC-DETAIL-LAYOUT-FIX: 세부산정내역 하단 3행(계 5열 세로합·끝처리 조정 10원절사·
        //   합계 병합/중앙정렬) — 순수 로직(computeBillDetailRounding) + setContent 렌더 spec. auth/server 불요.
        '**/T-20260719-foot-MEDCALC-DETAIL-LAYOUT-FIX.spec.ts',
        // T-20260721-foot-KIOSK-NFD-MASK-NORMALIZE: 서버측 마스킹 NFD 깨짐 교정. 마스킹은 100% SQL RPC이고
        //   native 셀프체크인 렌더는 이 레포에서 제거(T-20260602-CONSOLIDATE, 키오스크=foot-checkin 별도 레포)
        //   → 브라우저 flow wrong-target. 마스킹 산식 정본 미러(JS normalize NFC) + 마이그 정적 가드로
        //   NFC 교정 계약을 결정론 잠금. 실배포 함수 증거=SQL dry-run(_dryrun.mjs). auth/server/page 불요.
        '**/T-20260721-foot-KIOSK-NFD-MASK-NORMALIZE.spec.ts',
      ],
      use: {
        ...devices['Desktop Chrome'],
      },
      // auth 의존성 없음 — page 객체 미사용 순수 함수 테스트
    },
    {
      name: 'desktop-chrome',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        storageState: AUTH_FILE,
      },
      dependencies: ['setup'],
      // 순수 정적 소스 가드(unit 프로젝트 전용)는 desktop-chrome 에서 제외 — auth.setup 의존을
      // 끌어들이지 않도록. (그래야 `npx playwright test <file>` 무-project 실행 시 setup 미기동 →
      // TEST_PASSWORD 없는 QA 워크트리에서도 통과. FIX-REQUEST MSG-20260701-204705-zyhy)
      testIgnore: [
        // T-20260721-foot-OPINIONDOC-DESK-BLANK: unit 전용 소스 가드 + bindHtmlTemplate 실렌더 spec →
        //   무-project 실행(supervisor QA) 시 desktop-chrome 매칭→setup(TEST_PASSWORD) 유입 차단. unit 에서만 실행.
        '**/T-20260721-foot-OPINIONDOC-DESK-BLANK.spec.ts',
        '**/T-20260701-foot-DASH-GLASS-SHADOW-SOFTEN-PASTBANNER-COMPACT.spec.ts',
        // T-20260714-foot-DOCFEE-BODYCENTER-REDESIGN: 순수 정적/렌더 unit 스펙 — desktop-chrome(auth 의존)
        //   에서 제외해 `npx playwright test <file>` 무-project 실행 시 setup 미기동. (FIX-REQUEST MSG-20260716-003500-sg9r)
        '**/T-20260714-foot-DOCFEE-BODYCENTER-REDESIGN.spec.ts',
        // T-20260714-foot-DOCPRINT-GONGDAN-HIDE-COPAY-ONLY: unit 전용 setContent 렌더 spec.
        //   무-project 실행(supervisor QA) 시 desktop-chrome 가 매칭→setup(TEST_PASSWORD) 끌어들여
        //   실패하던 것을 차단(FIX-REQUEST MSG-20260715-114337-t54c). unit 에서만 실행.
        '**/T-20260714-foot-DOCPRINT-GONGDAN-HIDE-COPAY-ONLY.spec.ts',
        // T-20260713-foot-CLOSING-REFUND-PAYTYPE-GROUPING-ITEMSELECT: unit 전용(순수 로직 + 소스 가드).
        //   무-project 실행(supervisor QA) 시 desktop-chrome 매칭 → auth.setup(TEST_PASSWORD) 끌어들여
        //   "No tests found"/실패하던 것을 차단(FIX-REQUEST MSG-20260717-141523-ydgt). unit 에서만 실행.
        '**/T-20260713-foot-CLOSING-REFUND-PAYTYPE-GROUPING-ITEMSELECT.spec.ts',
        // T-20260716-foot-DOCPRINT-BILLDETAIL-SUBTOTAL-TOTAL-BLANK: unit 전용 setContent 렌더 spec →
        //   무-project 실행 시 desktop-chrome 매칭→setup(TEST_PASSWORD) 끌어들이지 않도록 제외. unit 에서만 실행.
        '**/T-20260716-foot-DOCPRINT-BILLDETAIL-SUBTOTAL-TOTAL-BLANK.spec.ts',
        // T-20260719-foot-MEDCALC-DETAIL-LAYOUT-FIX: unit 전용 순수+setContent spec → 무-project 실행
        //   (supervisor QA) 시 desktop-chrome 매칭→setup(TEST_PASSWORD) 유입 차단. unit 에서만 실행.
        '**/T-20260719-foot-MEDCALC-DETAIL-LAYOUT-FIX.spec.ts',
        // T-20260721-foot-BILLDOC-GONGDAN-ROUND-2DOC: unit 전용 순수 산식+정적 가드 spec →
        //   무-project 실행(supervisor QA) 시 desktop-chrome 매칭→setup(TEST_PASSWORD) 유입 차단. unit 에서만 실행.
        '**/T-20260721-foot-BILLDOC-GONGDAN-ROUND-2DOC.spec.ts',
        // T-20260718-foot-SIM-HARNESS-TEARDOWN-HYGIENE: db-only(unit 전용) — desktop-chrome 에서 제외해
        //   `npx playwright test <file>` 무-project 실행(supervisor QA) 시 auth.setup(TEST_PASSWORD) 미기동.
        '**/T-20260718-foot-SIM-HARNESS-TEARDOWN-HYGIENE.spec.ts',
        // T-20260715-foot-SAMEDAY-VISITTYPE-DISPLAY-CHECKINS-SOURCE: unit 전용 순수함수+정적가드 spec.
        //   무-project 실행(supervisor QA) 시 desktop-chrome 매칭→setup(TEST_PASSWORD) 유입 차단
        //   (FIX-REQUEST MSG-20260715-124201-dcp9). unit 에서만 실행.
        '**/T-20260715-foot-SAMEDAY-VISITTYPE-DISPLAY-CHECKINS-SOURCE.spec.ts',
        // T-20260716-foot-DOCFEE-NONPAY-SEAL 세트 — unit 전용 순수 spec. 무-project 실행 시 setup 미유입.
        '**/T-20260716-foot-DOCFEE-NONPAY-SEAL.spec.ts',
        '**/T-20260713-foot-DOCPRINT-SEAL-MOON-INSTITUTION-AC6V2.spec.ts',
        '**/T-20260715-foot-RECEIPT-REPNAME-SEAL-BODYPORT.spec.ts',
        // T-20260719-foot-DOCHIST-MULTIPATH-EXTEND: unit 전용 정적/setContent spec →
        //   무-project 실행(supervisor QA) 시 desktop-chrome 매칭→setup(TEST_PASSWORD) 유입 차단. unit 에서만 실행.
        '**/T-20260719-foot-DOCHIST-MULTIPATH-EXTEND.spec.ts',
        // T-20260721-foot-KIOSK-NFD-MASK-NORMALIZE: unit 전용 순수 산식 미러 + 마이그 정적 가드 spec →
        //   무-project 실행(supervisor QA) 시 desktop-chrome 매칭→setup(TEST_PASSWORD) 유입 차단. unit 에서만 실행.
        '**/T-20260721-foot-KIOSK-NFD-MASK-NORMALIZE.spec.ts',
      ],
    },
    {
      name: 'tablet',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 768, height: 1024 },
      },
      // Tablet은 공개 페이지만 (로그인 rate limit 회피, storageState 미사용)
      testMatch: ['**/page-screenshots.spec.ts', '**/self-checkin.spec.ts'],
      grep: /Public|Self check-in route/,
    },
  ],

  webServer: {
    // 기동 전 8091 포트의 죽은 잔여 프로세스를 먼저 정리한 뒤 dev 서버를 띄운다.
    //   배경: 직전 run의 zombie vite가 8091를 점유하면(소켓은 열렸지만 응답 없음) Playwright가
    //         auth.setup `page.goto('/login')` 단계에서 net::ERR_CONNECTION_REFUSED 로 실패.
    //   reuseExistingServer=true 일 때 정상 서버가 이미 떠 있으면 Playwright가 url 헬스체크 후
    //   이 command 자체를 실행하지 않으므로, free-test-port 는 launch 가 필요한 경우(=죽은/없는
    //   서버)에만 동작 → 정상 재사용 서버를 죽이지 않는다.
    //
    // ⚠ 고아 dev-server 누수 방지(RC 84qw / T-20260616-meta-QA-BUILD-CONTENTION):
    //   과거 `&& npm run dev` 사용 시 프로세스 트리가 `bash -c ← npm ← vite ← esbuild` 였다.
    //   Playwright teardown은 자신이 spawn한 PID(bash -c)에만 SIGTERM을 보내고, bash -c는
    //   자식으로 신호를 전파하지 않으므로 bash -c만 죽고 npm+vite 가 고아가 되어 launchd(PPID=1)
    //   로 reparent → QA 호스트에 vite/esbuild 트리가 수 시간 누수(빌드 경합 유발).
    //   → `exec`로 vite 바이너리를 직접 실행해 중간 npm 레이어를 제거한다. 이제 Playwright가
    //     추적하는 PID == vite 이므로 graceful SIGTERM이 vite에 직접 도달, vite가 esbuild 자식을
    //     정리한다. (세션 SIGKILL 시의 전역 idle-tree reaper 는 meta 티켓 supervisor+conductor 소유)
    command: 'bash scripts/free-test-port.sh 8091 && exec node_modules/.bin/vite',
    // 전용 테스트 포트 8091(foot 격리): 일반 dev(8085)·형제 CRM(8089 등)과 분리
    // VITE_DEV_PORT=8091 → vite.config.ts server.port 에서 읽어 8091로 기동
    // reuseExistingServer: 로컬에선 이미 8091에 떠있는 서버를 재사용(잔여 프로세스로 인한
    //   "8089 is already used" webServer 기동 실패 방지). CI에선 항상 새로 기동.
    //   포트 정리가 필요하면 `npm run test:e2e:clean` 또는 scripts/free-test-port.sh 사용.
    url: 'http://localhost:8091',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      // Vite dev 서버에 테스트 모드 플래그 전달 → src/lib/supabase.ts 에서 lock 우회
      VITE_DISABLE_AUTH_LOCK: '1',
      // 전용 테스트 포트 — 일반 dev 서버(8085)·형제 CRM(8089)과 충돌 방지
      VITE_DEV_PORT: '8091',
    },
  },
});
