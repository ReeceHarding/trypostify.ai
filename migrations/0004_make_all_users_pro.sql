ALTER TABLE "user" ALTER COLUMN "plan" SET DEFAULT 'pro';

-- Update all existing users to pro plan
UPDATE "user" SET "plan" = 'pro' WHERE "plan" = 'free';