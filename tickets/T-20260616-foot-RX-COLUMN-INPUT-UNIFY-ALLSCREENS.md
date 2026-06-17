---
ticket_id: T-20260616-foot-RX-COLUMN-INPUT-UNIFY-ALLSCREENS
status: deploy-ready
priority: P1
domain: foot
created_at: 2026-06-16
build_ok: true
spec_added: tests/e2e/T-20260616-foot-RX-COLUMN-INPUT-UNIFY-ALLSCREENS.spec.ts
db_changed: false
data_architect_consult: 불요 — presentation(라벨) + input validation(onChange 필터)만. 신규 컬럼·테이블·enum·필드매핑 변경 0
risk_level: GO (1/5 — presentation + input validation only, DB/CRUD/토큰정의 무변경)
deploy_ready: true
commit_sha: c68f6112
---

## 요청 (NEW-TASK, planner P1 — MSG-20260616-170131-q3ob)

reporter 문지은 대표원장: "처방세트 추가든 뭐든 약을 다루는 화면에서는 칼럼명과 안의 박스를 통일.
박스 안엔 숫자만. 칼럼명도 네가 말한 거로 고정. 절대 달라지지 않게."

### 칼럼명 표준 (확정본 — 변경 절대 금지)
약이름(용량) / 용법 / 횟수 / 일수
- 정본 출처: RXTABLE-PRESCRIPTION-ALIGN AC1 (commit e9cbb16 배포완료)
- 토큰 매핑: RX-TOKEN-FORMAT(deployed) — 1=dosage(1회량)/3=count(1일횟수)/2=days(총일수). 필드 매핑·순서 변경 금지.

## Acceptance Criteria

- **AC1** 약 CRUD/입력 발생 전 화면 칼럼 헤더를 표준으로 고정. 화면별 임의 변형(약품/시술명 등) 교체.
- **AC2** 용법·횟수·일수 input 숫자전용 강제(한글·영문 차단). 약이름 박스 제외. 범위표기(~)는 용법 박스에 허용.
- **AC3** 칼럼 순서·필드 매핑 RX-TOKEN-FORMAT 기준 유지.
- **AC4** 약 <  > 연동 속성(1/3/2 display)과 column 매핑 일관성 유지.
- **제외(회귀 금지):** MedicalChartPanel 처방내역 테이블뷰(RXTABLE 완료분) 미접촉.

## 현장 클릭 시나리오 (QA 수동 검증 + spec 1:1 매핑)

> 본 spec `tests/e2e/T-20260616-foot-RX-COLUMN-INPUT-UNIFY-ALLSCREENS.spec.ts`(14 PASS)는 라벨 SSOT·숫자전용 필터·필드매핑 불변식을 정본 소스에 정적 단언으로 인코딩(데이터/로그인 비의존). 아래는 supervisor·현장(갤탭)이 같은 4 surface를 손으로 눌러 확인하는 클릭 순서다. 각 단계 끝 `(spec …)`가 대응 단언.

### 사전조건
- 로그인: 슈퍼관리자 또는 admin 권한 계정.
- 확인 포인트 2개뿐 — ① 칼럼 헤더가 **약이름 / 용량 / 용법 / 횟수 / 일수** 표준인가 ② 용법·횟수·일수 박스에 한글/영문이 안 들어가는가.

### 시나리오 1 — 처방세트 폼 (PrescriptionSetsTab)
1. 좌측 메뉴 → 설정(admin) → **처방세트** 탭 → [추가] 또는 기존 세트 [편집].
2. 약 입력 테이블 칼럼 헤더가 **약이름 / 용량 / 횟수 / 일수** 인지 확인. 옛 라벨(약품/시술명·약품명·1일횟수·회수·투약일) 잔존 0. (spec S1-1, S1-2)
3. **횟수** 박스에 한글 "세번", **일수** 박스에 "닷새" 입력 시도 → 입력 안 됨(숫자전용 type=number). 숫자(예 3 / 5)만 입력됨. (spec S1-3)
   - 비고: 정의 폼 **용량**은 '적정량' 자유텍스트(AC2 숫자전용 제외 대상). 용법칸 없음(값 보존).

### 시나리오 2 — 상용구 약 폼 (SuperPhrasesTab)
1. 설정(admin) → **상용구** 탭 → 약 입력 폼 진입.
2. 칼럼 헤더 **약이름 / 용량 / 용법 / 횟수 / 일수** 표준 확인. 옛 '약품/시술명' 잔존 0. (spec S2-1)
3. **용법** 박스에 한글 "1일 3회" 입력 → 차단. "1~3"(범위 표기)은 허용됨. (spec S2-2)
4. **일수** 박스 한글 차단(숫자만), **횟수** = 숫자 스피너(RxCountInput). (spec S2-3)

