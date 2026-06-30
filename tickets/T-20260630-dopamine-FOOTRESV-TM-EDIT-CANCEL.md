---
id: T-20260630-dopamine-FOOTRESV-TM-EDIT-CANCEL
domain: foot
priority: P1
status: deploy-ready
qa_result: pending
deploy_commit: bbc726cc
deployed_at: 2026-06-30 (DB superset RPC 적용 완료 — supervisor DDL-diff + ①1행검증 게이트 대기)
bundle_hash: n/a (DB-only RPC 변경 — FE 번들 무변경)
db_change: true
summary: "TM(박민지팀) 예약 수정/취소 ingest — 도파민→풋 표준 진입점 upsert_reservation_from_source RPC 에 ①재푸시 mutable UPDATE(no-op 정황 보정) + ②p_status='cancelled' 취소 전이(슬롯 release) 추가. ★3-티켓 동시 인플라이트(같은 RPC CREATE OR REPLACE)를 단일 additive superset body 1회로 합본해 deploy-ordering clobber(STATS-PERIODFILTER 선례) 차단 = (a TM-EDIT-CANCEL) ⊃ (b MEMO-PUSH-DROP: p_memo 8th + memo COALESCE preserve-on-NULL) ⊃ (c COMPANION-RESV-INSERT-FAIL: 8→17arg + external_id UUID→TEXT + customer_real_name). prod ground-truth: 8-arg(b 라이브)·external_id uuid·customer_real_name 부재 = (c) 미배포였음 → 본 합본이 (c)+(a) 동반 출하. ②가드: self-mint scope(source_system=p_source_system AND NOT NULL) → dopamine 호출은 dopamine 행만 취소, foot-native/NULL source 행 불변(split-brain 차단). 이미 cancelled 재취소=성공 no-op, 취소대상 부재=NULL no-op(tombstone 생성 안 함). 슬롯 release=status='cancelled' 전이(오버부킹 카운터/캘린더 뷰 status NOT IN('cancelled') 자동 제외). SECURITY DEFINER. 컬럼 신규 0(본건). 게이트=대표게이트 면제(autonomy §3.1 ADDITIVE+DA GO). dry-run(BEGIN…ROLLBACK) green → 적용 → 신규 spec 5/5 GREEN + COMPANION 회귀 spec 5/5 GREEN."
created: 2026-06-30
assignee: dev-foot
owner: agent-fdd-dev-foot
e2e_spec: tests/e2e/T-20260630-foot-TM-EDIT-CANCEL.spec.ts
migration: supabase/migrations/20260630190000_foot_tm_edit_cancel_superset_rpc.sql
rollback_sql: supabase/migrations/20260630190000_foot_tm_edit_cancel_superset_rpc.rollback.sql
apply_script: scripts/apply_20260630190000_foot_tm_edit_cancel_superset_rpc.mjs
medical_confirm_gate: n/a (도파민 ingest RPC — 진료대시보드/진료관리 비대상)
data_architect_consult: 면제 (본건 컬럼/테이블/enum 신규 0 = ADDITIVE 함수 분기. external_id TEXT·customer_real_name 은 c COMPANION-RESV-INSERT-FAIL 의 DA GO 자산 합본 carry — 신규정책 아님)
---
## 요청 (planner PUSH·P1, 박민지 TM팀장 2차 urgent)

본건 RPC body, ADDITIVE·컬럼0:
- ① ON CONFLICT DO UPDATE on mutable(scheduled_at·slot_type·memo) — 재푸시 no-op 정황 보정(부모 시나리오1 idempotent UPDATE 성립).
- ② 옵셔널 p_status ADDITIVE — 생략/기본=현행 active('confirmed'), 'cancelled'=멱등키 행 전이 + 풋 슬롯 release(SECURITY DEFINER).
- 가드: source='dopamine' 자기 mint 행에만 스코프(foot-native/NULL 변경불가 split-brain 차단), 이미 cancelled 재취소=성공 no-op.

★중대 조율: 같은 RPC CREATE OR REPLACE 3건 동시 인플라이트 → 단일 additive superset 1회 또는 직렬화+누적머지. 세 변경분 모두 살아있는 최종 body.

## 구현 (합본 superset)

`supabase/migrations/20260630190000_foot_tm_edit_cancel_superset_rpc.sql` — 1회 CREATE OR REPLACE 로 (a)+(b)+(c) 최종 body:
- (c-A) external_id UUID→TEXT(lossless-widening) + UNIQUE 인덱스 재빌드 — 멱등(ALTER text→text no-op).
- (c-B) customer_real_name TEXT NULL ADD — 멱등(IF NOT EXISTS).
- 8-arg(prod) signature DROP → 17-arg CREATE(9~17 trailing DEFAULT, 8-arg 후방호환 100%).
- (a)② 취소 fast-path: p_status='cancelled' → self-mint scope UPDATE(status='cancelled', memo COALESCE) → 슬롯 release. 대상부재/이미취소 = no-op(기존 id 또는 NULL 회신).
- (a)① 재푸시 mutable UPDATE(reservation_date·time·status·memo) + (b) memo COALESCE preserve-on-NULL — ON CONFLICT DO UPDATE.
- (c) companion 분기(is_companion=true → customer_id NULL + customer_real_name 착지).

## 검증
- dry-run(BEGIN…ROLLBACK 전체 migration): HTTP 201 compiled, prod 무영향(8-arg 유지) 확인.
- 적용 후 시그니처 확인: 17-arg / SECURITY DEFINER / 취소 fast-path 본문 / external_id=text / customer_real_name 존재.
- 신규 spec `tests/e2e/T-20260630-foot-TM-EDIT-CANCEL.spec.ts` 5/5 GREEN:
  - S1 cancel 전이+슬롯 release(동일 id 회신) / S2 재취소 no-op / S3 타 source 행 불변(split-brain 가드) / S4 active 재푸시 mutable UPDATE+단일행+memo preserve-on-NULL / S5 취소대상 부재 NULL no-op(tombstone 미생성).
- 회귀 `T-20260630-foot-COMPANION-RESV-INSERT-FAIL.spec.ts` 5/5 GREEN(공유 RPC 무회귀).

## 게이트 / 잔여
- 대표게이트 면제(autonomy §3.1 ADDITIVE+DA GO). DA CONSULT 비대상(컬럼 신규0).
- supervisor 잔여: DDL-diff(RPC body diff) + ①선결 1행검증. rollback SQL 동봉.
- ⚠ 배포 순서: 본 합본이 같은 RPC 의 **최종 권위 body**. rpc17(20260630170000) 단독 재적용 또는 별도 (b) 마이그를 본 합본 이후 적용 금지(clobber). 본 합본 = (a)⊃(b)⊃(c) 최종.
