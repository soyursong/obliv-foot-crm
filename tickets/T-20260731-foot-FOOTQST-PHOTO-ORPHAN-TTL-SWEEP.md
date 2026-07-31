---
id: T-20260731-foot-FOOTQST-PHOTO-ORPHAN-TTL-SWEEP
domain: foot
priority: P2
status: in-progress (design + dry-run 완료 / 파괴 실행 미착수)
db_change: false
parent_ticket: T-20260731-foot-FOOTQST-PHOTO-UPLOAD
depends_on: T-20260731-foot-HEALTHQ-PHOTO-RETENTION-CODIFY (DONE)
da_ssot: da_decision_foot_healthq_photo_retention_20260731.md §3
e2e_spec_exempt_reason: db_only
---

# 발건강 질문지 사진 orphan TTL sweep (repo 사본)

> SSOT = `~/claude-sync/memory/_handoff/tickets/T-20260731-foot-FOOTQST-PHOTO-ORPHAN-TTL-SWEEP.md`.
> 본 사본은 dev-foot 산출물(술어 SQL·dry-run 러너·설계문) 앵커용.

## 수용 기준 (AC) — DA 3-교집합 정합화

1. **(reconciled)** orphan = `health_q_tokens.expires_at < now()` **AND** 대응 `health_q_results` 행 부재 **AND** 대응 `health_q_photos` 행 부재 **(3-교집합)**. `used_at IS NULL` freeze guard 로 진짜 미제출만 적격. 단일 기준(만료 단독·행부재 단독) blanket 삭제 금지.
   - ※ SSOT AC1 원문("만료 AND 행부재")→ 3-교집합으로 정합. planner lifecycle 갱신 제안(완료보고).
2. orphan 대상 Storage 오브젝트를 **archive-first 2단**(copy→delete)으로 정리. 즉시 hard-DELETE 금지·복원 가능 상태 경유·순소실 0.
3. 배치 **멱등**(재실행 안전).
4. **dry-run 모드로 대상목록·건수 먼저 산출(READ-ONLY)** → 실 삭제는 별도 gated 실행. ← **본 티켓 범위 = AC4 까지**.
5. 제출완료 사진(결과행/사진행 존재)은 **절대 대상 제외**. freeze-set 재검증, 혼입 시 batch abort.

## dev-foot 산출물
- `scripts/T-20260731-foot-FOOTQST-PHOTO-ORPHAN-TTL-SWEEP_orphan_predicate.sql` — canonical 술어 (READ-ONLY).
- `scripts/T-20260731-foot-FOOTQST-PHOTO-ORPHAN-TTL-SWEEP_dryrun.mjs` — dry-run 러너 (READ-ONLY, 대상목록·건수·freeze-set 스냅샷).
- `docs/HEALTHQ-PHOTO-ORPHAN-TTL-SWEEP-DESIGN.md` — 설계 + archive-first 파괴 실행 설계(미착수) + AC 정합.

## 선결 게이트 (파괴 실행 전 — 본 티켓 이후)
- supervisor 코드리뷰 + gated 실행. Archive-First SOP 봉투. manifest DB테이블 도입 시 data-architect CONSULT(§S2.4) 선행.
