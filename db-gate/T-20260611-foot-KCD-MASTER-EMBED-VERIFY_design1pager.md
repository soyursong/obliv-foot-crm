# T-20260611-foot-KCD-MASTER-EMBED-VERIFY — 개선방향 1-pager (AC-0 design-first 게이트)

> 상태: **planner 검토 대기 → supervisor DB게이트 → 구현 GO**. GO 전 DB 마이그 apply·코드 commit 금지.
> 작성: dev-foot / 2026-06-12 · db_change=true · risk GO_WARN
> 원문: 문지은 대표원장 (thread 1781180848.308769) — "같은 코드로 이름 두개 있는 이유?" → "KCD 그대로 가져오는 방식이 안전… 검증된 상병명만 추가 가능하게" → "응 내장 일단 해주고 주기적 검증도 좋을듯해".

## 0. 한 줄 요약
이미 deploy된 2겹(① `KCD8_RE` 형식 regex = T-20260610, ② clinic 전체 same-code 차단 + 검색클릭 입력잠금 + FE 내장 번들 `kcdData.ts`/`isKnownKcdCode` = T-20260611-BUNDLE-LOCKDOWN) 위에 **③ 공식 KCD 마스터를 DB에 내장(`kcd_codes` 테이블, body CRM 스키마 cross-fork) + ④ 주기 reconcile(코드/이름 마스터 불일치 자동 적발, 자동수정 X) + ⑤ 현재 '같은 코드 두 이름' audit**을 additive로 얹는다. **부모 형식검증(regex)·번들 검색클릭은 제거 금지** — 형식+마스터멤버십 이중검증 유지.

## 1. 현황 진단 (foot 코드 실측, 2026-06-12)

### 이미 있는 자산 (이 위에 얹음, 중복신설 금지)
| 자산 | 위치 | 역할 |
|---|---|---|
| `KCD8_RE` 형식 regex | `src/lib/diagnosisCode.ts:12` | `^[A-Z][0-9]{2,4}(\.[0-9]{1,4})?$` — 부모 형식검증. **유지** |
| `isDuplicateServiceCode()` | `diagnosisCode.ts:52` | clinic 전체 same-code(dotless 동치) 차단 → 신규 중복 입력 이미 봉쇄 |
| FE 내장 번들 | `src/lib/kcd/kcdData.ts` | `KCD_DATASET` ~70건 **PROVISIONAL** (foot/MSK 큐레이션), 코드 split dynamic import |
| 멤버십/검색 | `src/lib/kcd/kcdSearch.ts` | `isKnownKcdCode()` `getKcdByCode()` `searchKcd()` — 번들 in-memory 멤버십(이미 존재) |
| 입력 잠금 | `DiagnosisNamesTab.tsx` `KcdComboBox` | 자유타이핑 차단 = 검색→클릭만 (`handleSave` line 825, `selectedKcd` 가드 line 1263) |
| 저장 위치 | `services` (`category_label='상병'`) | `service_code`(KCD) + `name`. 별도 상병 마스터 없음(SSOT=services) |

### foot 인프라 가용성 (확인 완료)
- `is_admin_or_manager()` 헬퍼 존재(RLS 재사용 가능) · `pg_cron`(cron.schedule) 사용 선례 존재(messaging_module) → 주기 reconcile 구현 가능.

### body CRM 재사용 원천 (cross-fork 대상, done)
- 테이블 `public.kcd_codes` (`20260515000010_kcd_codes.sql` 외 4개 마이그) — `code TEXT UNIQUE`(dotless 정규화)·`name_ko`·`is_seed`·`is_active`·`sort_order`·`category`('질병'/'상해')·`body_region`. RLS = read `USING(true)` + write `is_admin_or_manager()`. **정적 1회 INSERT seed(~64행), live API/cron 없음.**

