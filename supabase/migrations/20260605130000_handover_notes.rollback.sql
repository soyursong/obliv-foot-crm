-- Rollback: T-20260605-foot-HANDOVER-BOARD
-- 20260605130000_handover_notes.sql 역적용.
-- handover_checklist_items 가 handover_notes 를 FK 참조하므로 자식부터 drop.
-- (set_updated_at 함수는 notices 등 공용이므로 drop 하지 않음)

drop trigger if exists handover_notes_updated_at on public.handover_notes;

drop table if exists public.handover_checklist_items cascade;
drop table if exists public.handover_notes cascade;
