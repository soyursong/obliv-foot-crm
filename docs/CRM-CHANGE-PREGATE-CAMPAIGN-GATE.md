# CRM 영향 작업 총괄 선승인 게이트 (보안 강화 캠페인 기간)

> **Ticket**: T-20260713-foot-CRM-CHANGE-PREGATE-DIRECTIVE (P0)
> **Source**: 김주연 총괄 지시 (U0ATDB587PV, 채널 C0ATE5P6JTH, ts 1783904001.992269, 2026-07-13)
> **Status**: ACTIVE — 최종 점검·보안 강화 캠페인 기간 한정
> **성격**: 거버넌스 게이트 (코드/스키마 변경 없음, ADDITIVE)

## 원 지시

> "최종 점검 및 보안 강화 작업 중 CRM 상에 영향 가는 거 있음 무조건 선보고 후에 승인 받고 진행해"

최종 점검·보안 강화 캠페인(SECDEF-ANON, RLS 바인딩 하드닝, RRN, doAI 읽기전용 API,
미승인 변경 롤백 등) 기간 동안, CRM에 영향을 주는 모든 작업은 총괄 선보고→승인 후 진행.

## 게이트 대상 = "CRM 영향 작업"

- DB 스키마 변경 (컬럼/테이블/enum/제약 추가·변경·삭제, 마이그레이션)
- RLS 정책 신설·변경·삭제
- 권한/role 설정 변경
- 마스킹/PHI 노출 경로 변경
- prod 데이터 대량 변경·백필

> **비대상**: 순수 FE-only·read-only, 스키마/RLS/권한/PHI/백필 무접점 작업 → 평소대로 진행.

## 순서 (필수)

```
선보고 (dev → planner)
  → planner가 responder 경유 총괄(김주연 U0ATDB587PV)에 승인 요청
  → 총괄 승인 수신
  → dev 착수
```

## 기존 게이트와의 관계 — ADDITIVE (대체 아님)

이 게이트는 기존 게이트를 **대체하지 않고 그 위에 1층 추가**한다.

```
기존:  data-architect CONSULT (스키마 1차)
        → supervisor DDL-diff
        → (파괴/충돌 시) 대표 게이트
신규:  ↑ 위 흐름의 착수 前에  ── 총괄 김주연 선보고·승인  ── 을 추가
```

- ADDITIVE 스키마(신규 컬럼·enum, 회귀0 + 롤백SQL)라도 **이 캠페인 기간에는 총괄 선보고 대상**.
- 게이트 축소 규정(autonomy §3.1)은 **대표 게이트에만** 적용 — 총괄 캠페인 게이트는 별도, 축소 안 됨.

## dev-foot 자기점검 (AC-2 self-report, 2026-07-13 10:25, MSG-tdoo)

미승인 CRM 영향 = **2건 HOLD + 1건 flag**. 3건 모두 무단 진행 없음 (AC-2 준수).

| # | 티켓 | 성격 | 조치 |
|---|------|------|------|
| ① | T-20260701-foot-MIGRATION-LEDGER-DRIFT-SWEEP | 마이그 원장 드리프트 12 casualty ADDITIVE (DA 전건 GO, kiosk-safe). supervisor DDL-diff prod apply만 잔여 | in_progress → **blocked** (apply=CRM영향 착수로 HOLD) |
| ② | T-20260630-foot-STAFF-AUTH-LINK-BACKFILL | staff↔user_profiles targeted 2건 UPDATE (DA 부분-GO, 현장 신원확인 완료) | deploy-ready → **blocked** (prod backfill apply HOLD) |
| ③ | T-20260619-foot-ROLE-MATRIX-3TIER-RBAC | has_ops_authority 권한변경축 (db_change:investigate) | 정지중(DA 재확인/DDL_DIFF_HOLD) — flag only, 재활성 시 게이트 발동 |

> 참고: T-20260713-foot-UNAUTH-CHANGE-INVESTIGATE-ROLLBACK 은 총괄 직접 관여 P0(승인 기수령, 별건).
> 단 SECDEF PHI 함수 배포는 실행 前 총괄 재확인 (WS-A DA CONSULT 중).

## 총괄 승인 로그

- **승인 #1 (2026-07-13 11:31, MSG-20260713-113125-ecuv, 승인ts 1783909809.196739)** — HOLD 2건 착수 승인:
  - ① MIGRATION-LEDGER-DRIFT-SWEEP → blocked→**in_progress** (HOLD 해제, supervisor DDL-diff apply lane 재개)
  - ② STAFF-AUTH-LINK-BACKFILL → blocked→**deploy-ready** 복귀 (supervisor 배포 lane)
  - flag ③ ROLE-MATRIX-3TIER-RBAC 은 정지중 = 이번 승인 대상 아님 (재활성 시 게이트 재발동)

## dev-foot 운영 규약 (내재화)

캠페인 기간 동안 dev-foot는:

1. 신규/재개 작업이 위 **"CRM 영향 작업" 정의에 해당하면** → 착수 전 **planner 선보고** (FOLLOWUP), 총괄 승인 수신 후 착수.
2. FE-only·read-only 무접점 작업은 게이트 대상 아님 → 평소대로 진행.
3. 기존 게이트(DA CONSULT → supervisor DDL-diff)는 그대로 선행. 총괄 게이트는 그 **위에** 얹힌다.
4. 캠페인 종료 신호 수신 시 본 게이트 해제 (이 문서 status를 CLOSED로 갱신).
