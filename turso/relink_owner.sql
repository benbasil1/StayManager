-- Only needed if you already have data from the Supabase days.
-- 1. Sign up in the new app with the same email. 2. Find the new id:  SELECT id, email FROM users;
-- 3. Replace OLD_ID (the old Supabase user id, see properties.owner_id) and NEW_ID, then run:
UPDATE properties SET owner_id = 'NEW_ID' WHERE owner_id = 'OLD_ID';
UPDATE files      SET owner_id = 'NEW_ID' WHERE owner_id = 'OLD_ID';
UPDATE feedback   SET user_id  = 'NEW_ID' WHERE user_id  = 'OLD_ID';
