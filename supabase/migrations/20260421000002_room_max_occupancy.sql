-- foot-039: Room max occupancy
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS max_occupancy INTEGER NOT NULL DEFAULT 2;

-- Set defaults per room type
UPDATE rooms SET max_occupancy = 1 WHERE room_type IN ('laser', 'consultation', 'examination');
UPDATE rooms SET max_occupancy = 2 WHERE room_type = 'treatment';
