# T-20260615-foot-PROD-MIGRATION-PARITY-AUDIT — AC-2 적용 패키지

- 작성: dev-foot / 2026-06-15
- 상태: **HOLD (prod 쓰기 0건)** — dry-run ground-truth 만 실행됨.
- 게이트: data-architect CONSULT GO → supervisor DDL-diff 통과 → `--apply`.
- 근거: AC-1 리포트 `scripts/audit_out/T-20260615-foot-PROD-MIGRATION-PARITY-AUDIT_ac1_report.md`,
  planner AC-2 판정 MSG-20260615-195905-afed.

## 이 배치에 포함 (DA CONSULT 동봉 2건)
| # | 대상 | 종류 | apply | rollback | 게이트 |
|---|------|------|-------|----------|--------|
| #A | insurance_claims / claim_items / edi_submissions | 신규 테이블 3 (additive, 빈) + RLS | `A_insurance_claims.apply.sql` | `A_insurance_claims.scoped_rollback.sql` | DA(PHI/금융+RLS) + supervisor DDL-diff |
| #7 | reservations.is_healer_intent | 컬럼 ADD (additive) | `H7_is_healer_intent_column.apply.sql` | `H7_is_healer_intent_column.rollback.sql` | #A 동봉 |

## 실행
```
node apply_parity_ac2_pg.mjs            # dry-run (read-only ground-truth + ANON 프로브)
node apply_parity_ac2_pg.mjs --apply    # [게이트 통과 후만]
node apply_parity_ac2_pg.mjs --rollback # 스코프드 롤백 (claim_diagnoses 보존)
```

## ★ 핵심 안전 발견 — 원본 down.sql 사용 금지
- 원본 `20260520000010_insurance_claims_schema.down.sql` 은 `claim_diagnoses` 를 DROP CASCADE 한다.
- 그러나 `claim_diagnoses` 는 prod 에 別마이그(20260515000010)로 **선존재** → 원본 down 적용 시
  본 배치가 만들지 않은 기존 테이블/데이터 파괴.
- 따라서 **scoped rollback** 만 사용 (생성한 3 테이블만 제거, claim_diagnoses 보존).
- dry-run 으로 `claim_diagnoses → insurance_claims FK 없음` 실측 확인 → insurance_claims DROP CASCADE
  가 claim_diagnoses 를 건드리지 않음을 검증.

## #7 backfill 분리 (planner 판정)
- 컬럼 ADD 만 GO. backfill UPDATE(데이터변경, AC-3 경계)는 분리:
  `supabase/migrations/20260615T_is_healer_intent_backfill.datafix.sql`
  → 별도 datafix 티켓(planner 발번)으로 끊으며 본 배치에서 적용 금지.
- 원본 `20260614130000_reservation_is_healer_intent.sql` 은 backfill 제거(컬럼 ADD only)로 정리됨.

## 이 배치에서 제외 (dev-foot 판단 / 라우팅)
| # | 대상 | 처리 |
|---|------|------|
| #C can_assign_rooms | GO-conditional, **#A 후순위**. RLS 교체 → 8-role 권한 전후 회귀검증 plan 별도 준비(`C_room_assign_role_regression_plan.md`). DA CONSULT + supervisor 경유. |
| #2 chart_diagnoses / #B doctor_diagnosis_favorites | additive·FE참조0/graceful·LOW. **이 배치에서 HOLD**(blast radius 최소화). 필요 시 parity 후속 배치로 묶음. |
| #5 rx_audit_log / #6 scheduled_messages | dev-foot 비대상 — supervisor db-gate. |
| #3 pay_recon_port | dev-foot 비대상 — DA게이트(payments). |

## 검증
- ground-truth + ANON 검증 plan: `verification_plan.md` (DWELLSWAP AC-6 패턴).
