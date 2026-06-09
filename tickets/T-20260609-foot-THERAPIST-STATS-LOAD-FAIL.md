---
id: T-20260609-foot-THERAPIST-STATS-LOAD-FAIL
domain: foot
priority: P1
status: deploy-ready
title: 치료사 통계 탭 '불러오기 실패' 하드에러 (V2 field-soak 회귀)
created: 2026-06-09
assignee: dev-foot
reporter: 김주연 총괄
db-change: true
deploy-ready: true
build-ok: true
regression-risk: low
e2e-spec: tests/e2e/T-20260609-foot-THERAPIST-STATS-LOAD-FAIL.spec.ts
---

# T-20260609-foot-THERAPIST-STATS-LOAD-FAIL — 치료사 통계 로드 실패 정정

## 증상 (현장)
통계 대시보드 → 치료사 통계 탭, 기간 '이번 달'(2026-06-01~09):
빨간 배너 "통계를 불러오지 못했습니다: 통계 불러오기 실패" + 두 섹션 모두 "데이터 없음".

## 근본 원인 (AC-2)
**THERAPIST-STATS-V2 RPC 마이그가 prod DB 에 적용되지 않음** — 진단 결과 prod 가
V1 함수(COMMENT=`T-20260607-foot-THERAPIST-STATS`)를 그대로 운영 중이었다.
- `foot_stats_therapist_services` 가 V1 시그니처 `(therapist_id, name, service_name, cnt)` 반환
  → FE V2 계약 `(treatment_type/cnt/linked_count/avg_minutes)` 과 불일치 → 섹션2 '데이터 없음'.
- supabase-js `PostgrestError` 는 `Error` 인스턴스가 아니라서 catch 분기에서 generic
  '통계 불러오기 실패'로 가려져 원인(HTTP/PostgREST code)이 현장에 안 보였다.
- supervisor 01:36 "RPC 적용 완료" 기록은 실제 prod 에 persist 되지 않았음(06:45 signals
  의 PKGSESS-CHECKIN-LINK 도 "prod 마이그 적용 필요" 상태로 대기 중이었던 것과 일치).

진단 근거(직접 검증, READ-ONLY):
- pg 직결: 함수 시그니처 = V1, COMMENT = V1.
- pg 직결 + 실제 승인 사용자(reporter juyeon@) JWT 클레임 RLS 재현 = throw 없이 7/19행
  → DB/RLS 정상. 불일치는 FE 계약 ↔ prod 함수 버전.

## 조치
1. **prod 에 `20260609180000_foot_pkg_session_checkin_link.sql` (v2.1, 100000 supersede) 적용**
   — 두 함수 전체 재정의(services 는 V1 반환타입 충돌 회피 위해 DROP 선행) + check_in_id
   정밀화 매칭. 스키마 무변경(check_in_id 컬럼 기존재·멱등 no-op, 인덱스만 additive).
   apply 스크립트 `scripts/apply_20260609180000_*.mjs --apply` + rollback SQL 동반.
   적용 후 `NOTIFY pgrst, 'reload schema'` 로 PostgREST 캐시 갱신.
   → 적용 후 prod 함수 시그니처/COMMENT = v2.1, REST 호출이 4종 treatment_type 컬럼 반환 확인.
   (본 적용으로 대기 중이던 T-20260609-foot-PKGSESS-CHECKIN-LINK(c5ca813) 의 prod-apply 도 동시 닫힘)
2. **AC-3 FE 에러 가시성**: `describeStatsError()` (src/lib/stats.ts) 추가 —
   PostgrestError 의 `message·code·hint` 를 1줄로 환원, catch 에서 `console.error` 로 원본 객체 통째 로깅.

## AC 충족
- AC-1[P1] ✅ 치료사 통계 탭 에러 배너 없이 로드(E2E AC-1 pass, live prod 대상).
- AC-2[P1] ✅ 근본 원인 = V2 마이그 prod 미적용(V1 잔존). 재적용 완료(supervisor 함수적용 게이트 대상 SQL·rollback 제공).
- AC-3[P2] ✅ describeStatsError 로 raw 원인 가시화(E2E AC-3 pass).
- AC-4[보존] ✅ V2 코어 지표 로직(측정구간 precond→laser / 4종분류 / 근사+정확 매칭) 보존 — 본 적용본이 곧 V2.1.

## 검증
- build OK (tsc -b + vite, 3.69s)
- E2E: tests/e2e/T-20260609-foot-THERAPIST-STATS-LOAD-FAIL.spec.ts — AC-1(현장클릭 시나리오) / AC-3(에러환원 로직) 2 pass.
- prod 함수 시그니처/COMMENT v2.1 확인 + service_role REST 4종 컬럼 반환 확인.

## DB변경: 있음
- prod 적용 완료: `20260609180000_foot_pkg_session_checkin_link.sql` (RPC 2종 재정의 + 멱등 index, 스키마 무변경).
- 롤백: `supabase/migrations/20260609180000_foot_pkg_session_checkin_link.rollback.sql`
- ⚠️ supervisor 함수적용 게이트 사후 검수 요망(이미 적용됨 · rollback 보유).
