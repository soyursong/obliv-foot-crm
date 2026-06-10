---
id: T-20260610-foot-RESV-CTXMENU-POPUP-SYNC
domain: foot
priority: P1
status: blocked
deploy_ready: false
db_changed: false
db_migration: none
hotfix: false
created: 2026-06-10
reporter: 김주연 총괄
reporter_msg: MSG-20260610-134407-1m2u
source_msg: MSG-20260610-140109-ia8m
author: agent-fdd-dev-foot
e2e_spec: tests/e2e/T-20260610-foot-RESV-CTXMENU-POPUP-SYNC.spec.ts
data_arch_consult: "비해당 — 신규 컬럼/테이블/enum 없음(§S2.4 CONSULT gate 미적용)"
partial_commit: AC-1(완전삭제 parity) + AC-2(코드검증) 구현·검증 완료. AC-3/6/7 은 스펙 전제 붕괴로 planner FOLLOWUP 에스컬레이션.
blocked_reason: "AC-3/AC-6/AC-7 의 대상 '예약상세 팝업'이 현재 foot 코드에 존재하지 않음(스크린샷=cross-CRM 디자인 참조) + POPUP-SYNC vs OVERHAUL-7 AC-6 버튼 직접 충돌. planner 확인 필요."
blocked_followup: MSG (mq_emit → planner, type=FOLLOWUP)
---

# T-20260610-foot-RESV-CTXMENU-POPUP-SYNC — 예약 우클릭 메뉴 동기화 + 취소/삭제/복원 정리

## 진행 요약 (dev-foot, 2026-06-10)

### ✅ 구현 완료 — AC-1 (완전삭제 parity)
대시보드 타임라인 우클릭(`ReservationContextMenu`)에만 있던 **[완전 삭제](hard delete, 이력 미보존)** 를
**예약관리 우클릭 메뉴(`CustomerQuickMenu`)에도 동일 동작으로 추가** (parity).
- `src/components/CustomerQuickMenu.tsx`: `onDeleteReservation` 옵션 prop + [완전 삭제] 항목
  (`quick-menu-harddelete-btn`, Trash2, text-red-600). `onDeleteReservation` 제공 + `reservation_id`
  있을 때만 노출 → Dashboard **체크인 카드** 메뉴(미전달)에는 미노출, 회귀 없음. window.confirm
  ("예약을 완전 삭제하시겠습니까? 이력이 남지 않습니다.") 게이트는 대시보드와 동일 문구.
- `src/pages/Reservations.tsx`: `handleResvHardDelete` — 체크인 연결 가드(orphan 방지,
  `ReservationDetailPopup.deleteReservation` 패턴 재사용) + `reservations.delete()` + 낙관적 `setRows` 제거.
  `CustomerQuickMenu`에 `onDeleteReservation` 배선.
- 빌드 EXIT 0 (3.80s). e2e `--list` 통과(3 tests).

### ✅ 검증 완료 — AC-2 (삭제 vs 취소 정책 정합, 무변경)
- 예약 삭제 = `reservations` **hard-delete** (`.delete()`) — 코드 확인 결과 정책 일치, 무변경.
  - `ReservationContextMenu`(대시보드) → `handleDashDeleteConfirm`: `.delete()` ✓
  - `ReservationDetailPopup.deleteReservation` (L216): `.delete()` ✓
  - 신규 `handleResvHardDelete`(예약관리): `.delete()` ✓ — 세 경로 모두 동일 hard-delete.
- 예약 취소 = `cancelled` 상태 업데이트(`status/cancelled_at/cancel_reason`, 이력 보존) ✓ 명확 분리.

### ⛔ 블로커 — AC-3 / AC-6 / AC-7 (스펙 전제 붕괴 → planner FOLLOWUP)
코드 1차 확인 결과 본 티켓 스펙(특히 첨부 스크린샷)이 **현재 foot 코드와 불일치**:

1. **스크린샷 ≠ 현재 상태.** 첨부 `image.png`/`image(1).png`의 예약상세 팝업은 **단일 컬럼** 레이아웃 +
   `예약 구분: 신규/리터치/시술예약/기타` + `TM 상담사(예약 등록자)` + `[체크인][저장]/[예약취소][예약삭제]`.
   - foot 예약구분(visit_type) = **신규/재진/체험**(new/returning/experience) — 스크린샷의 신규/**리터치/시술예약/기타**와 불일치.
   - 해당 문자열(예약 구분/리터치/시술예약/TM 상담사(예약 등록자)) **foot 코드 전체에 0건** → 스크린샷은 **타 CRM(derm/body) 디자인 참조**로 추정.
2. **현존 `ReservationDetailPopup`은 4분할(1100px) 레이아웃이며 dead 컴포넌트.**
   - `setDetail()`이 코드 전체에서 non-null 인자로 **한 번도 호출되지 않음** → 팝업이 **열리지 않음**.
   - 즉 POPUP-SYNC AC-6 "현재 화면에 이미 반영돼 있는 것으로 보임"은 **사실과 다름**.
3. **AC-6 버튼 구성 — POPUP-SYNC vs 부모 OVERHAUL-7 직접 충돌:**
   - POPUP-SYNC(13:55): 정상=`[체크인][저장]/[예약취소][예약삭제]`(4) · 취소=`[예약복원][저장]`(2)
   - OVERHAUL-7(14:00 human 확정, reply_ts 1781067228): 정상=`[저장][예약취소][예약삭제]`(3, 체크인 제외) · 취소=`[예약복원][저장][예약삭제]`(3, 예약삭제 추가)
   - 두 스펙이 모순 → 어느 쪽이 최종인지 확정 필요.
4. **AC-3 `[예약상세]` 클릭 대상 팝업 미정.** dead `ReservationDetailPopup`(4분할) 활성화인지,
   스크린샷대로 신규 단일컬럼 팝업 신축인지, `ReservationEditor`(예약수정 모달) 리디자인인지 불명.
   (스크린샷의 예약등록자 드롭다운은 자매 티켓 **REGISTRAR-ROUTE-FIELDS**(DB)와 직접 겹침.)

### 추가 관찰 (AC-7 잠재 버그)
- dead `ReservationDetailPopup`의 복원 로직 `setStatus('confirmed')`(L252)은 `status`만 갱신 →
  `cancelled_at`/`cancel_reason`을 **초기화하지 않음**. AC-7(필드 초기화)와 불일치. 팝업 확정 시 동반 수정 필요.

## 다음 단계
planner 가 (a) 예약상세 팝업 = 신규 단일컬럼 신축 vs dead 4분할 활성화 vs ReservationEditor 리디자인 중 택1,
(b) AC-6 버튼 최종본(POPUP-SYNC vs OVERHAUL-7) 확정, (c) foot 예약구분(신규/재진/체험) 기준 적용 여부를
회신하면 AC-3/6/7 즉시 후속 구현. AC-1(완전삭제 parity)은 본 커밋으로 선출하 → supervisor QA 가능.
