-- #23: 슬롯별 수용 인원·오버부킹률 조절
ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS max_per_slot INTEGER DEFAULT 2,
  ADD COLUMN IF NOT EXISTS overbooking_rate NUMERIC(3,2) DEFAULT 1.30;

UPDATE clinics
  SET max_per_slot = 2, overbooking_rate = 1.30
  WHERE slug = 'jongno-foot'
    AND (max_per_slot IS NULL OR overbooking_rate IS NULL);
