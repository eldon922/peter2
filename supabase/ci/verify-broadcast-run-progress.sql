-- Run after migration 072 in a disposable database.
BEGIN;
INSERT INTO auth.users (id,email,raw_user_meta_data) VALUES (md5('run-owner')::uuid,'run@example.test','{}');
INSERT INTO broadcasts (id,user_id,account_id,name,template_name,total_recipients,status)
SELECT md5('run')::uuid,user_id,account_id,'Run','test',10,'sent' FROM profiles WHERE user_id=md5('run-owner')::uuid;
INSERT INTO broadcast_recipients(id,broadcast_id,status)
SELECT md5('run-row-'||n)::uuid,md5('run')::uuid,CASE WHEN n<=8 THEN 'sent' ELSE 'failed' END FROM generate_series(1,10) n;
UPDATE broadcast_recipients SET status='pending' WHERE broadcast_id=md5('run')::uuid AND status='failed';
UPDATE broadcasts SET status='sending' WHERE id=md5('run')::uuid;
DO $$ BEGIN
 ASSERT (SELECT send_run_total=2 AND send_run_pending=2 AND send_run_baseline=8 FROM broadcasts WHERE id=md5('run')::uuid), 'retry must persist its two-recipient slice';
END $$;
UPDATE broadcast_recipients SET status='sent' WHERE id=md5('run-row-9')::uuid;
-- A late failure on an older send must not change progress for this retry.
UPDATE broadcast_recipients SET status='failed' WHERE id=md5('run-row-1')::uuid;
DO $$ BEGIN
 ASSERT (SELECT send_run_total=2 AND send_run_pending=1 FROM broadcasts WHERE id=md5('run')::uuid), 'retry must reach 50 percent independently of old status changes';
END $$;
UPDATE broadcast_recipients SET status='failed' WHERE id=md5('run-row-10')::uuid;
UPDATE broadcasts SET status='sent' WHERE id=md5('run')::uuid;
DO $$ BEGIN
 ASSERT (SELECT send_run_total=2 AND send_run_pending=0 FROM broadcasts WHERE id=md5('run')::uuid), 'completed retry must persist 100 percent for fresh reads';
END $$;
-- Row retry counts only the claimed recipient, not other failed rows.
UPDATE broadcast_recipients SET status='pending' WHERE id=md5('run-row-10')::uuid;
UPDATE broadcasts SET status='sending' WHERE id=md5('run')::uuid;
DO $$ BEGIN
 ASSERT (SELECT send_run_total=1 AND send_run_pending=1 FROM broadcasts WHERE id=md5('run')::uuid), 'individual retry must reset its total';
END $$;
INSERT INTO broadcasts (id,user_id,account_id,name,template_name,total_recipients,status)
SELECT md5('first-run')::uuid,user_id,account_id,'First run','test',3,'sending' FROM profiles WHERE user_id=md5('run-owner')::uuid;
INSERT INTO broadcast_recipients(broadcast_id,status)
SELECT md5('first-run')::uuid,'pending' FROM generate_series(1,3);
DO $$ BEGIN
 ASSERT (SELECT send_run_total=3 AND send_run_pending=3 FROM broadcasts WHERE id=md5('first-run')::uuid), 'initial recipient inserts must not double count pending';
END $$;
ROLLBACK;
