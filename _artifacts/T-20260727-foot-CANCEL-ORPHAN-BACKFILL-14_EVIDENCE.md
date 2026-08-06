# T-20260727-foot-CANCEL-ORPHAN-BACKFILL-14 — READ-ONLY PREP EVIDENCE (freeze / dry-run / 판정근거 스냅샷)

- **작성**: dev-foot
- **일시(host)**: 2026-08-06T20:16Z
- **스크립트**: `scripts/T-20260727-foot-CANCEL-ORPHAN-BACKFILL-14_freeze_dryrun.mjs` (WRITE 0, service_role read-only)
- **DB**: rxlomoozakkjesdqjtvd (foot prod)
- **SOP**: Cross-CRM Data-Correction Backfill SOP — freeze / dry-run / 판정근거 스냅샷 단계 (apply 前 READ-ONLY prep, 티켓 허용 범위)

## 결론 (apply BLOCK · deploy-ready 미마킹)

**티켓 premise("14 취소 orphan 이 어느 outbox 에도 미발화 → canonical re-enqueue 필요")가 현 prod 상태에서 재현되지 않는다. re-enqueue 대상 = 0건.** 나아가 foot cancel 은 receiver 에서 all-time applied=false(SUPPRESS)라 재발화해도 수렴 0 — AC4(14/14 CONVERGED) 구조적 미달성. 따라서 apply 를 실행하지 않으며 deploy-ready 를 마킹하지 않는다. DA 재판정 필요(§ 블로커).

## 판정근거 스냅샷

| 항목 | 값 |
|---|---|
| freeze 지문 count (cancelled ∧ cancelled_at NULL ∧ source=dopamine ∧ external_id) | **36** |
| 지문셋 중 cancelled outbox 행 존재 | **36 / 36** |
| **TRUE ORPHAN (지문 ∧ outbox 부재) = re-enqueue 대상** | **0** |
| foot cancelled outbox status 분포 | duplicate 241 · failed 7(DLQ, invalid_cue_card_id_format) · **sent 0** · pending 0 |
| foot cancel `status='sent'`(applied=true) all-time | **전무** |
| dispatch `dopamine_callback_config.mode` | **live** (2026-07-05~) |

## 대상 고객 (PHI §4.3: reservation_id 로만 표기 — 티켓 본문 지목 고객)

- reservation `357be722-291c-42be-b85d-150a7aef4efb` · status=cancelled · **cancelled_at=NULL** · source_system=dopamine · external_id=4057cc56…
- **이미 outbox 행 존재**: `e684daf7-7bb4-400b-aff1-f54537a07837` · event_type=cancelled · event_id=357be722…(bare) · payload.occurred_at=`2026-07-15T01:09:15Z`(티켓의 "cancel 2026-07-15 01:09"과 일치) · status=**duplicate**(applied=false) · sent_at=2026-07-17T16:56.
- ⇒ 해당 고객 건은 **orphan 아님**. 취소 이벤트는 이미 enqueue·dispatch 됐으나 receiver 에서 applied=false 로 미수렴.

## 근본원인 재해석 (버그경로 지문 교집합)

1. `cancelled_at=NULL` 인 취소 36건은 pre-flip RPC 취소경로(`cancel_reservation_from_source`, cancelled_at 미설정) 산물. T-20260723 `ensure_reservation_cancelled_at` BEFORE 트리거 이전 상태.
2. 그럼에도 **36건 전부 outbox 행 보유** — bare event_id(=reservation_id) 로 이미 발화됨(과거 발화/백필 흔적). ⇒ "미발화 orphan" 가설 미성립.
3. 발화된 취소는 dispatch(config.mode=live) → `crm-lifecycle-callback` 로 POST 되나, **all-time 0건 applied=true**. 전량 `duplicate`(2xx applied:false, 멱등 성공취급). 이는 DA CONSULT-REPLY gjv7(depends_on 티켓 T-20260722 §11)의 **Q1=SUPPRESS(foot cancelled 영구 audit-only, live cancel writer SSOT=crm-cancel-callback 별 rail, 2nd live writer 거부)** 와 정합. 즉 foot outbox cancelled → crm-lifecycle-callback 경로는 **설계상 applied=false**.

## 블로커 (DA 소관 — §S2.4 데이터 정책 자문 게이트)

1. **premise 미재현**: re-enqueue 대상 0건. 대상 고객건(resv 357be722) 포함 36건 모두 이미 enqueue 됨. foot-side re-enqueue 는 UNIQUE(event_type,event_id) ON CONFLICT DO NOTHING 로 no-op 이거나, 신 키로 재삽입해도 동일 receiver 로 가 applied=false 재생산(노이즈·batch_tag 오염, 티켓 pending_dependency_note 경고와 일치).
2. **canon route 모순**: 티켓 route="foot outbox INSERT→canon EF" 인데, foot cancelled 의 실제 dispatch 타깃(`crm-lifecycle-callback`)은 DA gjv7 이 **영구 SUPPRESS(applied=false)** 로 확정한 rail. AC4(14/14 dopamine 미러 CONVERGED)를 이 rail 로는 달성 불가. live cancel writer SSOT(`crm-cancel-callback`)로의 foot 경로는 dispatch EF 라우팅에 부재.
3. **consult_ref 아티팩트 부재**: `da_replies/DA-20260716-FOOT-CANCEL-INBOUND-CHANNEL-ALREADY-DECIDED.md §5`(취소 저장방식/재발화 route 결정 원문)이 현 SSOT 트리에 미존재 → canonical route 판정 검증 불가.
4. **도파민 무접점 제약(AC5)**: 실 수렴 여부(applied=true)는 dopamine receiver 의 SUPPRESS 해소 결정에 달림. 이는 dev-dopamine/DA 소관이며, DA gjv7 은 오히려 "foot cancelled 영구 audit-only 유지"로 판정. foot-side 백필로 닫을 수 있는 갭이 아님.

## 권고

DA 재판정 요청:
- (A) 본 티켓 CLOSE/재정의 — premise 미재현 + SUPPRESS 정책과 상충. 대상 고객건(resv 357be722) 취소는 이미 발화·기록됨.
- 또는 (B) 실 갭이 "foot cancel 이 dopamine 에 live 미반영"이라면, 이는 dopamine receiver SUPPRESS 정책(DA gjv7) 재검토 축 → dev-dopamine 소관으로 재라우팅 (foot outbox 백필로는 미해결).

**본 prep 는 READ-ONLY(WRITE 0). apply·deploy-ready 미실행.**
