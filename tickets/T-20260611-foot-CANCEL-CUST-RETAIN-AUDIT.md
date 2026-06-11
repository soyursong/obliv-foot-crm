---
id: T-20260611-foot-CANCEL-CUST-RETAIN-AUDIT
domain: foot
priority: P2
status: verified-no-change
deploy_ready: false
hotfix: false
created: 2026-06-11
completed: 2026-06-11
deadline: 2026-06-14
db_changed: false
db_migration: none
db_gate: N/A
audit_only: true
code_mutation: false
verdict: VERIFIED-NO-CHANGE
data_arch_consult: "비해당 — audit-only, 코드/스키마 mutation 0건 (§S2.4 CONSULT gate 미적용)"
author: dev-foot
reporter: 김주연 총괄
---

# T-20260611-foot-CANCEL-CUST-RETAIN-AUDIT — 취소 고객/예약 보존 가드레일 감사 (audit-first)

## 요청 (김주연 총괄)
> "취소 고객도 언제든 다시 내원 가능 / 완전 삭제 아닌 이상 등록된 모든 고객 내용 보존."

기 확립 정책(RESV-CANCEL-CUSTKEEP done, CHECKIN-DUP-NULL-DATAFIX `89e8555`)의 customer-level 재확인.
**diff-first / 코드 mutation 없는 audit 먼저** → 갭 발견 시에만 soft 패턴 교정.

## 결론 (TL;DR)
**갭 없음 → zero-change (verified-no-change) 종결.**
- 모든 "취소"는 논리취소(`status='cancelled'`, row 보존, 역연산 가능).
- 물리삭제(hard delete)는 4곳 모두 명시적 "완전 삭제" 동선 + 하위이력 연결 시 차단 가드 + `window.confirm`.
- 취소 고객/예약은 검색·조회·재예약(재내원) 모두 가능. 은닉 경로 없음.
- churn 금지(§8) 준수 — 코드 mutation 0건. 1건 정보성 관찰(비-갭)만 planner에 이관.

---

## AC-1 — 취소/삭제 진입점 전수 표 (논리취소 vs 물리삭제)

| # | 진입점 | 파일:라인 | 메커니즘 | 판정 | row보존 | 역연산 |
|---|--------|-----------|----------|------|:------:|:------:|
| 1 | 예약 취소 (예약상세 팝업 [예약취소]) | `ReservationDetailPopup.tsx:213` cancelWithReason | UPDATE status='cancelled' +cancel_reason +audit log | **논리취소** | ✓ | ✓ |
| 2 | 예약 완전삭제 (예약상세 팝업 [예약삭제]) | `ReservationDetailPopup.tsx:241` deleteReservation | DELETE + check_in 연결 가드 + confirm("되돌릴 수 없습니다") | **물리삭제(명시적)** | 차단 | — |
| 3 | 예약 복원/노쇼 (예약상세 setStatus) | `ReservationDetailPopup.tsx:261` | UPDATE status 전이(복원 시 슬롯 마감검사) | 상태전이 | ✓ | ✓ |
| 4 | 예약 취소 (예약관리 편집모달 [예약취소]) | `Reservations.tsx:864` handleResvCancelConfirm | UPDATE status='cancelled' +audit +도파민 cancel sync | **논리취소** | ✓ | ✓ |
| 5 | 예약 완전삭제 (예약관리 편집모달 [예약삭제]) | `Reservations.tsx:935` handleEditorDelete | DELETE + check_in 연결 가드 + confirm("되돌릴 수 없습니다") | **물리삭제(명시적)** | 차단 | — |
| 6 | 예약 복원 (예약관리 편집모달 [복원]) | `Reservations.tsx:955` handleEditorRestore | UPDATE confirmed, cancelled_* 초기화 +audit | 상태전이(역연산) | ✓ | ✓ |
| 7 | 고객 삭제 (고객관리 Trash2, **admin만**) | `Customers.tsx:241` deleteCustomer | DELETE + check_in·packages **0건 가드** + confirm | **물리삭제(명시적·강가드)** | 이력 있으면 차단 | — |
| 8 | 체크인 삭제 (간편차트 시트) | `CheckInDetailSheet.tsx:892` deleteCheckIn | DELETE + payments **0건 가드** + confirm | **물리삭제(명시적)** | 결제 있으면 차단 | — |
| 9 | 구매 패키지 삭제 (고객차트) | `CustomerChartPage.tsx:2971` | UPDATE status='cancelled' (soft, 주석 "물리삭제 금지 AC-5") | **논리취소** | ✓ | ✓ |
| 10 | 셀프접수 (in-clinic 키오스크) | `SelfCheckIn.tsx:1262/1449` | INSERT/merge 전용 — **거절·삭제 경로 없음** | 가산전용 | ✓ | n/a |
| 11 | 동일자 중복 가드 (대시보드·셀프) | `Dashboard.tsx:2477` / `SelfCheckIn.tsx:1292` | 차단(에러 반환), DELETE 없음 | 차단전용 | ✓ | n/a |
| 12 | CustomerQuickMenu [예약취소]/[완전삭제] prop | `CustomerQuickMenu.tsx:152/172` | **DEAD** — Dashboard가 onCancel/onDelete 미전달(CTXMENU-UNIFY-CANONICAL로 메뉴 항목 제거) | 비활성(미배선) | — | — |
| — | (참고) 패키지 세션 삭제·시술메모 삭제 | `CustomerChartPage.tsx:2917/3412` | DELETE — **하위 detail-record 편집**(고객/예약 취소 아님) | AC 범위 외 | — | — |

