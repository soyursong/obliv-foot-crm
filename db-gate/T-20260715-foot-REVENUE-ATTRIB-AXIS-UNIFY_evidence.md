# T-20260715-foot-REVENUE-ATTRIB-AXIS-UNIFY — DB-GATE evidence (dev-foot / 2026-07-15)

RPC 매출 귀속축 통일: `created_at` → `accounting_date` (회계 SSOT, sales_common_db 소급차단축).
게이트 근거: DA-20260715-foot-REVENUE-ATTRIB-AXIS-UNIFY (GO, 대표게이트 불요/현데이터).
DB: rxlomoozakkjesdqjtvd (obliv-foot-crm 단일 Supabase).

## 변경 범위 (결제-귀속축만)
| 함수 | CTE | 축 | 조치 |
|------|-----|----|------|
| foot_stats_revenue | single(payments) | created_at→accounting_date | 전환 |
| foot_stats_revenue | pkg(package_payments) | created_at→accounting_date | 전환 |
| foot_stats_by_category | single_paid(payments) | created_at→accounting_date | 전환 |
| foot_stats_by_category | pkg_used(package_sessions) | session_date | **미변경**(소진 사건일, accounting_date 컬럼 부재) |

전환 금지(DA §3, 미접촉): foot_stats_consultant(티켓팅 count), foot_stats_therapist_summary(시술·지정 count) = 이벤트-카운트.
산식 무변경(payments+package_payments payment − 양테이블 refund). 귀속축만 전환.

## AC2.3 착수시점 T1 자가확인 (DA §2) — PASS
스크립트: `scripts/T-20260715-foot-REVENUE-ATTRIB-AXIS-UNIFY_t1_remeasure.mjs` (read-only, 2026-07-15)
- payments 33행: divergent 0 / acct NULL 0
- package_payments 15행: divergent 0 / acct NULL 0
- 월 총매출순 두 축 독립집계 비트동일:
  - 2026-05: created 3,353,730 = acct 3,353,730
  - 2026-06: created −2,942,720 = acct −2,942,720
  - 2026-07: created 8,439,230 = acct 8,439,230  (= P0 대사 목표)
- **T1 트리거 미발동** (이동 0원 / 0% < 1% & < 1,000,000원) → 대표 게이트 불요, supervisor 회귀·소급 대사로 충분.

## MIG-GATE 4필드
1. **멱등 마이그 + 롤백** — `20260715140000_foot_stats_revenue_attrib_axis_unify.sql` (CREATE OR REPLACE, 시그니처 불변=42P13 불가, 즉시 역전). 롤백 `.rollback.sql` (created_at 복원).
2. **dry-run 무영속** — `scripts/..._dryrun_mgmtapi.mjs` → **DRYRUN PASS**
   - canary: BEGIN;COMMENT;ROLLBACK → 잔존 0 (엔드포인트 ROLLBACK 실효 선증명)
   - apply: BEGIN..ROLLBACK 무오류
   - equivalence: 신(accounting_date) 출력 == 현행 live(created_at) 출력 **비트동일** (현데이터 no-op)
   - no-persistence: prosrc md5 baseline==postprobe (foot_stats_revenue 93c68737…, foot_stats_by_category a6e3d317…) → 무영속 확증
3. **schema_migrations ↔ 파일 ↔ prod 3자 대조**
   - 파일: 20260715140000 (신규 forward, 미적용 — 배포 시 등재)
   - prod 실재: 두 함수 live prosrc 캡처 = 본 마이그 base (original 20260430 계보, created_at). 이 위에 축만 전환.
   - ledger: 20260715140000 미등재(정상, 배포 시 등재). timestamp 충돌 없음(직전 최신=20260715130000).
   - ⚠ **선재 divergence 발견(본 티켓 범위 밖, planner 별도 보고)**: repo `20260706120000_foot_stats_reconcile_iv...`(by_category iv-exclude, T-20260608 AC1)가 **prod ledger 미등재 + prod live prosrc 에 iv 필터 부재** = prod 미적용 상태. DA §3 는 "live=reconcile 최신본" 전제였으나 실제 prod live 는 original base. 본 마이그는 정본=prod 실재 원칙으로 **iv-exclude 미채택**(별도 티켓 소관), 현행 live base 위에 귀속축만 전환.
4. **롤백 SQL** — 위 1 참조. 테이블/데이터 무접촉, 함수 정의만 역전.

## 배포 순서 제약 (supervisor 배포 게이트)
- 선행 P0 `T-20260715-sales-FOOT-REVENUE-PACKAGE-UNDERCOUNT` 배포 완료 후.
- dev-sales `T-20260715-sales-FOOT-REBUILD-ATTRIB-AXIS-UNIFY`(rebuild_foot.py 축통일)와 **동일 축·동일 배포 창** 동시 수렴 필수 — RPC만 먼저 전환 시 CRM↔필드 재divergence.

## AC3 supervisor 회귀·소급 대사 (배포 전)
- 변경 전후 월 총매출순 편차 = 0 (본 evidence 재현). deploy-integrity(발톱 매출 = CRM 대사) 통과 확인.
