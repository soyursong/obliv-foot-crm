# 진단 리포트 — 셀프체크인 birth_date FE 유실 근인 규명

- **티켓**: T-20260719-foot-SELFCHECKIN-BIRTHDATE-FE-LOSS-DIAG (P2, read-only)
- **부모**: T-20260719-foot-SELFCHECKIN-RRN-ENC-CONSENTLESS-PATH-DIAG §3 "남은 규명(→ Phase 2, 런타임 필요)"
- **범위**: read-only 진단만 (코드/DB 변경 0). FE 수정·백필은 별도 티켓.
- **근거**: ① 배포 소스/번들 정적추적 (`SelfCheckIn.tsx` + 라이브 `SelfCheckIn-rSpddXbR.js`)
  ② 배포 RPC 본문 (마이그 20260629120000 / 20260629160000)
  ③ prod read-only probe (`_probe.mjs` — PostgREST count-only, PII 값 미추출, 무영속)

---

## 0. 결론 요약 (TL;DR)

1. **근인 확정 = FE payload 가 `p_birth_date` 를 빈값으로 전송.** RPC·컬럼·트리거는 무결(부모 진단 재확인).
   → planner 전제("FE p_birth_date 빈값 도달") **입증됨**.

2. **입증 방식(airtight, 물리 키오스크 불필요):** 배포 `fn_selfcheckin_update_personal_info` 는
   `birth_date` 와 `consent_sensitive` 를 **단일 UPDATE·동일 row·동일 WHERE** 에서 함께 쓴다
   (마이그 20260629120000 L106–146). prod 에 **consent_sensitive=TRUE & birth_date=NULL** 인
   국내 초진행이 실재 → 같은 payload 안에서 `p_consent_sensitive=true` 는 도달했는데
   `p_birth_date` 는 빈값 도달했다는 뜻. **네트워크/함수/권한 장애라면 두 인자가 함께 유실**되므로,
   선택적 단일 인자 유실 = **FE payload 구성 단계 유실**로 특정.

3. **유실은 국내(비외국인) 초진에서 실재하며 지배적.** prod 최근14일 국내 초진 게이트 통과분
   (consent=TRUE·이메일 없음·연락처 있음) **4건 전부 birth NULL**, 그중 2건은 rrn_enc 보유(확정 국내).
   전기간 셀프체크인 초진(created_by=NULL·new) 중 birth 저장 성공은 **역대 단 1건** → 상시 결정론적 유실.

4. **유실 지점(FE)**: `SelfCheckIn.tsx`
   - **L1273** `fn_selfcheckin_upsert_customer_resolve_v3` : `p_birth_date: isNewVisit ? extractBirthDate(rrn) ?? null : null`
   - **L1451** `fn_selfcheckin_update_personal_info` : `p_birth_date: extractBirthDate(rrn) ?? null`
   두 지점 모두 `extractBirthDate(rrn)`(=`rrn` 앞 6자리) 사용. 라이브 번들도 동일(`Me(E)`).

5. **미해소(런타임 필요)**: 게이트 역설. 배포 번들은 국내 초진 `personal_info→confirm` 버튼을
   `disabled:!et`(et = `(isForeign || extractBirthDate(rrn)!==null) && … && consentSensitive`)로 **막는다**.
   즉 국내 초진이 confirm 에 도달했다면 게이트 시점 `rrn`≥6자리였음이 강제됨에도, 제출 payload 의
   `extractBirthDate(rrn)`가 빈값. **게이트 통과 시점 rrn 과 제출 시점 rrn 이 런타임에 어긋남.**
   정적/번들 분석으로는 두 지점이 동일 `rrn` 바인딩을 읽으므로 이 어긋남을 재현 불가 →
   **키오스크 실기기 new-visit 제출 시 두 RPC payload 네트워크 캡처**로만 확정 가능(티켓 액션1).

---

## 1. 유실 지점 특정 (코드 근거)