## 2. AC-0 (1) KCD 마스터 원천 — body 재사용 여부 [결정 필요]
- **스키마·RLS·적재패턴 = body `kcd_codes` cross-fork 재사용** (경쟁모델 신설 금지 준수).
- **데이터(원천)는 foot 고유**: body seed는 척추·MSK(경추/요추/어깨…) 중심 → 발/족부와 불일치. v0 seed = **foot 기존 번들 `kcdData.ts`(~70건, 이미 현장 큐레이션)** 를 DB로 승격. 최종 prod = 공식 KCD-8 전수(통계청 통계분류포털/KOICD) **drop-in 교체**(BUNDLE-LOCKDOWN이 약속한 교체를 FE→DB로 위치만 이동).
- **DB 채택 근거**(번들 유지 대비): (a) "주기적 검증"은 서버측 services↔master 대조가 필요 → FE 번들로는 불가, DB라야 cron 가능. (b) 공식 8만건은 FE 번들로 싣기엔 과대(MB급) → DB+서버검색이 확장적. (c) "검증된 상병만 추가"를 admin 관리 마스터+RLS로 거버넌스.
- **하이브리드 권고**: DB `kcd_codes` = SSOT. FE 번들은 **DB에서 생성·동기된 스냅샷**으로 유지(저장시점 멤버십 UX는 sub-ms 유지) — v0 ~70건은 그대로, 8만건 단계에서 멤버십을 DB RPC로 전환.

## 3. AC-0 (2) 내장 스키마 DDL + RLS + 롤백SQL (draft, GO 후 확정)
```sql
-- forward (supervisor DB게이트 dry-run 후)
CREATE TABLE IF NOT EXISTS public.kcd_codes (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        text NOT NULL UNIQUE,            -- 정본 표기 정책은 §결정 필요
  name_ko     text NOT NULL,
  is_seed     boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 999,
  category    text NOT NULL DEFAULT '질병',     -- '질병' | '상해'
  source      text,                            -- 'curated-foot-v0' | 'KOICD-8-YYYYMMDD'
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kcd_codes_active_seed
  ON public.kcd_codes (is_seed DESC, sort_order) WHERE is_active;
ALTER TABLE public.kcd_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY kcd_codes_read_all   ON public.kcd_codes FOR SELECT USING (true);
CREATE POLICY kcd_codes_write_ins  ON public.kcd_codes FOR INSERT WITH CHECK (is_admin_or_manager());
CREATE POLICY kcd_codes_write_upd  ON public.kcd_codes FOR UPDATE USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY kcd_codes_write_del  ON public.kcd_codes FOR DELETE USING (is_admin_or_manager());
-- seed: kcdData.ts 70행 → INSERT ... ON CONFLICT (code) DO NOTHING (멱등)

-- rollback
DROP TABLE IF EXISTS public.kcd_codes CASCADE;
```
- **★ body는 dotless 저장(M545)**, **foot 번들은 dotted 정본(M72.2)** + dotless 비교키. 마스터 `code` 표기 정책 **택1 필요**(권고: foot 일관성 위해 **dotted 정본 저장 + `codeCompareKey` dotless 동치 비교** 유지). UNIQUE는 dotless 정규화 컬럼/인덱스로 보강.
- `body_region`(척추 10부위)은 foot 부적합 → **v0 제외**(필요 시 후속 `region` nullable).
- audit findings용 보조 테이블(§6)도 동일 마이그에 포함.

## 4. AC-0 (3) 검증 훅 위치 + 부모 regex 결합 + 시퀀싱
- **2겹 → 3겹 직렬 (제거 없음)**: `handleSave()`(`DiagnosisNamesTab.tsx:825`)에서
  1. `validateServiceCode()` 형식 regex (T-20260610) — **유지**
  2. `isDuplicateServiceCode()` clinic same-code (T-20260611) — **유지**
  3. **(신규)** 마스터 멤버십: `isKnownKcdCode(code)` 이미 존재 → 번들이 DB 스냅샷이 되도록 결선. **+ 이름정본 검증**: 코드가 마스터에 있으면 입력 `name` == 마스터 `name_ko` 강제(불일치 차단) → "같은 코드 두 이름" 근절.
