---
id: T-20260613-foot-RXLIST-FUNGAL-LABEL-SAVEBUG
title: "[라벨+버그] 진료환자목록 처방탭 라벨 + 균검사지 발톱→조갑 + 저장버그 RCA"
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: null
commit_sha: ac99392
created: 2026-06-13
assignee: dev-foot
reporter: 김주연 총괄
source_msg: MSG-20260613-111940-t0x3
---

## 요청 (NEW-TASK MSG-20260613-111940-t0x3, planner P1) — 풋센터 현장 3건 묶음

- **AC-1 [P2]** DoctorPatientList 필터탭 라벨 `처방나감` → `처방환자 목록` (표시 라벨만, confirmed 필터/카운트 로직 불변).
- **AC-2 [P1]** 균검사지 화면 사용자 노출 `발톱` → `조갑` (라벨/문구/토스트 한정). 변수명·DB컬럼(koh_nail_sites)·RPC명 불변.
- **AC-3 [P1]** 균검사지 저장 버그("저장안됨") RCA 우선.

## 작업 결과 (dev-foot)

### AC-1 — 완료 (DoctorPatientList.tsx)
- L985 `처방나감 (${confirmedCount})` → `처방환자 목록 (${confirmedCount})`.
- 필터 key=`confirmed`, confirmedCount 계산식 불변. 정렬/필터 회귀 0.
- 범위 제외: pending('임시', L983) 라벨 불변(현장 미확정) — 건드리지 않음.

### AC-2 — 완료 (KohReportTab.tsx, 사용자 노출 3건만)
- 헤더 `<th>발톱부위</th>` → `<th>조갑부위</th>` (L512).
- 저장실패 토스트 `발톱부위 저장 실패` → `조갑부위 저장 실패` (L282).
- 안내문 `발톱부위는 …` → `조갑부위는 …` (L579).
- 주석/변수명/타입(NailSite)/DB컬럼(koh_nail_sites)/RPC명(set_koh_nail_sites) **불변**.

### AC-3 — RCA 완료, 코드 fix 아님 → DB 마이그 적용 필요(planner 통지)
- **직접원인 = PHASE15 마이그(20260612160000_koh_nail_sites.sql) 프로덕션 미적용.**
  - T-20260612-foot-KOH-REPORT-PHASE15 status = `db-gate-pending` (supervisor Gate3 대기).
  - **prod 실측(2026-06-13, rxlomoozakkjesdqjtvd, read-only):**
    - `POST /rest/v1/rpc/set_koh_nail_sites` → HTTP **404 PGRST202** (schema cache 미존재).
    - `GET check_in_services?select=koh_nail_sites` → HTTP **400 42703** (column does not exist).
- 메커니즘: FE read 는 42703 폴백 select(SELECT_WITHOUT) 로 명단 유지되나, **write(RPC)는 폴백 없음** → 조갑부위 저장 클릭 시 PGRST202 → toast "조갑부위 저장 실패"(현장 "저장안됨").
- **fix = PHASE15 마이그를 supervisor Gate3 통과 후 prod 적용.** 본 티켓은 DB 스키마 신설 안 함(planner FOLLOWUP 발행).

### 충돌 처리 (CONFLICT-DETAIL/REDEFINITION_RISK)
- PHASE15 FE 코드는 이미 main 반영(db-gate-pending = FE done, DB만 미적용). 본 rename 은 그 위 additive — 마이그/RPC 파일 무수정 → 코드 경합 없음.

## E2E
- `tests/e2e/T-RXLIST-FUNGAL-LABEL-SAVEBUG.spec.ts` — 11 pass.
  - S1 AC-1 라벨 정적검증(신규 present/구 absent + confirmed key 불변).
  - S2 AC-2 헤더/토스트/안내문 조갑 + 변수/DB컬럼/RPC명 불변 가드.
  - S3 pending 라벨 불변 범위가드.
  - S4 AC-3 저장경로 RCA 모사(RPC 부재 시 실패 / 적용 후 성공 / read≠write 폴백).

## 검증
- build PASS (3.98s). E2E 11/11 pass. DB변경: 없음(코드/spec만). commit ac99392 (push, main).
