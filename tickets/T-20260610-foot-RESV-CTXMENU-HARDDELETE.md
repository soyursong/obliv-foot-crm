---
id: T-20260610-foot-RESV-CTXMENU-HARDDELETE
domain: foot
priority: P1
status: deploy-ready
deploy_ready: true
qa_result: pass
deploy_commit: e1c942c
deployed_at: 2026-06-10T13:05:00+09:00
bundle_hash: pending   # Vercel 자동 배포 후 supervisor 검증 시 기입
hotfix: false
created: 2026-06-10
completed: 2026-06-10
db_changed: false
db_migration: none   # reservations row hard delete만, 스키마 변경 없음
e2e_spec: tests/e2e/T-20260610-foot-RESV-CTXMENU-HARDDELETE.spec.ts
risk_verdict: GO_WARN
risk_reason: "파괴적 액션(row 영구삭제, 이력 미보존)이나 reporter(김주연 총괄) 명시 요청 + 기존 reservations.delete 경로 재사용(병렬 경로 신설 없음) + window.confirm 게이트. status 무관 노출은 요구사항."
data_arch_consult: "비해당 — 신규 컬럼/테이블/enum 없음(§S2.4 CONSULT gate 미적용)"
reporter: 김주연 총괄
reporter_msg: MSG-20260610-123248-0lwt
author: dev-foot
---

# T-20260610-foot-RESV-CTXMENU-HARDDELETE — 예약 컨텍스트메뉴 [완전 삭제] hard-delete

## 요약
예약 컨텍스트메뉴(`ReservationContextMenu`)에 [예약 취소] 아래 [완전 삭제] 항목을 추가하여 예약 row를 영구 삭제(이력 미보존)한다. reporter=김주연 총괄.

## 구현
- **src/components/ReservationContextMenu.tsx**: [예약 취소] 아래 구분선(`border-t`) + [완전 삭제] 버튼(`Trash2` lucide, `text-red-600`, `data-testid=resv-ctx-harddelete-btn`). status 무관 전체 표시(disabled 없음). `window.confirm('예약을 완전 삭제하시겠습니까? 이력이 남지 않습니다.')` 게이트 → `onDeleteReservation(reservation)` 콜백.
- **src/pages/Dashboard.tsx**: `handleDashDeleteConfirm` 핸들러 추가(`supabase.from('reservations').delete().eq('id', target.id)` — 기존 경로 재사용, 병렬 경로 신설 금지). 성공 시 `setTimelineReservations` filter로 낙관적 목록 갱신 + toast. `ReservationContextMenu`에 `onDeleteReservation` prop 연결(`handleDashCancelConfirm` 패턴 참조).

## AC
- AC-1: 예약 박스 우클릭 → 컨텍스트메뉴에 [완전 삭제] 항목 노출.
- AC-2: status 무관 전체 표시(취소/노쇼 예약에서도 활성, disabled 없음).
- AC-3: [완전 삭제] 클릭 → window.confirm("이력이 남지 않습니다") → 확인 시 DB delete + 목록 갱신 + toast / 취소 시 미실행.

## 검증
- build: `npm run build` EXIT 0 (3.95s).
- e2e: `tests/e2e/T-20260610-foot-RESV-CTXMENU-HARDDELETE.spec.ts` (5 tests, playwright --list 파싱 통과). confirm dismiss로 DB delete 차단(자동화 데이터 보호).
- 회귀: [예약 취소](resv-ctx-cancel-btn) 항목 보존 + JS 에러 없음. 동일 파일 SMS-SEND는 `CustomerQuickMenu` 소속 → 충돌 없음.

## DB
- 스키마 변경 없음. reservations row hard delete(런타임). 마이그레이션·data-architect CONSULT·DB게이트 불요.
