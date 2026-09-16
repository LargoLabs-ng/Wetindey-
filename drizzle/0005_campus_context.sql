-- University → campus → faculty → department, plus the three nullable
-- columns that attach a user to it. Everything additive.

DO $$ BEGIN
  CREATE TYPE department_status AS ENUM ('confirmed', 'provisional', 'pending', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS universities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(200) NOT NULL,
  short_name varchar(40) NOT NULL,
  slug varchar(200) NOT NULL UNIQUE,
  state varchar(100),
  country varchar(100) NOT NULL DEFAULT 'Nigeria',
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  university_id uuid NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  name varchar(200) NOT NULL,
  slug varchar(200) NOT NULL,
  city varchar(100),
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS campus_unique ON campuses (university_id, slug);

CREATE TABLE IF NOT EXISTS faculties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  university_id uuid NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  campus_id uuid REFERENCES campuses(id) ON DELETE SET NULL,
  name varchar(200) NOT NULL,
  slug varchar(200) NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS faculty_unique ON faculties (university_id, slug);

CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  university_id uuid NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  faculty_id uuid REFERENCES faculties(id) ON DELETE SET NULL,
  name varchar(200) NOT NULL,
  slug varchar(200) NOT NULL,
  status department_status NOT NULL DEFAULT 'provisional',
  -- Intentionally not a foreign key: users.department_id already points here,
  -- and referencing users back closes a type cycle Drizzle cannot resolve.
  suggested_by uuid,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS department_unique ON departments (university_id, slug);

ALTER TABLE users ADD COLUMN IF NOT EXISTS university_id uuid REFERENCES universities(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS campus_id uuid REFERENCES campuses(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES departments(id) ON DELETE SET NULL;
