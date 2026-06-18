---
ticket_id: T-20260619-foot-RESVDETAIL-POPUP-REFIX
id: T-20260619-foot-RESVDETAIL-POPUP-REFIX
status: rc-pending
priority: P2
domain: foot
created_at: 2026-06-19
owner: agent-fdd-dev-foot
requester: 김주연 총괄 (풋센터 C0ATE5P6JTH) — 예약 팝업 4번째 라운드 재보고
approved_by: planner NEW-TASK MSG-20260619-003642-dr49
build_ok: true
spec_added: 없음 (코드 무변경 — 기존 4FIX spec 유효)
db_changed: false
data_architect_consult: 불요 — read-only 표시 영역, 신규 컬럼·테이블·enum 0
risk_level: REDEFINITION_RISK (예약 팝업 4번째 라운드, planner 명시 — 신규 컴포넌트 금지·회귀/누락분만)
gate: rc_first (갤탭 실기기 현장 confirm 필요 — green build 종결 금지)
deploy_ready: false
co_edit_coordination: RESVMGMT-COMPACT-POPUPFLOW(in_progress) 同 팝업 — 본 라운드 코드 무변경이라 충돌 0
phi_rrn_finding: 본 팝업 평문 RRN 미수신·미렌더 확인. 담당자=assigned_staff_id(UUID FK). 마스킹 주민번호=fn_customer_birthdates 서버파생 birth_date_display만. 신규 복호경로 0 (STAFF-CHART2-RRN-NOSAVE 정책 불변)
---

# T-20260619-foot-RESVDETAIL-POPUP-REFIX — 예약상세 팝업 재검증 4건 (4라운드)

## 요청 (NEW-TASK, planner P2 — MSG-20260619-003642-dr49)

김주연 총괄 6/19 재보고. 예약 팝업 4번째 라운드 → REDEFINITION_RISK.
신규 컴포넌트 생성 금지·기존 ReservationDetailPopup 회귀/누락분만.

- AC1 담당자 "암호화 노출" → display_name 미표시 회귀
- AC2 패키지 사용이력 10회+ 레이아웃 깨짐 → 한 줄(인라인/요약) 렌더 (신규)
- AC3 치료이력 섹션 중복 제거 (표시 숨김, 데이터 삭제 아님)
- AC4 예약이력 박스 칸 밖 이탈 → overflow/width 복구

★ item4(일자별 시간선택)는 본 티켓 영역 아님 = TIMESLOT-PICKER AC2 소유. 미접촉.

## AC-0 코드 직독 진단 (추정금지, 런타임 RC 선행 — gate=rc_first)

직전 라운드 **T-20260619-foot-RESVPOPUP-DETAIL-REVERIFY-4FIX (commit 7f176012, 6/19 01:04)**
가 AC1~AC4 4건 전부 구현 → **main 머지·배포 확인** (HEAD에서 7커밋 뒤, revert 없음, build green 4.54s).

| AC | 4FIX 구현 위치 | 현 HEAD 상태 |
|----|----------------|--------------|
| AC1 담당자 UUID | `select.tsx:71` SelectValue render-function child 확장 + `ReservationDetailPopup.tsx:1176` value→이름 직접해석 (allStaff→assignedStaffName→'이전 담당자') | **존재·정상** — base-ui v1.4.0 SelectValue.js가 `childrenProp(value)` 무조건 호출 확인 → 아이템 등록 타이밍 무관 UUID 비노출 |
| AC2 사용이력 깨짐 | `PackageTicketReadonlyList.tsx:148` max-h-40 overflow-y-auto + 각 항목 1행(nowrap·min-w-0·truncate) | **존재** — 다만 "한 줄(인라인/요약)(신규)"는 prior 라운드의 per-item-1행과 해석 갈림 (요약 collapse vs bounded list) |
| AC3 치료이력 중복 | `ReservationDetailPopup.tsx:1211` 독립 치료내역 섹션 제거 (패키지 시술내역으로 흡수) | **존재·정상** — 섹션 hide, treatments fetch는 재진판정(hasPriorVisit)에서만 잔존 |
| AC4 예약이력 이탈 | `ReservationDetailPopup.tsx:1461` flex-shrink-0 + 리스트 max-h-56 + 항목 min-w-0/truncate, 배지 shrink-0 | **존재·정상** — zone2 자체 overflow-y-auto가 총량 흡수 |

### PHI/RRN 판정 (planner 경고 응답)
- 담당자 값 = `customers.assigned_staff_id` = **UUID FK**, RRN 아님. "암호화" gibberish는 (있다면) UUID.
- 팝업 평문 rrn 미수신·미렌더. 마스킹 주민번호(L1113)는 `fn_customer_birthdates` 서버파생 birth_date_display만 사용.
- **신규 복호경로 0** → STAFF-CHART2-RRN-NOSAVE 정책 불변. RRN 누출 가능성 코드상 없음.

## 판정: 4건 모두 deployed 4FIX에 구현·배포됨 → 재보고는 stale-build 의심 (선례 일치)

선례: SEARCH-NEWMODE-3FIX("field-soak 스샷=deployed 이전 빌드 → 중복신고"),
RESVMGMT-REFIX-8 AC9/10/11("이미 구현·배포 완료 → consolidate").

**추정 패치 금지(gate=rc_first) → 정상 코드 churn 금지(REDEFINITION_RISK).**
→ 현 배포 번들 기준 재현 여부를 갤탭 실기기 스크린샷으로 확정해야 RC 분기 가능.

## 회신 (planner FOLLOWUP)
- db_change=**false** → **db-gate 불요**.
- AC2 "한 줄(요약)(신규)" 형태 1문항 clarify.
- 현 배포 번들 갤탭 재현 스크린샷 responder 경유 요청.
- 코드/DB 변경 0건 (이번 라운드).
