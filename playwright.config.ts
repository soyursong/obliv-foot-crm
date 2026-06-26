import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env (Supabase URL/key) + .env.test (테스트 전용 플래그) 를 모두 로드
dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config({ path: path.join(__dirname, '.env.test') });
// .env.local (gitignored, 비커밋) — SUPABASE_ACCESS_TOKEN 등 DB정책 E2E 비밀 로드.
// 미존재 시 무시 → DB 정책 spec 은 test.skip 로 안전 강등(스킵 사유 명확).
dotenv.config({ path: path.join(__dirname, '.env.local'), override: true });

const AUTH_FILE = path.join(__dirname, '.auth', 'user.json');

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
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: 'http://localhost:8089',
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
    // 기동 전 8089 포트의 죽은 잔여 프로세스를 먼저 정리한 뒤 dev 서버를 띄운다.
    //   배경: 직전 run의 zombie vite가 8089를 점유하면(소켓은 열렸지만 응답 없음) Playwright가
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
    command: 'bash scripts/free-test-port.sh 8089 && exec node_modules/.bin/vite',
    // 전용 테스트 포트 8089: 일반 dev(8085)와 분리
    // VITE_DEV_PORT=8089 → vite.config.ts server.port 에서 읽어 8089로 기동
    // reuseExistingServer: 로컬에선 이미 8089에 떠있는 서버를 재사용(잔여 프로세스로 인한
    //   "8089 is already used" webServer 기동 실패 방지). CI에선 항상 새로 기동.
    //   포트 정리가 필요하면 `npm run test:e2e:clean` 또는 scripts/free-test-port.sh 사용.
    url: 'http://localhost:8089',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      // Vite dev 서버에 테스트 모드 플래그 전달 → src/lib/supabase.ts 에서 lock 우회
      VITE_DISABLE_AUTH_LOCK: '1',
      // 전용 테스트 포트 — 일반 dev 서버(8085)와 충돌 방지
      VITE_DEV_PORT: '8089',
    },
  },
});
