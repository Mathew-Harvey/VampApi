-- Add passwordHash to users if the column is missing (e.g. DB was created before init migration or out of sync).
-- Existing rows will have NULL; Prisma schema keeps passwordHash required, so run this only when the column is missing.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;

-- Backfill existing rows that have NULL so the column can stay NOT NULL in the schema.
-- Use a bcrypt hash that cannot be used to log in (hash of a long random placeholder).
-- Placeholder bcrypt hash (no known password); existing users must use Forgot Password.
UPDATE "users" SET "passwordHash" = '$2b$10$nOUIs5kJ7naTuTFkBy1veuK0kSxUFXfuaOKdOKf9xYT0KKIGSJwFa'
WHERE "passwordHash" IS NULL;

-- Enforce NOT NULL so schema and DB match.
ALTER TABLE "users" ALTER COLUMN "passwordHash" SET NOT NULL;
