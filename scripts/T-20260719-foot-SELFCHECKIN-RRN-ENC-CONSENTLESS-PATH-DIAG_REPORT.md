# 진단 리포트 — 셀프체크인 rrn_enc 무동의 저장경로 규명

- **티켓**: T-20260719-foot-SELFCHECKIN-RRN-ENC-CONSENTLESS-PATH-DIAG
- **범위**: Phase 1 = **read-only 진단만** (코드/DB 변경 0). Phase 2(정정·차단·백필)는 별도 티켓+대표/DA 게이트.
- **근거**: 코드 정적추적(FE `SelfCheckIn.tsx`/`CustomerChartPage.tsx` + 배포 pg_proc 본문) + prod read-only probe 2종
  (`_probe.mjs`, `_probe2.mjs` — 전부 SELECT/introspection, 무영속).

---

## 0. 결론 요약 (TL;DR)

1. **rrn_enc 저장경로 = 단 1개 함수 `public.rrn_encrypt(uuid, text)`** — `pgp_sym_encrypt`로 평문 주민번호 13자리를
   암호화해 `customers.rrn_enc`에 UPDATE. **EXECUTE 권한 = `authenticated` 전용 (anon 미부여).**
   호출처 = **데스크 직원**의 `CustomerChartPage.tsx`(고객 2번차트) `saveRrn`/`handleInfoPanelSave` → `supabase.rpc('rrn_encrypt', …)`.
   → 셀프체크인(anon 키오스크)은 **구조적으로 rrn_enc를 쓸 수 없다.**

2. **(a) 이관 vs (b) 신규 암호화 → 둘 다 아님. 정답은 (c) 데스크 직원 사후 입력.**
   - (a) `fn_selfcheckin_rrn_match`는 rrn_enc를 **전혀 건드리지 않으며**, 매칭 성공 시 데스크 레코드(dest)로 병합 후
     셀프접수 임시 레코드(src)를 **DELETE**한다. rrn_enc 이관 경로 아님.
   - (b) 셀프체크인 FE는 **전체 주민번호를 절대 전송하지 않는다** — `extractBirthDate(rrn)`로 **앞 6자리만** RPC에 전달.
     따라서 anon 경로에서 rrn_enc(암호화된 13자리)가 생성될 수 없음.

3. **consent_sensitive=false인데 rrn_enc 저장되는 조건** = 두 값이 **완전히 다른 함수·권한·시점**에서 기록되기 때문(구조적 디커플링).
   `rrn_encrypt`(데스크·authenticated)는 rrn_enc만 UPDATE하고 **동의 컬럼을 일절 확인/기록하지 않음** → 동의 게이트 부재.

4. **birth_date 0건 원인** = birth_date는 오직 셀프체크인 RPC(`resolve_v3`/`update_personal_info`)의
   `p_birth_date`(=`extractBirthDate(rrn)`)로만 기록되는데, **그 값이 호출 시점에 사실상 항상 NULL/빈값으로 도달**.
   배포된 write 코드(`COALESCE(p_birth_date, birth_date)`)·컬럼 타입(text)·트리거는 정상 — 유실은 FE 입력측.

5. **⚠ planner 전제 정정**: "created_by=NULL = 셀프체크인 신규"는 **성립하지 않음**. prod에서 `customers.created_by`는
   **전 레코드 NULL** (created_by NOT NULL = 0건, 전체 467건). 데스크/예약booking 생성분도 NULL.
   → **created_by=NULL은 셀프체크인 출처 식별자가 아님.** rrn_enc가 붙은 "created_by=NULL" 행은 셀프체크인 증거가 아니라
   데스크 입력 증거다.

---

## 1. 저장경로 특정 (코드 근거)

### 1.1 rrn_enc를 쓰는 함수 = `rrn_encrypt` 유일 (probe1 §1)
```
proname       prosecdef  sets_rrn_enc_update  calls_encrypt   grant
rrn_encrypt   true       true                 true            authenticated  ← anon 없음
```
- 정의: `supabase/migrations/20260520000030_rrn_key_harden.sql:39-41`
  `UPDATE public.customers SET rrn_enc = extensions.pgp_sym_encrypt(plain_rrn, v_key) WHERE id = customer_uuid;`
- GRANT: 동 파일 L87 `GRANT EXECUTE … rrn_encrypt(UUID, TEXT) TO authenticated;` (anon 미포함)

### 1.2 유일 호출처 = 데스크 2번차트 (staff)
- `src/pages/CustomerChartPage.tsx:3408, 3415, 3471, 3477`
  `supabase.rpc('rrn_encrypt', { customer_uuid: customer.id, plain_rrn: digits /* 13자리 */ })`
