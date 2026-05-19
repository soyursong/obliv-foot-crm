---
id: T-20260519-foot-CHART-ACCESS-LOCK
domain: foot
status: deploy-ready
priority: P0
deploy-ready: true
build-ok: true
db-change: false
regression-risk: low
e2e-spec: tests/e2e/T-20260519-foot-CHART-ACCESS-LOCK.spec.ts
created: 2026-05-19
---

# T-20260519-foot-CHART-ACCESS-LOCK — 차트 열림 경로 코드 락 + 전 고객 차트 접근 보장

## 배경

차트 열림 5회+ 재발 히스토리 최종 대응.
- FIRSTVISIT-CHECKIN (deployed) — 초진 접수 버튼 + 카드 클릭 차트조회 분리
- PRECHECKIN-CHART (deployed) — 초진 접수 전 차트 열람 가능화

두 티켓으로 차트 접근 경로 구현 완료 후, 타 작업이 차트 접근 경로를 건드려 재회귀하는 것을 **구조적으로 방지**하는 가드가 필요.

## 현장 요청

> 김주연 매니저 (2026-05-19 18:03): 초진/재진 무관, CRM 등록된 모든 고객의 1번차트·2번차트가 무조건 열려야 함. 차트 열림 경로 코드에 수정 금지 락(lock) 적용.

## 참조 패턴

`T-20260519-crm-MEMO-RBAC-PHASE0-GUARD` (commit 9e082b7):
- `blocked-symbols.json` + `check-blocked-symbols.sh` + `pre-push hook`
- 이번에는 반대 방향: 금지 심볼 차단 → 필수 심볼 제거 방지

## 구현 내용

### 1. `scripts/chart-access-lock.json` — 필수 심볼 SSOT

10개 active 패턴 정의:
- `CHART-LOCK-001`: `useChart` hook — src/lib/chartContext.ts
- `CHART-LOCK-002`: `ChartContext` export — src/lib/chartContext.ts
- `CHART-LOCK-003`: `openChart` 구현 — src/components/AdminLayout.tsx
- `CHART-LOCK-004`: `ChartContext.Provider` 래핑 — src/components/AdminLayout.tsx
- `CHART-LOCK-005`: `CustomerChartSheet` 단일 렌더 — src/components/AdminLayout.tsx
- `CHART-LOCK-006`: `createPortal` 사용 — src/components/CustomerChartSheet.tsx
- `CHART-LOCK-007`: `openChart` 호출 — src/components/CheckInDetailSheet.tsx
- `CHART-LOCK-008`: `openChart` 호출 — src/pages/Customers.tsx
- `CHART-LOCK-009`: `openChart` 호출 — src/pages/Dashboard.tsx
- `CHART-LOCK-010`: `openChart` 호출 — src/pages/Reservations.tsx

### 2. `scripts/check-chart-access-lock.sh` — 스캐너

- 필수 패턴이 **없으면** push 차단 (blocked-symbols.sh와 반대 방향)
- `BYPASS_CHART_LOCK=1` override 시 skip + planner FOLLOWUP 의무 명시
- 김주연 매니저 승인 프로세스 안내 메시지 포함

### 3. `scripts/git-hooks/pre-push` + `scripts/install-hooks.sh`

- 새 개발자 온보딩 시 `bash scripts/install-hooks.sh` 실행으로 hook 설치
- 기존 hook 자동 백업

### 4. `.github/workflows/ci-push.yml` — CI 가드

- `chart-access-lock` job 추가 (Tier 0, 2분 타임아웃)
- `typecheck/build/critical-flow` 보다 먼저 실행
- `bash scripts/check-chart-access-lock.sh` — 필수 패턴 누락 시 CI 실패

### 5. `tests/e2e/T-20260519-foot-CHART-ACCESS-LOCK.spec.ts` — E2E spec

- **AC-1**: 전 경로 차트 열림 회귀 (초진 접수전/후, 재진, Customers, 전역검색)
- **AC-2**: chart-access-lock.json 구조 + 10개 소스코드 패턴 존재 검증
- **AC-3**: pre-push hook + CI 가드 파일 존재 검증
- **AC-4**: 김주연 매니저 승인 프로세스 문서화 확인
- **AC-5**: Dashboard·Customers·Reservations·SelfCheckIn 회귀 0

## 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `scripts/chart-access-lock.json` | 신규 — 10개 차트 접근 필수 패턴 SSOT |
| `scripts/check-chart-access-lock.sh` | 신규 — 필수 심볼 스캐너 |
| `scripts/git-hooks/pre-push` | 신규 — pre-push hook 소스 (git 추적) |
| `scripts/install-hooks.sh` | 신규 — hook 설치 스크립트 |
| `.github/workflows/ci-push.yml` | 수정 — chart-access-lock CI job 추가 |
| `tests/e2e/T-20260519-foot-CHART-ACCESS-LOCK.spec.ts` | 신규 E2E spec |
| `tickets/T-20260519-foot-CHART-ACCESS-LOCK.md` | 신규 티켓 |

## DB 변경

없음

## bypass 절차

```bash
# 긴급 로컬 bypass (김주연 매니저 승인 + planner FOLLOWUP 의무)
BYPASS_CHART_LOCK=1 git push
```

차트 접근 경로 수정이 필요한 경우:
1. planner FOLLOWUP 발행 (수정 사유 + 대안 경로 명시)
2. supervisor GO 판정
3. `scripts/chart-access-lock.json` 해당 항목 `active: false` 변경
4. PR에 승인 티켓 번호 + 김주연 매니저 승인 명시

## 롤백

가드 파일만 삭제 시 롤백 완료 (소스 변경 없음):
```bash
git revert HEAD  # 또는 삭제 파일만 복원
```
