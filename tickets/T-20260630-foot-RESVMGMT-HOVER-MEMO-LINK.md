---
id: T-20260630-foot-RESVMGMT-HOVER-MEMO-LINK
domain: foot
priority: P1
status: deploy-ready
qa_result: pass
deploy_commit: 2bc605be4f
deployed_at: n/a (NOT yet deployed — supervisor QA 대기)
bundle_hash: n/a (NOT yet deployed)
summary: "예약관리 예약카드 hover 팝업 예약메모 미표시 + hover 링크 점검. §2 분기진단: reservation_memo_history 162행+booking_memo 103행 → 메모 DB 실재 = FE display축(ingest 결손 아님). 메모축 RC=hover가 reservations.booking_memo(생성시 초기메모만 담는 부분 미러)만 read → 예약상세 팝업 타임라인(reservation_memo_history SoT) 저장분 미표시 → 형제 commit 32221de1(RESVHOVER-MEMO-NOT-SHOWN, resvMemoMap SoT 배선, main 라이브)이 해소(본 티켓 메모축과 동일 수정). '링크'=hover 팝업 내부 anchor 0(런타임 확인), 현장이 말한 링크=밑줄 성함(트리거) onClick→handleResvOpenChart→openChart, 무손상. AC1~AC4 전부 HEAD 충족(라이브 검증: 메모표시/빈메모'-'/성함링크→차트open/pageerror0). 본 티켓 = 회귀가드 spec 추가(FE검증 only, 앱코드 무변경). spec 6/6 PASS, build 5.25s OK."
created: 2026-06-30
assignee: dev-foot
---

# T-20260630-foot-RESVMGMT-HOVER-MEMO-LINK — 예약관리 hover 예약메모 표시 + 링크 점검

## 현장
박민지 팀장(U05L44C5P50, 풋센터 C0ATE5P6JTH): 예약관리 예약카드 hover 팝업에
(1) 예약메모가 안 보임, (2) hover 팝업 내 '링크' 동작 점검·수정.

## §2 분기 진단 (착수 전 필수 — 완료)
DB 조회 결과(service_role, read-only):
- `reservation_memo_history`(reservation-scope) **162행**, `reservations.booking_memo` 비공백 **103행**.
- → 메모는 DB에 **실재**(ingest 결손 아님) → **FE display 축 = 본 티켓 범위**.
- → ingest(도파민→풋) 소관(T-20260630-dopamine-FOOTRESV-MEMO-SYNC / -PUSH-DROP) **아님**.

## 근본원인
- **메모 미표시 RC**: hover(`CustomerHoverCard`)가 `reservations.booking_memo`(예약 생성 시점에만
  '초기메모'가 한 번 들어가는 부분 미러 컬럼)만 읽음. 예약상세 팝업의 `ReservationMemoTimeline`으로
  추가/수정한 메모는 SoT(`reservation_memo_history`)에만 쌓이고 컬럼을 갱신하지 않음 → hover 미표시.
  → 형제 티켓 **T-20260630-foot-RESVHOVER-MEMO-NOT-SHOWN**(commit `32221de1`, main 라이브)이
  `resvMemoMap`(reservation_memo_history 단일 배치 조회, SoT 우선 + 레거시 컬럼 fallback) 배선으로 해소.
  본 티켓의 메모축과 **동일 수정**.
- **'링크'**: hover 팝업(포털 카드) 내부엔 anchor/href/clickable **0**(런타임 확인).
  현장이 말한 '링크' = 밑줄 성함(트리거 span) `onClick → handleResvOpenChart → openChart(고객차트)`.
  **깨진 적 없음**(런타임 클릭 → 고객차트 패널 open 확인).

## 라이브 검증 (desktop-chrome, 실백엔드 인증)
- AC1 ✓ 예약메모 표시: 메모 있는 카드 내용 노출('SDEERERE'/'내원 후 접수까지…'/'도수센터 총괄님'/'내원시 연락처…').
- AC2 ✓ 빈메모 가드: 이력 없는 카드 `-` 렌더(공백행/undefined crash 없음).
- AC3 ✓ 링크: 밑줄 성함 클릭 → 고객차트 sheet open.
- AC4 ✓ 회귀: pageerror 0, 기존 예약상세 팝업·목록 무손상.

## 작업
- FE 검증 only — **앱 코드 무변경**(메모축 기능은 형제 commit `32221de1`로 이미 main 라이브, 링크 무손상).
- 회귀가드 E2E spec 추가: `tests/e2e/T-20260630-foot-RESVMGMT-HOVER-MEMO-LINK.spec.ts`
  - S1(source-integrity): resvMemoMap SoT 배선 + bookingMemo 렌더/빈메모 가드 + 성함 onClick 링크 배선.
  - S2(live): hover → 예약메모 줄 안전 렌더(내용/빈메모 '-') + pageerror 0.
  - S3(live): 밑줄 성함 클릭 → 고객차트 패널 open.

## 검증
- spec: `npx playwright test ...RESVMGMT-HOVER-MEMO-LINK` → **6 passed**(S1×3 + S2 + S3 + setup).
- build: `npm run build` → ✓ 5.25s.

## 비고
- **FE-only · NO-DDL · 발송 0** → 데이터 정책 자문 게이트 비대상.
- 진료대시보드/진료관리 의료 컨펌 게이트(§11) **비대상** — 예약관리(비의료) 화면.
- 메모축이 형제 commit 32221de1과 중첩 → supervisor QA 시 중복 배포 불요(코드 무변경, spec만 추가).
