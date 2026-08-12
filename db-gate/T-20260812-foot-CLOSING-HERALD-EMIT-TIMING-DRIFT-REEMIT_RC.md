# T-20260812-foot-CLOSING-HERALD-EMIT-TIMING-DRIFT-REEMIT — AC1 RC 확정 (READ-ONLY)

**작성**: dev-foot · 2026-08-12 · **write/DDL 0 (read-only prod introspection + repo grep)**
**probe**: `scripts/T-20260812-foot-CLOSING-HERALD-EMIT-TIMING-DRIFT_rc_probe.mjs` (+`_rc_probe2.mjs`)
**게이트 상태**: AC1(RC, read-only) 완료. **AC2/AC3(fix·정정)은 DA CONSULT-REPLY GO 선행 — 본 세션 미착수(gate 준수).**

---

## 결론 (한 줄)
티켓 RC 가설("자정 CF-5 **자동마감(prod 기능)** 이 매출 등재 前 emit → 사후 drift 재emit 부재")은 **부분적으로만 맞고 근본원인이 다르다.** 실제 RC = **critical-flow E2E 테스트 `CF-5-daily-closing.spec.ts` 가 PROD DB 에 가짜 'closed' daily_closings 행(80k, memo='CF-5 자동 마감 spec')을 심어 herald emit 을 발화시키고 rev0 outbox 슬롯을 선점 → 테스트는 daily_closings 행만 정리하고 outbox 행은 누수 → 그날 저녁 실제 EOD 마감의 정상 emit 이 `ON CONFLICT (clinic_id, close_date, revision) DO NOTHING` 으로 조용히 드롭됨.**

## AC1 3항 실측 판정

### (a) 신규 outbox created_at = 자정 발화? — **YES, 단 원천은 prod 자동마감이 아니라 E2E 테스트**
- 08-07~08-12 outbox: `created_at` = 00:01~00:47 KST, `memo='CF-5 자동 마감 spec'`, `total_amount_krw=80,000`, `single_card_total=80,000`, rev0, superseded=false, pending, reader-visible.
- **repo grep**: `foot` 레포에 CF-5 prod 자동마감 코드 **부재**. pg_cron 13개 job 중 마감 자동실행 job **없음**(closing 관련은 `foot-closing-confirmed-worker`=outbox 처리 워커뿐).
- `memo='CF-5 자동 마감 spec'`·80k·single_card=80k 는 `tests/e2e/critical-flow/CF-5-daily-closing.spec.ts` 의 `daily_closings.insert({... single_card_total:80000, memo:'CF-5 자동 마감 spec'})` **정확 일치**. 이 스펙은 `VITE_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` = **prod** 대상으로 CI(critical-flow job)에서 실행.

### (b) daily_closings 가 emit 이후 drift? — **YES (단 "payments 지연등재 drift" 가 아니라 test-artifact vs 실마감 별개 행)**
- 08-07: outbox(test) `created=00:13, total=80k` / daily_closings(실 EOD) `closed_at=20:46, rev0, sys_total=31,398,800`. 08-08/10/11 동형(evening 실마감 28.4M/30.9M/37.6M).
- 실마감 시각(closed_kst)이 test emit(00:xx)보다 **한참 뒤** = test 가 먼저 슬롯 선점, 실마감이 뒤늦게 도착.
- daily_closings memo: 08-07~08-11 은 `''`(실마감이 test memo 덮어씀), **08-12 만 아직 `'CF-5 자동 마감 spec'`**(오늘 실 EOD 미도래 → test 흔적 그대로) = test-origin 결정적 증거.

### (c) 재emit 트리거 부재? — **YES + 진짜 드롭 지점은 ON CONFLICT DO NOTHING**
- 08-06~08-12 각 일자 outbox `n_rows=1, max_rev=0, superseded=false` → 실마감의 재emit 이 **한 건도 없음**.
- `trg_enqueue_closing_confirmed` = AFTER INSERT/UPDATE, **entering-closed(status→closed) 진입 시에만** 발화(`IF NOT v_entering_closed THEN RETURN`). daily_closings 순수 UPDATE(구성분 drift)엔 재emit 없음.
- **결정적 드롭 지점**: 실 EOD 마감(신규 daily_closings, revision=0) → enqueue → `UPDATE ... WHERE revision < 0`(no-op) → `INSERT (clinic,date,rev0) ... ON CONFLICT (clinic_id, close_date, revision) DO NOTHING` → **test 가 선점한 rev0 슬롯과 충돌 → 실 31M payload 조용히 드롭.** stale 80k(test)만 reader-visible 잔존.
- 대조군: 08-04/08-05 는 부모 reemit 스크립트가 unlock→reconfirm 로 **rev1 신규 슬롯** 발행(rev0 supersede) → 정상(25.9M/5.59M). 08-06 은 daily_closings closed 행 부재(reopen/삭제)로 reconfirm 불가 → rev0 failed/dlq 고착.

## 실측 원본
```
outbox(a): 08-07 rev0 80,000 created 00:13 memo='CF-5 자동 마감 spec' pending superseded=false
           08-08 00:01 / 08-10 00:22 / 08-11 00:46 / 08-12 00:40 (동형 80k)
dc(b):     08-07 closed rev0 closed@20:46 sys_total=31,398,800 memo=''
           08-08 @18:54 28,389,600 / 08-10 @20:50 30,934,600 / 08-11 @22:41 37,641,200 / 08-12 @16:01 80,000 memo='CF-5 자동 마감 spec'(실EOD 미도래)
reader:    08-07~08-12 전건 rev0 total=80,000 (현장 오보 재현)
```

## RC 가 재정의하는 fix 후보 (AC2 = DA 소관 · 본 세션 미결정)
티켓 AC2 가 제시한 (i)emit-시점 재정의 / (ii)사후 drift 재emit 보다 **상위 축**이 드러남:
1. **테스트 격리(test-to-prod 오염 차단)** — CF-5(및 cross-CRM 동종 spec)가 prod DB 에 쓰지 않도록(전용 test project) 또는 outbox 행까지 cleanup(현재 daily_closings+payments 만 삭제, **outbox 누수**). → CI/test lane(dev-meta?) 가능성, DDL 무관할 수 있음.
2. **enqueue ON CONFLICT 계약 재정의** — 실마감 emit 이 stale/test 아티팩트 슬롯과 충돌 시 조용히 드롭하지 말 것(예: 기존 행이 superseded/미발송이면 supersede-and-reinsert 또는 revision bump). = 트리거 fn DDL → **outbox close_date당 revision cardinality 계약 + payload split 정합 spec 영향** → DA 게이트.
3. **기존 오염 정정(AC3)** — 08-06~08-11 재emit(revision+1)/supersede + reader 신 rev 수렴.
4. **cross-CRM parity** — body/derm/scalp2 가 동일 CF-5 spec + 동일 ON CONFLICT 를 가지면 동종 결함 잠재 → DA 조율(확산 판단).

→ 어느 후보든 outbox 계약·payload split 정합·cross-CRM parity 를 건드림 = **DA CONSULT-REPLY GO 없이 DDL/정정 착수 금지**(§S2.4, 티켓 AC2, Q2). 본 세션은 RC 확정 + DA CONSULT 발행 + planner FOLLOWUP 에서 종료.
