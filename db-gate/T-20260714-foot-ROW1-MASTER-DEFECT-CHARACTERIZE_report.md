# row1(0356b229) 결함 특성화 리포트 — READ-ONLY (mutation 0)

- Ticket: **T-20260714-foot-ROW1-MASTER-DEFECT-CHARACTERIZE** (approved)
- 대상: ROW1=`0356b229` (旣 "phantom") vs RAW=`c51dd5e0` (旣 "raw") · clinic=`74967aea` (jongno-foot)
- 방식: Supabase Management API SELECT-only (RLS 우회 read). **mutation/영속 0.**
- PHI 위생(§4): 실명/전체번호/RRN 평문 미기재. git=id8·count·boolean·category·tail4·ts. 실 name/rrn hash·판정근거 = off-git `~/foot-phi-offgit/…_offgit.json`.
- 스크립트: `scripts/T-20260714-foot-ROW1-MASTER-DEFECT-CHARACTERIZE_readonly.mjs` / 증거: `db-gate/…_evidence.json`

## 판정: **가설 A — 중복행(self-checkin 생성 duplicate) · confidence=HIGH**

ROW1(0356b229) = RAW(c51dd5e0) 의 **self-checkin 중복행**. standalone 실master(B) 아님.

### 핵심 근거 (동일인 + 중복 메커니즘 + 같은 방문 episode)

| 신호 | 값 | 함의 |
|------|----|------|
| name 완전일치 (name_hash) | **TRUE** | 동일인 (stem 아닌 full-name 해시 일치) |
| phone tail4 일치 | **TRUE** (양측 9089) | ROW1 masked phone(4자리)=RAW 실 phone(12자리)의 tail |
| clinic 내 tail4=9089 우주 | **2건 (=ROW1+RAW 뿐)** | 제3의 우연충돌 후보 0 → 우연충돌 배제 강화 |
| ROW1 self-checkin 서명 | check_in `reservation_id=NULL`, status=done | self_checkin 이 resv 미링크로 신규 row 분기(포렌식 확증 메커니즘) |
| **같은 방문 episode** | RAW 예약일=**2026-07-11**, ROW1 체크인일=**2026-07-11** | 동일 방문이 두 행으로 분리 |
| **RAW 예약 status** | **`no_show`** | 환자는 실제 방문(ROW1 check_in done)했으나 self-checkin이 RAW 예약에 매칭 실패 → RAW 예약이 거짓 no_show. **중복 생성의 직접 지문** |
| created 순서 | RAW 07-10 17:26 (선), ROW1 07-11 13:09 (후, ~19.7h) | RAW=원 등록(staff, 지인소개, new), ROW1=익일 self-checkin |

### 두 행 프로파일 (PHI-safe)
| 항목 | RAW c51dd5e0 | ROW1 0356b229 |
|------|--------------|----------------|
| phone | 12자리 (실형식) | **4자리 (마스킹)** |
| lead_source / visit_route | 지인소개 / 지인소개 | null / null |
| visit_type | new | returning |
| RRN 보유 | **false** | **true** |
| chart_number | F-4599 | F-4616 |
| 자식(하드) | reservations 1 + notification_logs 3(SET NULL) | check_ins 1 + consult_memos 1 + health_q_results 1 + health_q_tokens 1 |
| medical_charts | **0** | **0** |
| payments/packages | **0** | **0** |

**스토리:** 07-10 staff가 지인소개 실환자를 등록(RAW, 실 phone, 07-11 예약 생성). 07-11 환자 내원 → self check-in. self_checkin 이 (masked phone 등으로) 기존 RAW master 로 resolve 실패 → **신규 row(ROW1) 분기**. ROW1은 체크인 폼에서 RRN 캡처(→ROW1 RRN 보유)·health_q·consult_memo 생성, phone은 마스킹(4자리). RAW의 07-11 예약은 매칭 못 받아 `no_show` 잔류.

## 결함 성격 → SOP (mutation 단계, 지금 착수 금지 — planner 재설계)

**HYBRID:**
- **Cross-CRM Orphan-Row Archive-First Cleanup + FK Integrity Guard SOP** — 중복 master 파괴적 relink+archive-first (자식 raw로 re-anchor → 0건 재검증 → archive-first 제거).
- **+ Data-Correction Backfill SOP 규율** — ROW1→RAW **RRN mutable 이관**(RAW RRN 부재). ADDITIVE.
- ⚠ **부모 마스킹 마이그 기계(옵션D relink+archive) 재사용 금지** (DA 지시). 위 generic SOP 로 자체 설계.

**정정 방향 = keep RAW (ROW1 archive):**
- RAW 는 **실 phone 보유** → keep RAW = ROW1의 마스킹 phone을 사실상 복원(ROW1의 마스킹 phone은 자체 복원 불가). 현장 APPROVED_BLANKET 복원의도가 merge로 자연 충족.
- ROW1 이 RRN·check_in·health_q 보유 → **먼저 RAW로 이관/relink 후** archive (순소실0).

**mutation plan hint (planner 참고, 미실행):**
1. ROW1→RAW RRN 이관(rrn_enc/rrn_vault_id/rrn_encryption_version). ADDITIVE.
2. ROW1 4자식(check_ins·customer_consult_memos·health_q_results·health_q_tokens) FK relink→RAW. **customer_id-scoped UNIQUE 0건 → 충돌 없는 relink 확인**.
3. (business) RAW 예약 `no_show`→실제 방문 반영 여부 = 현장/planner 판단(**추정 금지**).
4. archive-first: ROW1 `_backup` 스냅샷 → 자식 0건 재검증(잔존 시 abort) → ROW1 제거. chart F-4616 공번.
5. 임상(medical_charts)·결제(payments/packages) 자식 **0 → 저blast**. 단 실환자·RRN(PHI)·파괴적 → **대표 게이트**.

## 게이트 (mutation 단계, carry-forward)
- 별도 **DA CONSULT** + **supervisor DB-GATE** + **대표 게이트**(파괴적·실환자·RRN 이동).
- **per-row 사람 confirm**(동일인 최종 — HIGH지만 DA C4/C7 바 준수).
- db_change 재판정 + MIG-GATE 4필드(mig_files/mig_dryrun/mig_ledger_check/mig_rollback) deploy-ready 前 기입.
- **fail-closed 존치**: DA GO 없이 row1 mutation 0. 부모 경로 [G0-hold] 가드 존치(row1 map 유입 시 ABORT).

## 잔여 불확실성 (사람 confirm 대상)
- 동일인 판정 = name-full+tail4+episode(3신호)로 HIGH. 단 **결정키(reservation_id) 부재**(self_checkin resv_null) → DA 바상 per-row 사람 최종 confirm 필수.
- RRN이 중복행(ROW1)에만 존재 → 이관 방향·RRN 재암호화 버전 정합 supervisor/DA 확인.
