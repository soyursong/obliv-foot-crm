---
id: T-20260520-foot-MEMO-HISTORY
domain: foot
priority: P1
status: deploy-ready
deploy_ready: true
hotfix: false
created: 2026-05-20 19:34
deadline: 2026-05-27
slack_channel: C0ATE5P6JTH
slack_thread_ts: 1779273078.712969
reporter: 김주연 총괄
reporter_slack_id: U0ATDB587PV
attachments: []
e2e_spec: tests/e2e/T-20260520-foot-MEMO-HISTORY.spec.ts
risk_verdict: GO_WARN
risk_reason: "비즈니스 로직 변경(치료메모 저장 방식 덮어쓰기→누적). DB 스키마 변경(customer_treatment_memos 신규 테이블 — 이미 운영 DB 적용 완료)."
db_migration: supabase/migrations/20260520000100_customer_treatment_memos.sql
db_migration_applied: true
deploy_commit: 073bd0a
---

# T-20260520-foot-MEMO-HISTORY — 상세 치료메모 히스토리 누적 방식 변경

## 요청 원문 (MSG-20260520-78712969)

> 상세 - 치료메모 히스토리 누적 방식으로 변경해줘

## 구현 내역

### FE (CustomerChartPage.tsx)
- `TreatmentMemoEntry` 인터페이스 추가 (id/content/created_by/created_by_name/created_at/updated_at)
- `treatmentMemos` state (DESC 순 배열) + `treatmentMemosLoaded` + `treatmentMemoUnavailable` 플래그
- `loadTreatmentMemos()` — 탭 진입 시 lazy load, `.order('created_at', { ascending: false })`
- `saveNewTreatmentMemo()` — INSERT + prepend to list (덮어쓰기 없음)
- `saveTreatmentMemoEdit()` — 본인 건 UPDATE
- `deleteTreatmentMemo()` — 본인 건 DELETE
- UI: 새 메모 추가 textarea + 버튼, 이력 목록(작성자·일시·수정·삭제 버튼)
- RBAC: `memo.created_by === profile?.email` 조건 — 본인 건만 수정/삭제 버튼 표시

### AC-3: lazy migration
- `items.length === 0` & `customer.treatment_note ?? customer.memo` 존재 시 → 히스토리 첫 항목으로 INSERT (created_by_name = '(이전 기록)')

### DB
- `supabase/migrations/20260520000100_customer_treatment_memos.sql` (신규 테이블 + RLS 4종)
- 운영 DB 직접 적용 완료 (T-20260520-foot-MEMO-SAVE-ERR hotfix 1fb053c, 2026-05-20T20:47)

## 수용기준 (AC) 완료 여부

| AC | 내용 | 완료 |
|----|------|------|
| AC-1 | 새 메모 저장 시 기존 보존 + 누적 | ✅ |
| AC-2 | 최신순 DESC + 작성자·일시 표시 | ✅ |
| AC-3 | 기존 데이터 lazy migration | ✅ |
| AC-4 | 본인 작성분 수정·삭제 (RBAC) | ✅ |
| AC-5 | 빌드 성공 + E2E 회귀 없음 | ✅ 13/13 pass |

## E2E 결과

```
tests/e2e/T-20260520-foot-MEMO-HISTORY.spec.ts — 13 passed (9.4s)
```

## 리스크 5항목

| # | 항목 | 해당 | 비고 |
|---|------|------|------|
| 1 | DB 스키마 변경 | ✅ 완료 | customer_treatment_memos 신규 테이블 — 운영 DB 적용 완료 |
| 2 | 외부 서비스 의존 | ❌ | 없음 |
| 3 | 비즈니스 로직 변경 | ✅ 완료 | 메모 저장 방식 근본 변경(덮어쓰기→누적) |
| 4 | 대량 데이터 변경 | ❌ | lazy migration 소규모 |
| 5 | 신규 npm 패키지 | ❌ | 없음 (date-fns 기존 사용) |

**판정: GO_WARN** — DB 변경 적용 완료. 운영 검증 진행 가능.

## 참고 티켓
- T-20260519-foot-MEDCHART-REVAMP (deployed) — 치료메모 영역 원래 추가
- T-20260520-foot-MEMO-SAVE-ERR (deployed) — DB migration 적용 + graceful fallback
