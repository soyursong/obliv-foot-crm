---
id: T-20260521-foot-TRIAL-DROP-ADD
title: 회차 차감 "금일 치료" 드롭다운에 [체험권] 항목 추가
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
db_change: true
migration: supabase/migrations/20260521080000_pkg_sessions_trial.sql
rollback: supabase/migrations/20260521080000_pkg_sessions_trial.down.sql
created_at: 2026-05-21
closed_at: 2026-05-21
---

## 요약

금일치료 드롭다운(CustomerChartPage C22 인라인 회차 차감 폼)에 `체험권(trial)` 항목 추가.
DB CHECK constraint 확장 + FE 옵션 + TREAT_KO 한국어 라벨 동시 반영.

## AC 검증

- [x] AC-1: 금일 치료 드롭다운에 [체험권] 항목 표시 (`<option value="trial">체험권</option>`)
- [x] AC-2: [체험권] 선택 시 `saveC22Deduct` → `package_sessions` INSERT `session_type='trial'` → 정상 차감
- [x] AC-3: 차감 내역 `TREAT_KO['trial'] = '체험권'` → 시술내역 테이블에 '체험권' 라벨로 기록
- [x] AC-4: 기존 항목(가열/비가열/포돌로게/수액) 동작 영향 없음 (constraint에 추가만, 기존 값 유지)

## 변경 목록

| 파일 | 변경 내용 |
|------|-----------|
| `src/pages/CustomerChartPage.tsx` | 드롭다운 `<option value="trial">체험권</option>` 추가, `TREAT_KO`에 `trial: '체험권'` 추가 |
| `supabase/migrations/20260521080000_pkg_sessions_trial.sql` | `package_sessions_session_type_check` constraint에 `'trial'` 추가 |
| `supabase/migrations/20260521080000_pkg_sessions_trial.down.sql` | rollback — trial 제거 |
| `scripts/apply_20260521080000_pkg_sessions_trial.mjs` | DB 마이그레이션 실행 스크립트 (실행 완료) |

## DB 설계 메모

- `trial`은 `packages` 테이블에 별도 컬럼 없음
- `total_remaining = total_sessions - COUNT(used sessions)` 계산에 자동 포함
- `get_package_remaining` RPC 수정 불필요
- DB 적용 완료: 2026-05-21 (constraint verified)

## 빌드

```
✓ built in 3.33s (CustomerChartPage-CvcUTQ_z.js 198.58 kB)
```
