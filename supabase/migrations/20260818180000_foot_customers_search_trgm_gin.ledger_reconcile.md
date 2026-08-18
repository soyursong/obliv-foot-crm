# Ledger Reconcile — T-20260818-foot-CUSTMGMT-SEARCH-FAIL

**표준**: Migration Ledger Reconciliation — 단일표준. REF=rxlomoozakkjesdqjtvd (foot prod), READ-ONLY.
**DA**: DA-20260818-foot-CUSTMGMT-SEARCH-TRGM-GIN = CONDITIONAL-GO (ADDITIVE).
**SSOT**: agents/docs/da_replies/da_decision_foot_custmgmt_search_trgm_gin_20260818.md

## 3자 대조 (원장 vs prod 실재 vs 파일선언)

- **파일선언**: `20260818180000_foot_customers_search_trgm_gin.sql` — CREATE EXTENSION IF NOT EXISTS pg_trgm(no-op·이미 설치) + CREATE INDEX CONCURRENTLY IF NOT EXISTS ×4 (name/phone/birth_date/chart_number gin_trgm_ops). 기존 객체 mutate 0.
- **원장(supabase_migrations.schema_migrations)**: version `20260818180000` = 원장 미등재(collision 0, 2026-08-18 실측 `select version … where version='20260818180000'` → 0행). 로컬 최신 등재 파일 계열 `20260815000000` < 신규 → forward-only monotonic. supervisor DB-GATE 러너가 apply 직전 원장 재대조.
- **prod 실재(pg_indexes)**: customers 현 인덱스 13개 전부 btree(2026-08-18 실측). trgm/GIN 인덱스 부재 → 신규 4 인덱스와 이름충돌 0. pg_trgm 확장 = 이미 설치(`pg_extension` 실재) → CREATE EXTENSION IF NOT EXISTS = no-op.

## 판정

- **forward-doc 분기**: 신규 timestamp(20260815000000 < 20260818180000)·원장 미등재·prod 이름충돌 0 → 정상 forward migration.
- change-class = ADDITIVE(인덱스 4 신설·CREATE EXTENSION IF NOT EXISTS·기존행/컬럼/제약/RLS 무접촉·완전가역 DROP INDEX IF EXISTS) → §3.1 CEO 파괴게이트 N/A(DA §2). 단 실 DDL 실재 → supervisor DDL-diff + MIG-GATE REQUIRED(DA AC-1).
- db-repair/삭제-정정 불요. 3자 divergence 없음.
- ★ apply = supervisor DB-GATE 물리 GO-token 이후에만 (apply_before_go 금지). Gate-B(DA) GO ≠ apply 허가.
- ★ CONCURRENTLY = txn-외 실행 필수(supabase db push 금지) → apply 스크립트 statement-분리 실행: `node scripts/apply_20260818180000_foot_customers_search_trgm_gin.mjs`.

## ⚠ 착지 후 효능 유보 (dev-foot 라이브 census, deploy-ready 미마킹 근거)

본 마이그는 DA-approved·additive·무해하나, **RC 재현 term(1~2자 한글 성씨 '이'/'김')에 대해 인덱스 효능이 inert** 임이 dev-foot 라이브 census(2026-08-18)로 확인됨. planner FOLLOWUP 발행(별첨). 상세:
- 자연 planner(seqscan on) + 4 trgm 인덱스 존재 → broad term '이' 는 **Seq Scan 선택**(cost 152 < BitmapOr 21051), 인덱스 미사용. raw 실행 81ms.
- 강제 index-path 라도 name trgm bitmap = **2372행(전행) 후보** = 무-selectivity('이' 1자). `name % '이'` = 0매칭.
- 즉 POSTCHECK "broad term seq-scan 소거·sub-100ms" = 구조적 미달 가능. 8s timeout = raw OR-scan(81ms) 아닌 count:'exact'+PostgREST+부하(1.3s↔8.1s 요동) 지배.
→ 인덱스는 ≥3자 정밀검색(풀네임/전화/차트번호) leg 로만 유효. AC1(1자 성씨 검색) 완전해소는 FE 스톱갭(min-char 가드 + count 완화, 티켓 §114·DA §3-D pre-auth) 병행 필요. **scope 재확정 = planner.**
