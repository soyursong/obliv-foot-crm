# T-20260724-foot-PKGSESSION-B1-LEAKY-MAPPING-REVIEW — R1 판정근거 스냅샷 (SOP §2-F 박제)

- **성격**: R1 READ-ONLY per-row 검토 (mutation 0). widen 미착수.
- **부모**: T-20260724-foot-PKGSESSION-BACKFILL-AND-EFFICACY (G-A sub-gate)
- **DA 정본**: consult_reply_foot_pkgsession_backfill_efficacy_20260724.md (G-A 분해쿼리)
- **prod**: rxlomoozakkjesdqjtvd (Management API service-role SQL)
- **evidence 생성기**: `scripts/T-20260724-foot-PKGSESSION-B1-LEAKY-MAPPING-REVIEW_R1_probe.mjs`
- **검토 시각**: 2026-07-24 (KST) / author: dev-foot
- **PHI 위생**: service 메타(코드/명/분류/price)·session_type·count·절단 check_in id(8자)만. 환자 식별정보 제외.

---

## 0. 결론 (한 문장)
**B1_LEAKY 16행의 CASE→NULL 서비스 21종(73라인, 14 check_in) 전건이 상병(진단코드)·처방약·기본진찰료·검사·풋화장품·비선불풋케어 라인 = 애초 패키지 회차(4-type)가 아님. 진성 회차소비(레이저2·포돌로게·수액) 0건 → widen 대상 0건. 39는 설계정상 out-of-scope 잔차로 확정, 정상 종결. CASE 4종 widen 금지(SOP §2-F).**

---

## 1. gap-decomposition 재현 (4-type 한정) — 부모 G-A 정합 확증

| 지표 | 값 | 비고 |
|---|---|---|
| used 4-type(heated/unheated/podologue/iv, status=used·check_in有) | **91** | 라이브 증가(스냅샷 시점 81 → 91) |
| matched (count-exact, rn=rn 페어) | **52** | 스냅샷 시점 42 → 52 (RPC 신규 마킹 라이브 반영) |
| **gap (unmatched)** | **39** | ★부모 G-A와 정합 |
| ├ A2_check_in에CIS없음 | 23 | heated 2 · podologue 5 · unheated 16 (구조적 unmatchable = 설계정상) |
| ├ **B1_LEAKY:CASE→NULL서비스존재** | **16** | heated 3 · podologue 4 · unheated 9 (본 티켓 검토 대상) |
| └ X_기타 | 0 | — |

> ※ doc 원 분해쿼리를 그대로 돌리면 gap 132(버그) — `ps` CTE에 session_type 필터 부재로 trial·reborn 등 backfill 4종 비대상 used 세션 spill. `ps`를 4-type 한정 시 정확히 gap 39 정합(부모 FOLLOWUP MSG-20260724-104812-ksyk 확정).
> ※ **42 count-exact APPLY-set은 본 티켓 무접촉**(부모 완결성 원장 목적, 별건). matched 52는 라이브 관찰치일 뿐 APPLY-set 재정의 아님.

---

## 2. freeze셋 — B1_LEAKY used-session 16건 박제 (검토 시점 고정, 이탈 시 abort)

