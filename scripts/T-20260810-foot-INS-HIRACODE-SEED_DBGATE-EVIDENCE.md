# T-20260810-foot-INS-HIRACODE-SEED (B-1) — DB-GATE EVIDENCE

발톱(foot) `services.hira_code` 급여 수가코드 시드. 요양기관기호 **13328581** (4 CRM = 1 요양기관).
작성: dev-foot 2026-08-10. prod = rxlomoozakkjesdqjtvd (read-only REST 조회).

## 접지 원칙 (AC-1 · 1급 게이트)
★코드값 발명 절대 금지. 각 코드 = (a) 심평원 실조회 OR (b) 동일 요양기관 body/scalp2 기시드값 대조로만 접지.
미접지 = 시드 안 함 + BLOCK 명시 (AC-2, under-claim 안전원칙).

## prod 대상 5종 pre-apply 상태 (2026-08-10 조회 — 전건 hira_code=NULL)

| id | name | service_code | hira_code | hira_score | covered | active | price |
|---|---|---|---|---|---|---|---|
| de611ed5…d881 | 초진진찰료-의원 | AA154 | **null** | 197.12 | true | true | 18,840 |
| 117befad…a441 | 재진진찰료-의원 | AA254 | **null** | 139.85 | true | true | 13,370 |
| 1a82c70a…faa0 | 재진-물리치료,주사 등 시술받은 경우 | AA222 | **null** | 49.09 | true | true | 4,690 |
| 03189fa2…a48c | 단순처치 [1일] | M0111 | **null** | 75.51 | true | true | 7,220 |
| 8e401f7f…3e1d | 일반진균검사-KOH도말-조갑조직 | D620300HZ | **null** | 110.2 | true | true | 10,540 |

## 접지 매핑 {서비스명 → hira_code → 접지출처 → 점수대조}

### ✅ SEED (4종 — 접지 완료)

| # | 서비스명(foot) | → hira_code | 접지출처 | 점수 대조 |
|---|---|---|---|---|
| 1 | 초진진찰료-의원 | **AA154** | (b) body `services`(AA154, category=consultation, score **197.12**) 정확일치 + scalp2(AA154, 197.07) | foot 197.12 == body 197.12 ✅ |
| 2 | 재진진찰료-의원 | **AA254** | (b) body(AA254, **139.85**) + scalp2(AA254, **139.85**) 정확일치 | foot 139.85 == 139.85 ✅ |
| 3 | 재진-물리치료,주사 등(물리치료 재진) | **AA222** | (b) body(AA222, category=consultation, score **49.09**) 정확일치 — 시술받은 재진 진찰료(감산) 코드 | foot 49.09 == body 49.09 ✅ |
| 4 | 단순처치 [1일] | **M0111** | (a) 심평원 실조회: 단순처치[1일당], 상대가치 **75.51**, 급여구분=급여 (medinavi.co.kr/price/M0111 + 심평원 심사지침 카페 · HIRA 요양급여기준) | foot 75.51 == 심평원 75.51 ✅ |

- 부가 검증: 1~3 은 foot 자체 `service_code` 값(AA154/AA254/AA222)과도 일치 → hira_code = service_code 미러(독립 sibling 접지로 교차확인). 4 는 service_code=M0111 이며 심평원 조회로 독립 접지.

### ⛔ BLOCK (1종 — 미접지, 시드 제외)

| # | 서비스명(foot) | service_code | BLOCK 사유 |
|---|---|---|---|
| 5 | 일반진균검사-KOH도말-조갑조직 | D620300HZ (score 110.2) | (a) 심평원 web 실조회 불가: medinavi 호스트 접속거부(ECONNREFUSED) + 검색 미노출. (b) 동일 요양기관 sibling 부재: body KOH=**D7020**(28.5), foot 기시드 KOH=**D6591**(28.5) — 둘 다 '일반 균검사'로 본 대상(**조갑조직** 도말, **110.2**)과 다른 검사·다른 점수 → sibling 복사 = 오매핑(발명)에 해당하여 금지. **접지 확보(심평원 실조회) 후 별도 티켓에서 시드.** under-claim 안전원칙(plan §5). |

> 참고(비-본티켓): foot 기시드 KOH(D6591) vs body KOH(D7020) — 동일 요양기관인데 코드 상이(둘 다 score 28.5). cross-CRM 정합 이슈 후보이나 본 티켓 범위 밖(인접 코드 무접촉). planner 관측 대상으로만 남김.

## change-class / 게이트
- change_class = **DATA-ONLY DML** (기존 컬럼 `services.hira_code` 값-채움 · DDL 0 · 신규 컬럼/테이블/enum 0).
- §S2.4 DA CONSULT(스키마 게이트) = **대상 아님**(스키마 무변경). da_consult_ref = N/A(DML value-fill).
- 적용 게이트 = **supervisor DB-GATE GO-token** (apply_before_go 클래스 — GO-token 前 prod 선집행 금지). dev prod apply 0.
- 멱등/안전: 각 UPDATE = `WHERE id=<uuid> AND service_code=<code> AND hira_code IS NULL` → 재실행 0행·무클로버·매출/payments/service_charges 무접촉.

## 파일
- up: `supabase/migrations/20260810230000_foot_hira_code_seed_b1.sql`
- rollback: `supabase/migrations/20260810230000_foot_hira_code_seed_b1.rollback.sql`
- dryrun(No-Persistence, supervisor DB-GATE 에서 SUPABASE_DB_PASSWORD 로 실행): `…_b1.dryrun.mjs`

## dev 실행 증적
- prod pre-apply 5종 전건 hira_code=NULL 확인(위 표, REST read-only). prod WRITE 0.
- dryrun.mjs `node --check` 구문 PASS. (txn apply+verify+rollback 실행 = supervisor DB-GATE, DB password 보유 측)
