# T-20260729-foot-REDPAY-DETECT-SENSOR-KEY-REWIRE — evidence

**성격**: observability wiring only (dev 배선 env). db_change=false · no-DDL · no-prod-deploy ·
no-EF-code-change · UI 무변경. GO_WARN(리스크#2 service_role secret 취급). 2026-07-29 KST.

부모: T-20260729-foot-REDPAY-RECONCILE-EF-ENVSHADOW-4TH-LOCUS (DEPLOYED/Green). supervisor ★후속 발번 권고.

---

## 진원 (RC 확정)

- 프로젝트 신규 Supabase API 키 체계 마이그 → reconcile EF(D) 런타임 주입 `SUPABASE_SERVICE_ROLE_KEY`
  = **신 secret key(`sb_secret_…`)**.
- 그러나 macstudio valuecheck/poller 배선 `~/GitHub/obliv-foot-crm/.env.local` 의
  `SUPABASE_SERVICE_ROLE_KEY` = 여전히 **legacy service_role JWT(`eyJ…`, len 219)**.
- DETECT 자동 회귀센서 `valuecheck --ef` 가 D introspect(`GET ?introspect=whitelist` +
  `Authorization: Bearer <SERVICE_ROLE_KEY>`)에 legacy 키 전송 → EF `bearer !== SUPABASE_SERVICE_ROLE_KEY`
  (index.ts L297) → **401 `unauthorized_introspection`** → D 지문 미확보 → 4주체→3주체 축소.
- 근본원인 = **배선 env 키 미정렬**(코드결함/재배포 아님).

### 3-key ground-truth (empirical introspect auth test, 값 비노출)

| 후보 키 | scheme | D introspect 결과 |
|---------|--------|-------------------|
| legacy service_role | `eyJ…` (JWT, len 219) | **401** unauthorized_introspection |
| **신 secret (default)** | **`sb_secret_…` (len 41)** | **200** subject=reconcile-ef, tid_count=40 ✅ |
| publishable (default) | `sb_publ…` (len 46) | 401 unauthorized_introspection |

→ EF 런타임 주입값 = 신 secret key(`sb_secret_…`) 로 확정. Supabase Management API
`GET /v1/projects/rxlomoozakkjesdqjtvd/api-keys?reveal=true` (type=secret) 로 획득.

---

## AC 결과

### AC-1 — 배선 env 키 정렬 ✅
- `~/GitHub/obliv-foot-crm/.env.local` 의 `SUPABASE_SERVICE_ROLE_KEY` → 신 secret key(`sb_secret_…`, len 41).
  legacy JWT 제거(`grep -c '^SUPABASE_SERVICE_ROLE_KEY=eyJ' .env.local` = **0**).
- 그 라인 외 무변경(diff = redacted key 만).
- rollback: `~/.env.local.foot.bak.pre-REDPAY-DETECT-REWIRE` (chmod 600).

### AC-2 — DETECT 센서 재실행 → D 200 + 4주체 fold 합의 자동 재현 ✅
`node scripts/redpay_envshadow_valuecheck.mjs --ef` (env: `.env.local` source + `SUPABASE_URL`), exit **0**(합의):

```
[poller]       tid(count=40 sha256=aa74b84d03ddf561)
[watchdog]     tid(count=40 sha256=aa74b84d03ddf561)
[reconcile-ef] tid(count=40 sha256=aa74b84d03ddf561)   ← D 200 복원
── 4-way VALUECHECK fold ──
  TID      fold : 합의 ✅ 참여=[poller, watchdog, reconcile-ef]
  merchant fold : 합의 ✅ 참여=[poller, watchdog, reconcile-ef]
  reconcile-EF(D) 편입: ✅ 4주체 대조 성립
═══ 종합: NO_ENV_SHADOW · REGUNION-FIX 실효(수렴) · 4-way TID fold 합의 ═══
```

- **부모 실증값 대조 PARITY ✅**: D `tid_count=40`,
  `tid_sha256=aa74b84d03ddf561e27df1d745fad168610773c2f4e3314da97464ab1aa5296f` (부모 count=40/sha256=aa74b84d 완전 일치).
- D 편입 복원 = 4주체(A poller·B watchdog·C webhook-EF·D reconcile-EF) 상시 대조 회복.
  (TID fold 참여=A·B·D — C=webhook-EF 는 설계상 TID 미보유 → TID fold 비참여. 무관.)
- raw evidence: `ac2-post-rewire-4way-fold.json`.

### AC-3 — secret 안전 ✅
- 신 secret key 값: 커밋/로그/티켓/MQ/evidence **평문 노출 0건**
  (`grep -cE 'sb_secret_|eyJhbGc' ac2-post-rewire-4way-fold.json` = **0**).
- 주입 위치: `.env.local` 단독 — `git check-ignore .env.local` = IGNORED ✅,
  `git ls-files` = UNTRACKED ✅. 백업파일 chmod 600. reveal-temp 즉시 secure-purge.

### AC-4 — live 매칭 경로(x-internal-cron) 무접촉 ✅
- introspect route 는 결제/매칭 POST 경로와 완전 격리(index.ts top early-return, read-only·no-DB-write·PHI 무접촉).
- live cron 매칭 인증축 = `x-internal-cron`/`INTERNAL_CRON_SECRET` (index.ts L306) — introspect Bearer 과 별개 축.
- 변경 대상 = `.env.local`(read-only 센서 전용 배선) **단 1파일**.
  - poller live 적재 secret `~/.env.redpay-foot` **무접촉**(mtime Jul 28, 미변경).
  - reconcile EF source `supabase/functions/redpay-reconcile/` **무변경**(git status clean).
- ⇒ 실서비스 매칭/수납/매출 write 회귀 표면 **0**.

---

## 종합
배선 env 키 미정렬(legacy JWT) → 신 secret key 정렬로 DETECT 자동센서 D 상시 편입 복원.
4주체 TID fold 합의(count=40, sha256=aa74b84d) 자동 재현. behavior 변화 0(관측성 배선 only).