| # | session_id | check_in(8) | used_session_type |
|---|---|---|---|
| 1 | e7e6cd51-b56f-4333-ac18-9faeba9a91f1 | 1f5a2cad | heated_laser |
| 2 | ab6d1e4d-2e3d-4f4c-9ba1-3483cc1bea61 | 22cdc5d6 | podologue |
| 3 | 797dd98a-2ebe-46f4-b7af-4cd9bd7bffb3 | 2a89a3a7 | unheated_laser |
| 4 | e6c5f19e-3344-4f7b-9970-1f3f80d775d4 | 2d5bc0c3 | podologue |
| 5 | 00cc0858-4483-4902-9003-5fc27cd69659 | 2d5bc0c3 | podologue |
| 6 | 1ee602d7-38fa-447a-ab00-a9b55ba9fb0f | 3ac02464 | heated_laser |
| 7 | f5d6f472-96c9-45be-abdd-b4674e5a002e | 712d6683 | unheated_laser |
| 8 | a6a32eb5-6358-49f4-8e30-32194da48ca1 | 85766c3b | unheated_laser |
| 9 | c43fa24c-9419-476b-b45d-6a394f85b642 | b1ef9979 | unheated_laser |
| 10 | dcc0eca8-158c-4170-a487-cd942acf77fd | b7b9628b | unheated_laser |
| 11 | cd71d2a9-0448-4d09-a365-71db5c67460a | cbb7b507 | unheated_laser |
| 12 | 87cf6912-35f9-4670-b3fd-26e6a3bfc169 | d8c8a41d | heated_laser |
| 13 | 3e53e49f-8f42-4446-9e36-a6b889efbe8e | d8c8a41d | podologue |
| 14 | 81d9ba62-ce7b-46bb-8733-7ea128830997 | e77d1266 | unheated_laser |
| 15 | 6eb57f45-685c-4f6d-a41d-4be02b49d8ac | f5908690 | unheated_laser |
| 16 | 593736e4-7aa3-4057-a752-b3086b166a3b | fcf6cbb4 | unheated_laser |

→ 16 used-session / 14 distinct check_in (2d5bc0c3 podologue×2, d8c8a41d heated+podologue).

---

## 3. per-row 판별 — CASE→NULL 라인이 "진짜 회차소비"인가 "진료/약제/검사 라인"인가

### 3.1 CASE→NULL 서비스 21종 전수 분류 (73라인)

| category_label | n(distinct svc) | 대표 서비스 | 회차소비? |
|---|---|---|---|
| 상병(진단코드) | 6 | 손발톱백선·발백선·상세불명의 위염·내성발톱·체부백선·내향성 손발톱 | ✗ 진단코드(병명), 과금·소비 아님 |
| 처방약 | 5 | 바르토벤외용액·주블리아외용액·터미졸크림·하이트리크림·한미유리아크림 | ✗ 약제 조제·판매, 회차 아님 |
| 기본(진찰료) | 3 | 초진진찰료·재진진찰료·단순처치·"재진-물리치료,주사 등" | ✗ 진찰료/기본처치, 선불패키지 4-type 아님 |
| 검사 | 1 | 일반진균검사-KOH도말-조갑조직 | ✗ 검사, 회차 아님 |
| 풋화장품 | 3 | Care Toe Band(CTB)·풋샴푸·안티 펑거스 포도 포르테 | ✗ 제품 판매, 회차 아님 |
| 풋케어(비선불) | 2 | 원인제거(내성발톱)·패디젤제거 | ✗ 단발 풋케어, 4-type(레이저2·포돌로게·수액) 아님 |

**진성 회차소비(레이저 SZ035-30/35 · 포돌로게 BC1300MB08 · 수액) 후보 = 0종.**

> ⚠ 키워드 스캔 1건 오탐: `AA222 재진-물리치료,주사 등 시술받은 경우`는 **재진진찰료 성격의 기본 코드**(category=기본)이며 실제 주사/수액 회차 소비가 아님 → widen 대상 아님.

### 3.2 check_in별 CASE→NULL 라인 상세 (판정근거)