### 시나리오 3 — 처방 작성/수납 인라인 (PaymentMiniWindow / DocumentPrintPanel)
1. 수납(PaymentMiniWindow)에서 처방 약 인라인 입력 → **용량 / 횟수 / 일수** 3박스 라벨 표준 + 한글 입력 차단(숫자만). (spec S3-1)
2. 문서 출력 패널(DocumentPrintPanel) rx_standard 인라인 → 동일하게 3박스 라벨 표준 + 숫자전용. (spec S3-2)

### 시나리오 4 — 회귀 가드 (변경되면 FAIL)
1. 진료차트(MedicalChartPanel) 처방내역 테이블 헤더가 **약이름 (용량) / 용법 / 횟수 / 일수** 그대로 보존(이번 작업 미접촉). (spec REGRESSION)
2. 필드 매핑(용법=frequency / 횟수=count / 일수=days)·토큰(1/3/2)·DB 스키마 ALTER 0. (spec GUARD-1, GUARD-2)

## 구현 (commit e866008f, origin/main push 완료)

- `src/lib/rxFormat.ts`: `RX_COL` SSOT 칼럼 라벨(약이름/용량/용법/횟수/일수 + `nameWithDosage='약이름(용량)'` 테이블 합본 헤더) +
  `rxDigits`(숫자전용)·`rxDigitsRange`(숫자+범위 ~) 입력 필터 헬퍼 신설.
- 식별·적용 surface (약 입력 컬럼 헤더 발생 컴포넌트):
  - `src/components/admin/PrescriptionSetsTab.tsx` — 처방세트 정의/추가 폼. 라벨→RX_COL. 일수 type=number, 횟수=RxCountInput(숫자). 용량(정의 폼)='적정량' 자유텍스트(AC2 미대상). 용법칸은 기존부터 제거(값 보존).
  - `src/components/admin/SuperPhrasesTab.tsx` — 상용구 약 폼. 라벨→RX_COL. 용법 rxDigitsRange, 일수 rxDigits+type=number, 횟수=RxCountInput. 약품/시술명→약이름.
  - `src/components/PaymentMiniWindow.tsx` — 처방 인라인(per-item RxDosage). 라벨→RX_COL. 용량/횟수/일수 use-time 박스 rxDigits 숫자전용.
  - `src/components/DocumentPrintPanel.tsx` — rx_standard 인라인. 라벨→RX_COL. 3박스 rxDigits 숫자전용.
- 미접촉 surface(범위 외 확인): QuickRxBar/BundleRxTagBar(태그/버튼 바 — 컬럼 헤더·입력박스 없음), 약 검색박스(DrugFoldersTab/ContraindicationsTab/InsuranceStatusTab — 검색 placeholder, 컬럼 아님).
- **MedicalChartPanel 처방내역 테이블뷰 미접촉** — REGRESSION 가드 spec 포함.
- 필드 매핑·토큰(1/3/2)·DB 무변경 (presentation + input validation only).

## 검증

- tsc(tsconfig.app.json) exit 0 · vite build OK(4.56s).
- E2E `tests/e2e/T-20260616-foot-RX-COLUMN-INPUT-UNIFY-ALLSCREENS.spec.ts` **14 PASS**
  (SSOT-1/2 라벨·필터 + S1 처방세트 + S2 상용구 + S3 PaymentMiniWindow/DocumentPrintPanel + GUARD DB/필드매핑 불변 + REGRESSION MedicalChartPanel 헤더 보존).
- 실브라우저 렌더 자가검증 스크린샷: evidence/...RX-COLUMN-INPUT-UNIFY-ALLSCREENS_S1_rxset(_form)/_S2_super(_dialog).png.

## 잔여 게이트

- supervisor 시각 QA(전 surface 칼럼명 4표준 + 숫자전용 한글차단).
- 김주연 총괄/문지은 대표원장 갤탭 실기기 현장 confirm.
- **planner 회수 질의(용량 일관성):** 정의 폼 용량='적정량' 자유텍스트 vs 사용시점 박스=숫자전용. AC2가 용량을 숫자전용 대상에서 제외(용법·횟수·일수만 명시)했으나, reporter "박스 안엔 숫자만" 문언과의 정합은 reporter 현장 confirm으로 확정 권고.