- **멤버십 출처**: v0 = FE 번들(`isKnownKcdCode`, sub-ms) / 8만건 단계 = DB RPC. 둘 다 검색→클릭 구조라 자연 충족, 저장 직전 방어용 이중.
- **시퀀싱(병합충돌 회피)**: 동일 파일 `DiagnosisNamesTab.tsx`를 **DIAGNOSIS-MASTER-MGMT(in_progress 보고)** 가 능동수정 중. → **그 ticket의 push 베이스 머지 완료 후** 그 위에 본 훅을 얹음. **[planner 확인 필요]** DIAGNOSIS-MASTER-MGMT의 현재 상태(merge됨? 진행중?)·push 베이스 SHA — git log엔 미머지 브랜치 흔적 없음, 실제 상태 회신 요청.

## 5. AC-0 (4) 주기 검증 cadence / 방식
- **pg_cron 주간(weekly) `kcd_reconcile()`**: `services`(category_label='상병', service_code NOT NULL) 전수 스캔 →
  - (a) 멤버십: `service_code` ∉ `kcd_codes` → finding `not_in_master`
  - (b) 이름정본: 코드는 마스터에 있으나 `services.name` ≠ `kcd_codes.name_ko` → finding `name_mismatch`
  - (c) 중복: 한 코드 2+ 이름(§6) → finding `dup_code_multi_name`
- 결과는 **`kcd_audit_findings`(read-only 리포트, status='open')** 에 적재만 → admin UI 노출. **자동 UPDATE/DELETE 절대 없음** (현장 confirm 후 수기 정정).
- cadence 권고 weekly(데이터 변동 적음). body엔 reconcile 없음 → 신규 자산. **[결정] 주기 weekly vs daily, + admin '지금 검증' 수동버튼 동봉 여부.**

## 6. AC-0 (5) 현재 중복 audit + dedup 방침
- **audit 쿼리(READ-ONLY, 멤버십 검증·dedup 금지)** — supervisor read 게이트로 prod 실행 후 수치 첨부 예정(이 세션엔 prod 크레덴셜 없어 미실행):
```sql
SELECT service_code,
       count(DISTINCT name)         AS name_count,
       string_agg(DISTINCT name,' | ') AS names,
       count(*)                     AS row_count,
       array_agg(id)                AS ids
FROM   services
WHERE  category_label = '상병' AND service_code IS NOT NULL
GROUP  BY service_code
HAVING count(DISTINCT name) > 1
ORDER  BY row_count DESC;
```
- **dedup 방침(자동수정 절대 금지·현장 confirm 전 실행 금지)**: 적발 건은 문지은 원장께 목록 제시 → **코드별 정본 이름 1개를 현장이 택1** → 수기 병합. 신규 중복은 `isDuplicateServiceCode`가 이미 차단 중이므로 audit 대상 = pre-validation 잔존 row.

## 7. planner 검토 → GO 필요 항목 (회신 요청)
1. **마스터 위치: DB `kcd_codes`(권고, body 스키마 재사용) vs 현 FE 번들 유지** — 주기검증 위해 DB 권고. 승인?
2. **code 표기 정본: dotted(M72.2, foot 일관) vs dotless(M545, body 일관)** — dev 권고 = dotted 저장 + dotless 동치비교.
3. **v0 seed 원천: foot 기존 `kcdData.ts` 70건 승격** 동의? (body 척추 데이터 미사용 / 공식 8만건은 후속 drop-in)
4. **주기 reconcile: weekly + 수동버튼** 동의? `kcd_audit_findings` 테이블 신설 동의?
5. **DIAGNOSIS-MASTER-MGMT 현재 상태·push 베이스 SHA** — 병합충돌 회피용 시퀀싱 정보.
6. 위 확정 후 **supervisor DB게이트(dry-run+롤백)** 경유 → AC-1~5(마이그·코드·E2E) 착수. GO 없이 apply/commit 금지.