- 앞6+뒤7 split 입력(`handleRrnFrontInput`/`handleRrnBackInput`) → `saveRrn`/`handleInfoPanelSave`에서 암호화.
- **이 경로는 `customers.birth_date`를 저장하지 않는다** (rrn_encrypt는 rrn_enc만 UPDATE).

### 1.3 셀프체크인 write 함수는 rrn_enc 무접점 (probe1 §3, 배포본 기준)
```
fn_selfcheckin_upsert_customer_resolve_v3  : writes_birth_date=Y  writes_consent_sensitive=Y  touches_rrn_enc=N
fn_selfcheckin_update_personal_info        : writes_birth_date=Y  writes_consent_sensitive=Y  touches_rrn_enc=N
fn_selfcheckin_rrn_match                   : writes_birth_date=Y  writes_consent_sensitive=Y  touches_rrn_enc=N
```
- FE 전송값(`SelfCheckIn.tsx` L1273/L1451): `p_birth_date: extractBirthDate(rrn)` = **앞 6자리뿐**. 전체 RRN 미전송.

### 1.4 (a) vs (b) 판정
| 후보 | 판정 | 근거 |
|------|------|------|
| (a) 기존 레코드 rrn_enc 이관 | ✗ | `rrn_match` set-list에 rrn_enc 없음(§⑤). 매칭 시 dest 병합 + src DELETE. |
| (b) 셀프체크인 신규 암호화 | ✗ | anon은 rrn_encrypt EXECUTE 권한 없음 + FE는 앞6자리만 전송. |
| **(c) 데스크 직원 사후 입력** | **✓** | rrn_encrypt = authenticated 전용, 호출처 = CustomerChartPage(staff). 아래 시간갭 증거. |

### 1.5 시간갭 증거 (probe1 §5 — post-hoc 데스크 입력)
rrn_enc 보유 행 15건 표본: `created_at → updated_at` 갭이 **5,402 ~ 185,600초(≈1.5시간 ~ 2.1일)**, 전부 `has_birth=false, consent=false`.
→ 고객행 생성(체크인 T) 후 **수 시간~수 일 뒤** rrn_enc가 채워짐 = 데스크 직원이 차트에서 나중에 주민번호 입력한 패턴.
(셀프체크인 즉시 저장이면 갭≈0이어야 함.)

---

## 2. consent_sensitive=false인데 rrn_enc 저장되는 조건 (재현·확정)

**구조적 디커플링** — 두 값은 서로 다른 축에서 기록된다:

| 항목 | 쓰는 함수 | 권한 | 호출 시점/주체 | 동의 확인? |
|------|-----------|------|----------------|-----------|
| `rrn_enc` | `rrn_encrypt` | authenticated | 임의 시점 · 데스크 직원 | **없음** (동의 컬럼 미참조) |
| `consent_sensitive` | `update_personal_info`(신규분기) | anon | 셀프체크인 초진 제출 | 폼 동의(개보법 §23) |

**재현 절차 (개보법 §23 사실관계):**
1. 고객이 셀프체크인(또는 데스크 예약booking)으로 `customers` 행 생성 → `consent_sensitive`는 DB DEFAULT `false` 유지
   (셀프체크인 초진 동의 write가 미완료/미해당 = 재진·외국인·중도이탈 등).
2. 이후 데스크 직원이 2번차트를 열어 주민번호 13자리 입력 → `rrn_encrypt` → `rrn_enc` 세팅.
   이때 **동의 여부를 검사하는 게이트가 없어** `consent_sensitive=false` 그대로 rrn_enc 저장됨.

**prod 실측 (probe1 §4, created_by=NULL 최근14일 397건):**
`has_rrn_enc=132`, 그중 `rrn_enc 有 & consent≠true = 99` (75%). → 무동의 rrn_enc 저장이 소수 예외가 아니라 지배적 패턴.

**주의(법적 성격 규명)**: 이 저장은 **셀프체크인(anon) 무동의 저장이 아니라, 데스크 직원 입력 경로에 민감정보 동의 게이트가 없는** 문제다.
저장 주체·경로가 planner 초기 가설(셀프체크인)과 다르므로 Phase 2 대책의 차단지점도 달라진다(§4).

---

## 3. birth_date 미저장 원인