### OUT-OF-REPO 명시
- **키오스크 "셀프접수 거절"**: 본 레포(`obliv-foot-crm`) `SelfCheckIn`은 in-clinic 가산전용으로 **거절→삭제 경로가 존재하지 않음**. 별도 단말(`foot-checkin` 키오스크)에 거절 동선이 있다면 **out-of-repo → 별도티켓 후보**(본 감사 범위 밖).

---

## AC-2 — 취소 고객/예약 재내원(재예약) 가능 여부
**가능 — 은닉 갭 없음.**
- **취소 예약 보존·노출**: `status='cancelled'` row 보존. 예약관리/대시보드 타임라인에서 line-through로 노출(`Reservations.tsx:1310`). 고객차트 "향후 예약" 필터만 cancelled 제외(`CustomerChartPage.tsx:3639,6556`) — 이는 활성예약만 보여주는 올바른 동작(취소건 숨김 아님).
- **재예약 허용**: 대시보드 당일중복 가드가 `status NOT IN ('cancelled')`로 조회(`Dashboard.tsx:2481-2482`, 주석 "취소 후 재예약 정상 동선 유지") → 취소 후 동일고객·동일일 **재예약 허용**.
- **재접수 허용**: `unique_reservation_checkin` 부분 인덱스가 cancelled 제외 → 취소 후 재접수 가능(`SelfCheckIn.tsx:1470-1471`).
- **고객 보존**: 예약취소는 `reservations`만 변경 → 고객(`customers`) row 무손상, 검색 항상 가능.

## AC-3 — hard delete는 명시적 "완전 삭제" 동선에서만?
**준수.** 물리삭제 4곳(#2 #5 #7 #8) 전부:
1. 명시적 삭제 버튼/Trash2 아이콘 (취소 버튼과 분리),
2. `window.confirm` 게이트 ("되돌릴 수 없습니다" / "완전히 사라지며 복구할 수 없습니다"),
3. 하위 이력 연결 시 차단 가드(check_in / payments / packages 존재 시 거부).
- HARDDELETE `e1c942c` / deleteReservation 기존 경로 = 그대로. **어떤 "취소"도 row purge 안 함** — 전부 `status='cancelled'`.

## AC-4 — 갭 판정
| 점검 | 결과 |
|------|------|
| 취소가 물리삭제하는 경로 | **없음** |
| 취소 고객 재내원 은닉(목록·검색 소멸) | **없음** |
| 취소 후 재예약 차단 | **없음** (정상 허용) |

→ **갭 0건. soft 패턴 교정 불필요. zero-change 종결 (verified-no-change). churn 금지(§8) 준수.**

---

## 정보성 관찰 (비-갭, planner 이관 — 본 티켓 mutation 안 함)
- **#12 CustomerQuickMenu dead prop**: `onDeleteReservation`(hard delete) / `onCancelReservation` prop이 컴포넌트엔 잔존하나 Dashboard 2개 인스턴스 모두 미전달(CTXMENU-UNIFY-CANONICAL `fbb843b`로 메뉴 항목 제거). 현재 **사용자 노출 0, 위험 0**. 단 향후 누가 재배선하면 우클릭 1-click hard-delete가 부활할 수 있음.
  - churn 금지 원칙상 본 P2 audit에서 dead code 제거는 **하지 않음**. cleanup 필요 여부는 planner 판단(별도 P3 후보).

## 보존 제약 (준수 확인)
- **RRN 재추가 금지** (T-20260606 보존) — 본 감사 코드 변경 0건이므로 자동 준수.
- 신규 컬럼/테이블/enum 0건 → §S2.4 data-architect CONSULT gate 미적용.

---
*audit by dev-foot · 2026-06-11 · code mutation 0 · DB change 0*