### 1.1 extractBirthDate — 앞 6자리 파생 (SelfCheckIn.tsx L484)
```
function extractBirthDate(rrnStr){ const d=rrnStr.replace(/\D/g,''); if(d.length<6) return null; return d.slice(0,6); }
```
6자리 미만이면 `null`. 라이브 번들 동일: `function Me(a){const o=a.replace(/\D/g,"");return o.length<6?null:o.slice(0,6)}`.

### 1.2 두 전송 지점 (SelfCheckIn.tsx)
| 라인 | RPC | 전달식 |
|------|-----|--------|
| L1273 | fn_selfcheckin_upsert_customer_resolve_v3 | `p_birth_date: isNewVisit ? extractBirthDate(rrn) ?? null : null` |
| L1451 | fn_selfcheckin_update_personal_info | `p_birth_date: extractBirthDate(rrn) ?? null` |

라이브 번들(정본): `p_birth_date:T?Me(E)??null:null` / `p_birth_date:Me(E)??null` — `Me`=extractBirthDate, `E`=rrn.
게이트도 `Me(E)!==null` (동일 `E`). ∴ 게이트·전송 모두 동일 `rrn` state.

### 1.3 rrn state 수명 (유실 후보 동작)
- 정의: `const [rrn,setRrn]=useState('')` (L691). 초기값 빈문자.
- 채움: 숫자패드 `handleRrnDigit`(L891, 함수형 업데이트, 안전).
- 비움: `resetForm()`(L787, sessionStorage.clear + step→'input') / `handleRrnClear`(L907).
  `resetForm` 트리거 = done(15s)/qr(180s)/idle(60s) 타이머 → **step 을 함께 전환**하므로 정상 제출 경로 중간 비움 아님.
- confirm 스텝엔 rrn 키패드 없음(표시 span 전용, L2330) → confirm 에서 rrn 편집 불가.

---

## 2. RPC·컬럼·트리거 무결 재확인 (배포 본문)

`fn_selfcheckin_update_personal_info` (마이그 20260629120000, 배포본):
```
UPDATE customers SET
  birth_date        = COALESCE(p_birth_date, birth_date),        -- L108
  ...
  consent_sensitive = CASE WHEN p_consent_sensitive = true THEN true ELSE consent_sensitive END,  -- L131
  ...
WHERE id = v_ci.customer_id AND clinic_id = p_clinic_id;         -- L146
```
- birth 와 consent 가 **같은 UPDATE·같은 row**. COALESCE(p_birth_date, birth_date) 는
  p_birth_date 가 비지 않으면 무조건 기록. resolve_v3 도 동일(UPDATE L88 / INSERT L129,
  `COALESCE(NULLIF(btrim(p_birth_date),''), birth_date)`).
- customers.birth_date = plain text, generated 아님, birth_date 트리거 0개(부모 진단 §3).
- ∴ birth NULL 결과 ⟺ 입력 p_birth_date 빈값 (역산 확정).

---

## 3. prod 실측 (read-only count, 최근14일 · created_by=NULL · visit_type='new')

| # | 조건 | 건수 |
|---|------|------|
| 0 | NEW rows | 250 |
| 1 | └ consent_sensitive=TRUE (키오스크 게이트 통과) | 5 |
| 2 |   ├ & birth NULL | 5 |
| 3 |   └ & birth NOT NULL (정상) | **0** |
| 4 | consentTRUE & birthNULL & email≠null (외국인 proxy) | 1 |
| 5 | consentTRUE & birthNULL & phone=null (외국인워크인) | 0 |
| 6 | ★ consentTRUE & birthNULL & phone≠null & email=null (**국내 유실**) | **4** |
| 7 |   └ ★ 위 + rrn_enc≠null (국내 초진 강한 증거) | **2** |
| 8 | 대조: consentFALSE/NULL & birthNULL (비키오스크 desk/booking) | 245 |