**사실 (probe2):**
- 배포 `update_personal_info`: `birth_date = COALESCE(p_birth_date, birth_date)`, `p_birth_date` 파라미터 존재. (오버로드 1개, 13-arg)
- 배포 `resolve_v3`: INSERT/UPDATE 모두 `NULLIF(btrim(p_birth_date),'')` — 정상. (오버로드 1개, 15-arg)
- `customers.birth_date` = plain text, generated 아님, **birth_date를 건드리는 트리거 0개**.
- 실측: `created_by=NULL` 전체 467건 중 `birth_date` 有 = **6건**(≈1.3%). 최근14일 397건 중 **0건**.
- 방문유형별(14일): new 250건 has_bd=0 / **consent_true=5**, returning 147건 has_bd=0 / consent_true=37.

**해석 (근인):**
- birth_date는 오직 `p_birth_date = extractBirthDate(rrn)`(FE)로만 기록. write 코드·컬럼·트리거 모두 정상 →
  **`p_birth_date`가 호출 시점에 null/빈값으로 도달**하는 FE 측 유실이 근인.
- 결정적 신호: **동일 UPDATE 안에서 `consent_sensitive`는 landing(일부), `birth_date`는 0** → 두 인자 중
  `p_birth_date`만 선택적으로 비어서 도달. (같은 함수콜이므로 함수/권한/네트워크 공통원인 배제.)
- new 250건 중 consent가 **5건뿐** → 대다수 "new" 고객행은 **게이트된 키오스크 personal_info 동의 flow를 통과하지 않았다**
  (통과했다면 consent 기본 true가 ~250 찍혀야 함). §5 정정과 결합하면: 이 행들은 데스크/예약booking 생성분이며 rrn·동의 미수집.
- consent만 있고 birth 없는 소수(≈5) = 외국인 초진 추정: gate `(isForeign || extractBirthDate(rrn)!==null)`로
  외국인은 rrn 없이 통과 → `p_consent_sensitive=true`는 전송, `p_birth_date`는 null(여권, RRN 미수집).

**남은 규명(→ Phase 2, 런타임 필요):** 비외국인 초진 실완주 케이스에서 `personal_info` 게이트를 통과(rrn 존재)했음에도
`p_birth_date`가 비어 도달하는지의 **런타임 확인**(키오스크 실기기 new-visit 제출 시 두 RPC payload 네트워크 캡처).
정적분석만으로는 "게이트 통과분의 birth 유실"과 "게이트 미통과분(데스크 생성)"의 비율을 확정 불가.

---

## 4. Phase 2 권고 (구현 금지 — 별도 티켓+대표/DA 게이트)

1. **차단지점(핵심)**: 무동의 rrn_enc 저장의 실제 발생지는 **데스크 `CustomerChartPage` → `rrn_encrypt`** 경로다.
   민감정보 동의 게이트를 **`rrn_encrypt` 진입점(서버 SECURITY DEFINER 함수 또는 CustomerChartPage 저장 전)** 에 둘지 여부가 §23 대응의 본질.
   → 정책결정(DA/대표): rrn_enc 저장 시 `consent_sensitive=true` 요구할지, 아니면 데스크 입력=별도 법적근거(진료계약)로 볼지.
2. **created_by 스탬프 부재 정정**: `created_by`가 전 레코드 NULL(=출처 추적 불가). T-20260716 CREATEDBY-CANON 스탬프가
   실제 미작동으로 보임 → 출처 식별 복구는 Phase 2 선행(감사·백필 대상셋 freeze의 전제).
3. **birth_date 유실 수정**: §3 런타임 캡처로 근인 확정 후 FE 수정. **백필 주의** — birth_date는 rrn_enc에서
   `fn_customer_birthdates`(서버 복호 파생)로 이미 read-time 대체 표기 중이므로, 파괴적 백필보다 파생 표기 유지가 안전할 수 있음.
4. **백필 판단**: 무동의 rrn_enc의 소급 처리(삭제/재동의)는 PII 파괴적 변경 → `cross_crm_orphan_archive_first` 계열 SOP +
   대표/DA 게이트 필수. **본 티켓 범위 밖.**

---

## 부록 — 실행 probe (read-only, 재현용)
- `scripts/T-20260719-foot-SELFCHECKIN-RRN-ENC-CONSENTLESS-PATH-DIAG_probe.mjs` — rrn_enc writer 전수/grant, 셀프체크인 함수 지문, created_by=NULL 분포, 시간갭 표본.
- `scripts/T-20260719-foot-SELFCHECKIN-RRN-ENC-CONSENTLESS-PATH-DIAG_probe2.mjs` — 오버로드·배정라인 정밀, 컬럼/트리거, 방문유형별 분포.
- 무영속 보장: 전부 SELECT/`pg_get_functiondef`/`information_schema` 조회. INSERT/UPDATE/DELETE/DDL 0.
