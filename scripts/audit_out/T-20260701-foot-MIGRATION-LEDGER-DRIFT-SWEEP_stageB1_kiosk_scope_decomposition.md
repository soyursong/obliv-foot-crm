# StageB1 anon-REVOKE kiosk-scope 분해표 (read-only)

- 티켓: T-20260701-foot-MIGRATION-LEDGER-DRIFT-SWEEP
- 요청: planner INFO MSG-20260704-094110-1bsm (★ StageB1 kiosk-scope 안전 게이트, DDL-diff 게이트#2 apply 전 선행)
- 생성일: 2026-07-04 (PROD write 0, repo 마이그 정적 분석만)
- 대상 배치: `scripts/T-20260701-foot-MIGRATION-LEDGER-DRIFT-SWEEP_stageB1_apply.mjs` = 3 마이그 (#1/#2/#4)
- kiosk-critical 3 table = `check_ins` / `customers` / `reservations` (7/03 CEO감사: LIVE 외부 키오스크 soyursong/foot-checkin, Gate C 미전환, anon 직접 .from() 13건)

---

## #1 `20260616010000_phi_anon_grant_revoke_hardening.sql` — `REVOKE ALL ... FROM anon`

| # | statement | table | 회수 verb | kiosk-critical table? |
|---|---|---|---|---|
| 1.1 | `REVOKE ALL ON insurance_claims FROM anon` | insurance_claims | ALL | **NO** |
| 1.2 | `REVOKE ALL ON claim_items FROM anon` | claim_items | ALL | **NO** |
| 1.3 | `REVOKE ALL ON insurance_claim_diagnoses FROM anon` | insurance_claim_diagnoses | ALL | **NO** |
| 1.4 | `REVOKE ALL ON edi_submissions FROM anon` | edi_submissions | ALL | **NO** |

**판정: #1 = kiosk-critical 3 table 접촉 0건.** 4개 전부 보험청구/EDI PHI 테이블.
→ planner가 우려한 worst-case("StageB1 #1이 check_ins/customers/reservations를 REVOKE ALL로 死")는 **#1에 실재하지 않음.** #1은 구조상 kiosk-safe. **배치 잔류 → supervisor DDL-diff 진행 OK.**

---

## #2 `20260629140000_anon_pii_leak_revoke_phase1.sql` — 파괴/불요 verb 선별 회수

| # | statement | table | 회수 verb | **보존 verb** | kiosk table? | kiosk-kill? |
|---|---|---|---|---|---|---|
| 2.1 | staff | S,I,U,D,TR,REF,TRG (전권) | 없음 | NO | no |
| 2.2 | user_profiles | 전권 | 없음 | NO | no |
| 2.3 | customers | DELETE,TRUNCATE,REFERENCES,TRIGGER | **SELECT,INSERT,UPDATE** | **YES** | **NO** (kiosk verb 보존) |
| 2.4 | check_ins | DELETE,TRUNCATE,REFERENCES,TRIGGER | **SELECT,INSERT,UPDATE** | **YES** | **NO** |
| 2.5 | reservations | INSERT,DELETE,TRUNCATE,REFERENCES,TRIGGER | **SELECT,UPDATE** | **YES** | **NO** (kiosk=SELECT+UPDATE만 사용) |

**판정: #2 = kiosk-critical 3 table 전부 접촉(2.3/2.4/2.5). 단, 회수 대상은 파괴/불요 verb에 한정 — 키오스크 필수 verb(customers/check_ins: SELECT+INSERT+UPDATE, reservations: SELECT+UPDATE)는 명시 보존.**
- 마이그 헤더에 FE grep 증거(2026-06-29, native SelfCheckIn.tsx + foot-checkin 양쪽): 회수 verb 전부 셀프체크인 동선 미사용 → 체크인 회귀 0.
- Phase 1은 **SELECT-leak DROP을 의도적으로 제외**(그건 Phase 2 = JONGNO full-2b, KIOSK-CUTOVER 후). = 애초에 kiosk 死 회피 설계.

→ 엔지니어링 분석상 #2도 kiosk-safe. **단 게이트 letter(rule 2/3: 3 table 접촉분은 배치 제외 + DA 재판정)에 따라 self-clear 안 함.** 7/01 DA blanket GO(e4yk, "REVOKE는 항상 tighten")는 **7/03 kiosk 발견 이전** 판정이므로 kiosk table 접촉분은 kiosk 사실 반영 DA 재판정 경유.

---

## #4 `20260611210000_rx_audit_log.sql`

| statement | table | verb | kiosk table? |
|---|---|---|---|
| `REVOKE ALL ON public.rx_audit_log FROM anon` (§12-6 백스톱) | rx_audit_log (신규 감사테이블) | ALL | **NO** |

**판정: #4 = kiosk-critical 접촉 0. 신규 PHI 감사테이블 CREATE + RLS + 자기 테이블 anon REVOKE.** 배치 잔류 OK.

---

## 최종 disposition (게이트 rule 적용)

### A. 배치 잔류 → supervisor DDL-diff 게이트#2 진행 (kiosk 접촉 0)
- **#1 전체** (1.1–1.4, insurance/EDI 4 table)
- **#4** (rx_audit_log)
- **#2.1 / #2.2** (staff / user_profiles — 비-kiosk table)

### B. 현 DDL-diff 배치 제외 + KIOSK-CUTOVER dependency 상속 + DA 재판정 라우팅
- **#2.3 / #2.4 / #2.5** (customers / check_ins / reservations 파괴-verb REVOKE)
- 근거: 3 kiosk table 접촉 → 게이트 letter상 배치 제외. **dev-foot 권고 = kiosk-safe(파괴-verb only·kiosk verb 보존·6/29 FE grep 증거) → DA fast-GO 유력.** 단 GO 전까지 supervisor 미적용.

> 실무 주의: #2는 단일 파일이라 apply 시점 문장 분할이 지저분함. 두 경로:
> - (권장) DA가 #2 전체를 kiosk-safe로 fast-clear → #2 파일 원형 유지, A에 합류.
> - (대안) #2를 #2-nonkiosk(staff/user_profiles) / #2-kiosk(3 table)로 파일 분할 후 후자만 KIOSK-CUTOVER 뒤 배치. staff/user_profiles REVOKE는 urgency 낮아 #2 전체 HOLD해도 비용 LOW.

### C. supervisor heads-up
- 이번 DDL-diff에서 **check_ins/customers/reservations anon REVOKE 항목(#2.3/2.4/2.5) apply 금지** (DA 재판정 GO 전).
- **#1(insurance/EDI 4 table)·#4(rx_audit_log)·#2.1/2.2(staff/user_profiles)는 kiosk 무접촉 → 그대로 apply 진행 가능.**
- payments REVOKE(`20260628140000_anon_revoke_payments_only`)는 별건이나, JONGNO INTERIM-SCOPEDOWN과 멱등중복 → 순서 무관·안전.

---

## 요약 한 줄
planner의 "StageB1이 kiosk를 死시킬 수 있다" 직감은 **#2의 3-table 접촉 존재로 절반 맞음**이나, **실제 회수 verb는 전부 파괴/불요 verb이고 kiosk 필수 verb는 보존** → StageB1 배치는 (letter상 #2.3–2.5만 DA 재판정 경유하면) 전건 kiosk-safe. #1은 애초에 kiosk 무접촉.