- 유실 국내행 생성일: **2026-07-13 ×3, 2026-07-15 ×1** (외국인 1건은 07-06).
- 전기간 new(created_by=NULL) birth 저장 성공 = **1건** → 상시 결정론적 유실(최근 회귀 아님).
- 250건 중 245건은 게이트 미통과(consent≠true) = desk/예약 생성분 → birth 는 rrn_enc 서버복호
  `fn_customer_birthdates` read-time 파생으로 표기(부모 진단 §5). "0/397" 대부분은 이 비키오스크 몫.

> 판정: (6)/(7) > 0 → **국내 키오스크 FE 유실 실재** 확정. planner 전제 성립.

---

## 4. 게이트 역설 (미해소 — 런타임 캡처 필요)

**모순:** 라이브 번들은 국내 초진 confirm 진입을 `disabled:!et` 로 막고 `et` 안에 `Me(E)!==null`(rrn≥6자리)이
포함됨 → 국내 초진이 confirm/제출에 도달했다면 게이트 시점 rrn 유효. 그런데 제출 payload 의
`extractBirthDate(rrn)` 가 빈값(=rrn<6자리). 게이트·제출이 **동일 `rrn` 바인딩**이므로 정적으론 불가능한 조합.

**후보 가설 (캡처로 판별):**
- **H1** 기기(갤탭)/IME 런타임 state-commit 타이밍 — 마지막 rrn 입력이 커밋되기 전 제출, 또는
  컨트롤드 입력 race 로 게이트 평가 rrn ≠ 제출 rrn.
- **H2** 배포 번들 드리프트 — 라이브 `SelfCheckIn-rSpddXbR.js` 는 소스(phase2b)보다 **구버전**
  (resolve 호출에 `p_sms_opt_in` 잔존 = DA-ow58 컷오버 이전). 단, 이 구번들도 게이트/전송 birth 로직은
  동일하므로 birth 유실을 단독 설명하진 못함(교차확인됨). 그래도 캡처 시 실번들 재확인 권고.
- **H3** 예약(reserved) 초진 특수 경로 — 미발견이나 캡처로 배제.

**캡처 사양(액션1, 물리 키오스크 필요 — dev 정적 불가):**
비외국인 초진 완주(personal_info 게이트 통과·rrn 입력)에서 `resolve_v3` + `update_personal_info`
두 RPC 요청 body 를 네트워크 캡처 → `p_birth_date` 실제 값 확인.
- 값 있음 → 현재 번들은 이미 정상(과거행은 구번들 유실) → 백필 게이트로 진행.
- 빈값 → 기기 런타임 유실 확정 → §5 FE 수정.

---

## 5. FE 수정 권고 (구현 금지 — 별도 티켓)

1. **제출 시점 재검증(방어)**: `handleSubmit` 진입부에서 국내 초진일 때 `extractBirthDate(rrn)===null` 이면
   조용히 null 전송하지 말고 **표면화(에러/재입력 유도)**. 현재는 게이트만 믿고 silent null 전송 → 무관측 유실.
2. **단일 커밋 소스**: rrn→birth 파생을 제출 직전 1회 확정값으로 고정(state race 차단).
3. **번들 드리프트 제거**: 라이브 kiosk 번들이 소스 최신과 일치하도록 재빌드·배포(§4 H2).
4. **백필 주의(⚠파괴적 금지)**: birth_date 는 rrn_enc → `fn_customer_birthdates`(서버복호) read-time
   파생 표기 중. 유실 4건 중 2건(rrn_enc 보유)은 read-time 복구 가능, 2건(rrn_enc 없음)은 원천 없음.
   소급 백필은 별도 게이트(대표/DA) — 본 티켓 범위 밖.

---

## 부록 — 실행 probe (read-only)
- `scripts/T-20260719-foot-SELFCHECKIN-BIRTHDATE-FE-LOSS-DIAG_probe.mjs`
  — PostgREST HEAD count-only(Prefer: count=exact). PII 값 미추출·무영속. §3 표 재현.