| check_in(8) | CASE→NULL 라인 (분류·서비스) |
|---|---|
| 1f5a2cad | 검사 KOH도말 / 기본 단순처치·초진진찰료 / 상병 내성발톱·발백선·위염·손발톱백선 / 풋케어 원인제거 |
| 22cdc5d6 | 검사 KOH도말 / 기본 초진진찰료 / 상병 발백선·위염·손발톱백선·체부백선 |
| 2a89a3a7 | 풋화장품 CTB |
| 2d5bc0c3 | 기본 단순처치·재진진찰료·"재진-물리치료,주사 등" |
| 3ac02464 | 기본 단순처치·초진진찰료 / 상병 내성발톱·발백선·위염·손발톱백선 / 처방약 바르토벤 / 풋케어 원인제거 |
| 712d6683 | 처방약 바르토벤·터미졸크림 |
| 85766c3b | 검사 KOH도말 / 처방약 바르토벤·터미졸크림 |
| b1ef9979 | 풋화장품 안티 펑거스 포도 포르테 |
| b7b9628b | 검사 KOH도말 / 처방약 바르토벤·한미유리아크림 |
| cbb7b507 | 풋화장품 CTB |
| d8c8a41d | 검사 KOH도말 / 기본 초진진찰료 / 상병 내향성 손발톱·발백선·위염·손발톱백선 / 처방약 바르토벤·주블리아·하이트리크림 / 풋케어 패디젤제거 / 풋화장품 풋샴푸 |
| e77d1266 | 검사 KOH도말 / 기본 초진진찰료 / 상병 발백선·위염·손발톱백선 / 처방약 바르토벤·하이트리크림 |
| f5908690 | 검사 KOH도말 / 기본 초진진찰료 / 상병 내성발톱·발백선·위염·손발톱백선 / 처방약 바르토벤 |
| fcf6cbb4 | 검사 KOH도말 |

**전 14 check_in 공통**: CASE→NULL 라인 전부가 진단코드/약제/진찰료/검사/화장품/단발풋케어. 어느 것도 레이저·포돌로게·수액 회차의 별도 과금라인이 아님.

### 3.3 구조 해석 (왜 B1_LEAKY로 떨어졌나 = 밑빠진 독 아님)
- B1_LEAKY 트리아지는 "해당 check_in에 session_type=NULL CIS가 **존재**하면"으로 우선 분류(EXISTS 우선순위). 즉 NULL 라인 존재만으로 leaky로 표지되나, **그 NULL 라인이 곧 미매칭 회차소비라는 뜻은 아니다.**
- 이 16 used-session은 해당 check_in 내 매칭 가능한 레이저/포돌로게 CIS 라인이 이미 rn=rn로 42→52 count-exact 매칭에 소진되어 **남은 페어 대상이 없는** used 세션이다(선불 소비 수 > 동일 방문 과금 레이저 라인 수). 남은 미매칭 CIS는 진단/약제/검사 라인뿐 → 이들을 CASE에 편입하면 **역방향 누수**(진단·약제행이 phantom already_paid → 매출 과소)로 SOP §2-F 명시 금지.
- 따라서 39(=A2 23 + B1 16)는 전부 **설계정상 unmatchable 잔차**. count-exact 42(현 라이브 52) 설계의 정상 산물이지 backfill 실패가 아님.

---

## 4. 판정 & 후속

- **widen 대상 = 0건.** R2(CASE widen 설계)·R3(widen backfill 마이그) **미진입.**
- **39는 설계정상 out-of-scope 잔차로 확정** → 본 티켓 정상 종결(SOP §2-F "widen 0건 결론 시 스냅샷 박제 후 close").
- **42 count-exact APPLY-set 불변** — 본 티켓 무접촉 확인.
- **원장(payments/closing_manual) 무접점** — 본 검토 READ-ONLY, write 0.
- **부모 티켓 완료 선언 게이트**: 본 B1 잔차 검토가 '설계정상 확정'으로 닫혔으므로 G-A '완료 금지' 해제 조건 충족(밑빠진 독 아님 확증). 단 부모 backfill APPLY(42 set) 자체는 G-C-1 배포·supervisor DB-GATE 등 별도 게이트 잔존.
- **재검 트리거(freeze셋 이탈)**: 향후 B1_LEAKY≠16 또는 gap≠39로 관찰되거나, CASE→NULL 라인에 레이저/포돌로게/수액 성격 신 서비스가 출현하면 본 스냅샷 무효화 → per-row 재검토 재개(자동 widen 여전히 금지).

---

*R1 READ-ONLY 검토 · mutation 0 · 42 APPLY-set 무접촉 · 원장 무접점 · author: dev-foot 2026-07-24*
