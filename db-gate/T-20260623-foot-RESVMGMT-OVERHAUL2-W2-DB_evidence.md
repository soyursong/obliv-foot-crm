# T-20260623-foot-RESVMGMT-OVERHAUL2-W2-DB — DB-gate evidence
- db: rxlomoozakkjesdqjtvd | 2026-06-23T22:16:34.727Z | mode: AUDIT+APPLY
- ADDITIVE 2종: (1) reservations.brief_note TEXT (2) visit_route CHECK +네이버/+인콜(인바운드 존치, B안)
- DA GO MSG-igq8 (autonomy §3.1 대표게이트 면제·supervisor DDL-diff만)

## [A] read-only audit (pre) — DDL-diff 근거
```
reservations.brief_note (적용 전): 이미 존재
customers_visit_route_check (적용 전): CHECK (((visit_route IS NULL) OR (visit_route = ANY (ARRAY['TM'::text, '워크인'::text, '인바운드'::text, '지인소개'::text, '네이버'::text, '인콜'::text]))))
reservations_visit_route_check (적용 전): CHECK (((visit_route IS NULL) OR (visit_route = ANY (ARRAY['TM'::text, '워크인'::text, '인바운드'::text, '지인소개'::text, '네이버'::text, '인콜'::text]))))
```

## [B] apply (20260624100000_resvmgmt_overhaul2_w2.sql)
✅ brief_note ADD + visit_route CHECK 재생성(+네이버/+인콜, 인바운드 존치) 적용 완료

## [C] NOTIFY pgrst 'reload schema' 전송

## [D] post-verify
```
brief_note: brief_note | text | nullable=YES
customers_visit_route_check: CHECK (((visit_route IS NULL) OR (visit_route = ANY (ARRAY['TM'::text, '워크인'::text, '인바운드'::text, '지인소개'::text, '네이버'::text, '인콜'::text]))))
reservations_visit_route_check: CHECK (((visit_route IS NULL) OR (visit_route = ANY (ARRAY['TM'::text, '워크인'::text, '인바운드'::text, '지인소개'::text, '네이버'::text, '인콜'::text]))))
```

## [결과] PASS ✅
- reservations.brief_note TEXT NULL: OK
- customers CHECK 네이버/인콜 ADD + 인바운드 존치(legacy 비파괴): OK
- reservations CHECK 네이버/인콜 ADD + 인바운드 존치(legacy 비파괴): OK
- 롤백: 20260624100000_resvmgmt_overhaul2_w2.rollback.sql
