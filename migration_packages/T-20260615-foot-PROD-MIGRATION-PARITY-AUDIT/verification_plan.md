# AC-2 적용 검증 plan — ground-truth + ANON (DWELLSWAP AC-6 패턴)

- 대상: prod `rxlomoozakkjesdqjtvd`
- 배치: #A insurance_claims_schema + #7 is_healer_intent(컬럼 ADD)
- 실행기: `apply_parity_ac2_pg.mjs` (dry-run/--apply/--rollback)
- 원칙: schema_migrations 신뢰 금지 — **객체 존재로 판정**. 적용 전/후 동일 probe 대조.

## 0. 게이트 (적용 전 필수, 순서 고정)
1. data-architect CONSULT GO (PHI/금융 테이블 + RLS/GRANT) — #A/#7 동봉
2. supervisor DDL-diff 통과
3. 위 2개 통과 확인 후에만 `--apply`. (additive 빈테이블3+컬럼 → 대표 게이트 불요, supervisor DDL-diff로 충분)

## 1. 적용 전 (dry-run) — 2026-06-15 실측 ✅
| 항목 | 기대 | 실측 |
|------|------|------|
| insurance_claims / claim_items / edi_submissions | 부재 | ❌ 없음 (확인) |
| claim_diagnoses | 존재(선적용) RLS ON | ✅ 존재 RLS ON |
| reservations.is_healer_intent | 부재 | ❌ 없음 (확인) |
| claim_diagnoses → insurance_claims FK | 없음 | **없음 → scoped rollback 안전** |
| claim_diagnoses 정책 | authenticated only (anon 0) | ✅ claim_diagnoses_auth_all ALL {authenticated} |

## 2. 적용 후 검증 (--apply 후 자동 출력 + 수동 확인)
### 2.1 객체 생성 (PASS 조건)
- insurance_claims / claim_items / edi_submissions: ✅ 존재 + **RLS=ON**
- reservations.is_healer_intent: ✅ boolean, NOT NULL, default false
- claim_diagnoses: ✅ 존재 유지(정의 무변경 — IF NOT EXISTS SKIP)

### 2.2 RLS / 정책 (PASS 조건)
- 3 신규 테이블 각각 `*_auth_all` 정책 1건, `roles={authenticated}` (anon 정책 0건 — no-read-up)
- 정책 술어: USING/ WITH CHECK 가 staff.user_id=auth.uid() clinic 스코프

### 2.3 ANON 경로 (보안 — PASS 조건)
> PHI 테이블이므로 미인증(anon) 차단을 명시 검증한다.
- `has_table_privilege('anon', 'insurance_claims', 'SELECT')` → **false 기대** (anon GRANT 없음)
- `has_table_privilege('anon', ..., 'INSERT')` → **false 기대**
- `has_table_privilege('authenticated', ..., 'SELECT')` → true (정상 접근)
- anon GRANT 가 true 로 나오면 **NO-GO** — supervisor 에 REVOKE 보강 요청.
  (Supabase 기본 default-privilege 로 anon 에 GRANT 가 새어들 수 있으므로 반드시 실측)

### 2.4 스모크
- insurance_claims / claim_items / edi_submissions: `count(*) = 0` (빈 테이블 정상)

### 2.5 live 버그 해소 (수동 — 갤탭 현장 confirm)
- PaymentDialog → InsuranceCopaymentPanel → 산출 저장:
  service_charges INSERT 후 insurance_claims upsert 가 **42P01 없이** 성공.
  "청구 생성 실패" 미노출 + 부분저장 미발생.

## 3. 롤백 검증 (--rollback)
- H7 컬럼 DROP → A scoped_rollback(edi_submissions/claim_items/insurance_claims DROP).
- **claim_diagnoses 보존** 확인 (적용 전과 동일하게 존재 + RLS ON).
  → §1 에서 FK 없음 확인됨: insurance_claims DROP CASCADE 가 claim_diagnoses 를 건드리지 않음.
- 적용 후 → 롤백 후 ground-truth 가 §1(적용 전)과 일치하면 PASS.

## 4. HOLD 상태
- 현재: dry-run 만 실행됨(prod 쓰기 0건). `--apply` 는 §0 게이트 통과 후.
