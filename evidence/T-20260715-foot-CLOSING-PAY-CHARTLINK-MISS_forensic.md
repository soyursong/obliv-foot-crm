# T-20260715-foot-CLOSING-PAY-CHARTLINK-MISS — 1차 READ-ONLY DB Forensic

- 작성: dev-foot / 2026-07-15
- 소스: prod rxlomoozakkjesdqjtvd, SELECT-only (신규 write 0)
- 판정 원칙: 추정 금지 — 아래 스냅샷 근거만 사용
- 관련 선행: T-20260715-CLOSING-SINGLEPAY-F4716-CHARTMATCH-RECUR (동일 F-4716, 재발)

---

## AC1 — F-4716 김희정 59,000 카드건 매핑 상태 + RC 확정

### 핵심 반증: 마감은 closing_manual_payments가 아니라 canonical payments 경로
- `closing_manual_payments` (close_date=2026-07-15) = **0건**. → default 'manual'(비연동) 경로 RC 아님(선행 티켓 초기 가설 반증).
- F-4716 결제는 canonical `payments`에 정상 존재:
  - row `a72eea54-356d-4a02-b001-ba6392de2cdc` / 59,000 / card / payment / **check_in_id=NULL(single)** / memo=`영수증 업로드(회수1·단건)` / created_at `2026-07-15 04:31:46 UTC` = **13:31:46 KST** (담당·시각 일치)

### 결정적 RC = 결제 후 패키지 취소·재생성 → credit stranded
F-4716 패키지 4개 타임라인 (KST=UTC+9):
| 시각(KST) | pkg | 회수 | total | paid | due | status |
|---|---|---|---|---|---|---|
| 13:28:34 | f48cb162 | 2 | 59,000 | **59,000** | 0 | cancelled(13:45:33) |
| 13:31:46 | (결제 a72eea54 발생 → f48cb162에 credit) | | | | | |
| 13:45:46 | d762fa39 | 1 | 59,000 | 0 | 59,000 | cancelled(13:46:21) |
| 13:45:59 | efd84b41 | 1 | 59,000 | 0 | 59,000 | cancelled(13:46:07) |
| 13:46:51 | **3f4d3ec6** | 1 | 59,000 | **0** | **59,000** | **active(현재 미수 원천)** |

- 회수1 단건 결제 경로(`CustomerChartPage.tsx` L890-916)는 `payments`에 **package_id FK 없이** `packages.paid_amount`(비정규화 필드)에만 credit 반영.
- 13:31 결제는 당시 활성 패키지 f48cb162에 **정상 credit(paid=59,000, due=0)** → 이후 스태프가 그 패키지를 **취소하고 새 패키지를 재생성**. credit은 취소된 f48cb162에 갇히고(stranded), 신규 활성 3f4d3ec6은 paid=0으로 출발 → **미수 59,000 재출현**.

### planner 3가설 대조
- (a) payments row 미생성 → **아님** (a72eea54 존재).
- (b) customer_id/chart 연결키 누락·오매핑 → **부분 참**. customer_id=F-4716 정확. 그러나 회수1 단건은 payments↔활성패키지 durable FK 부재 → 패키지 취소 시 결제가 활성 패키지를 따라가지 못함.
- (c) 패키지 잔금 상계가 결제를 미수로 되돌림 → **실질 참(변형)**. 상계로직이 아니라 결제 후 패키지 취소·재생성으로 credit stranded.

### 수납내역 탭 "결제 없음" 표시
- CHART2-RECEIPT-RESTRUCTURE 필터(`CustomerChartPage.tsx` L6396): memo가 `영수증 업로드`로 시작하는 payments를 **수납내역 탭에서 의도적 제외** → 상담내역>결제영수증 섹션에 표기(중복방지). 즉 수납내역 탭 공백 자체는 설계상 정상. **진짜 문제는 미수 59,000.**

### 영수증↔결제행 연결
- payment memo `영수증 업로드(회수1·단건)` = 영수증 업로드 경로로 생성 확인. 영수증 이미지↔결제행은 상담내역>결제영수증 경로에 표기.

---

## AC2 — 정상화 판단

- **재결제 불필요.** 고객은 이미 결제(59,000 card, 13:31, 영수증 존재). payment row 정상 잔존 → 재결제 시 이중청구.
- **매출 이중계상 없음.** 매출은 payments row 기준(59,000 1건). paid_amount는 미수 파생 표시값 → 정정해도 매출 불변.
- **안전 수동정정 (Cross-CRM Data-Correction 백필 SOP 준수):**
  - freeze set (id 명시, count 기준 UPDATE 금지):
    - `3f4d3ec6`(F-4716 활성): paid_amount 0 → 59,000 (미수 해소)
    - (권고 추가) `f48cb162`(F-4716 취소): paid_amount 59,000 → 0 (stranded credit 제거)
  - apply 직전 freeze 재검증 abort-guard(status/paid/total drift 시 abort) — 기존 `_part1_apply.mjs`에 구현.
  - 판정근거 스냅샷 = 본 문서. 원장(진료차트) 무접점.
- **현장 확인 게이트**: reporter(강경민/현장)에게 "취소된 패키지를 다시 만드신 것 맞는지 + 활성 패키지로 결제 이관 OK인지" 확인 후에만 실행.

---

## AC3 — 동일 원인 미수 오분류 타건 범위 (READ-ONLY 전수)

전수 조회 결과 **2건, 총 69,000, 전부 2026-07-15 foot**:

| chart | 고객 | 금액 | 실패 모드 | 활성 pkg | 정정 대상 |
|---|---|---|---|---|---|
| F-4716 | 김희정 | 59,000 | 결제 후 패키지 취소·재생성 → credit stranded | 3f4d3ec6 (due 59,000) | paid 0→59,000 |
| F-4666 | 김지민 | 10,000 | 'single' 경로 결제(memo=영수증 수납(단건)) → 패키지 미귀속 | 5ed60da7 무좀체험권 (due 10,000) | paid 0→10,000 (현장 확인 필요) |

- 건강(정상)건: F-4595 김민후(net 10,000, due 0), F-4594 김희수(10,000, due 0) — 회수1 credit 정상 반영, 정정 불요.
- stranded cancelled-credit 패턴은 **F-4716 단 1건**. `paid_amount>0 && status<>active`인 패키지 전 기간 통틀어 F-4716뿐.
- 선행 `_part1_apply.mjs` freeze set {F-4666 10,000, F-4716 59,000}은 오늘 근거와 **일치**.

---

## 재발방지 (별도 fix 티켓 권고 — 본 티켓 범위 밖)
1. 회수1 단건 결제 credit이 `packages.paid_amount`에만 반영되고 payments↔package durable FK 부재 → 패키지 취소·재생성 시 credit stranded. 대책: 패키지 취소 시 연결 결제 존재하면 경고/credit 이관 UX, 또는 회수1도 package_payments FK 경로로 통일.
2. 'single' 경로 결제 시 동일 고객에 매칭되는 활성 회수1 패키지가 있으면 귀속 힌트/경고.
→ 코드경로 결함이므로 별도 fix 티켓에서 db_change/E2E 재판정.

## conflict
- REDPAY-CLOSING-TAB(레드페이 단말 auto-collection 대조)와 **별개 축**. 본 건은 마감→closing_manual_payments 경로가 아니라 회수1 credit stranding + single 경로 미귀속. consistent.
