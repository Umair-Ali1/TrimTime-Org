-- ════════════════════════════════════════════════
-- TrimTime — Supabase Schema
-- Run this entire file in: Supabase Dashboard → SQL Editor → New query
-- ════════════════════════════════════════════════

-- 1. PROFILES (extends auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id        UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'customer',
  first_name TEXT,
  last_name  TEXT,
  phone      TEXT,
  city       TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. SALOONS
CREATE TABLE IF NOT EXISTS saloons (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  area       TEXT DEFAULT 'Lahore',
  city       TEXT DEFAULT 'Lahore',
  rating     NUMERIC(3,1) DEFAULT 4.5,
  reviews    INTEGER DEFAULT 0,
  price_from INTEGER DEFAULT 300,
  icon       TEXT DEFAULT '✂️',
  image_url  TEXT DEFAULT '',
  is_open    BOOLEAN DEFAULT TRUE,
  tags       TEXT[] DEFAULT '{}',
  address    TEXT,
  invite_code TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Add image_url to existing installs (safe to run multiple times)
ALTER TABLE saloons ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT '';

-- 3. SERVICES
CREATE TABLE IF NOT EXISTS services (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  saloon_id  UUID REFERENCES saloons(id) ON DELETE CASCADE,
  icon       TEXT DEFAULT '✂️',
  name       TEXT NOT NULL,
  price      INTEGER DEFAULT 300,
  duration   TEXT DEFAULT '30 min',
  active     BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. SEATS
CREATE TABLE IF NOT EXISTS seats (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  saloon_id   UUID REFERENCES saloons(id) ON DELETE CASCADE,
  seat_number INTEGER NOT NULL,
  status      TEXT DEFAULT 'available' CHECK (status IN ('available','occupied','reserved')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 5. BOOKINGS
CREATE TABLE IF NOT EXISTS bookings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  saloon_id      UUID REFERENCES saloons(id) ON DELETE SET NULL,
  saloon_name    TEXT,
  customer_name  TEXT,
  service        TEXT,
  sub_service    TEXT,
  barber         TEXT,
  date           TEXT,
  time           TEXT,
  price          INTEGER DEFAULT 0,
  status         TEXT DEFAULT 'confirmed' CHECK (status IN ('confirmed','pending','completed','cancelled')),
  payment_method TEXT DEFAULT 'cash',
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
-- Add customer_name to existing installs
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_name TEXT;

-- ════ SUSPENSION COLUMNS (run these in SQL Editor if upgrading existing install) ════
ALTER TABLE saloons  ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN DEFAULT false;

-- ════ APPROVAL COLUMNS (run these in SQL Editor if upgrading existing install) ════
-- DEFAULT 'approved' so existing salons are not affected
ALTER TABLE saloons ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'approved';
ALTER TABLE saloons ADD COLUMN IF NOT EXISTS decline_reason TEXT;

-- 6. EMPLOYEES
CREATE TABLE IF NOT EXISTS employees (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  saloon_id  UUID REFERENCES saloons(id) ON DELETE CASCADE,
  name       TEXT,
  role       TEXT DEFAULT 'Barber',
  rating     NUMERIC(3,1) DEFAULT 4.5,
  status     TEXT DEFAULT 'available',
  avatar     TEXT DEFAULT 'AB',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. REVIEWS
CREATE TABLE IF NOT EXISTS reviews (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  UUID REFERENCES bookings(id) ON DELETE CASCADE,
  reviewer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  saloon_id   UUID REFERENCES saloons(id) ON DELETE CASCADE,
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (booking_id)  -- one review per booking
);

-- ════ DISABLE ROW LEVEL SECURITY (for development) ════
-- These tables are readable/writable with the anon key.
-- Enable RLS with proper policies before going to production.
ALTER TABLE profiles  DISABLE ROW LEVEL SECURITY;
ALTER TABLE saloons   DISABLE ROW LEVEL SECURITY;
ALTER TABLE services  DISABLE ROW LEVEL SECURITY;
ALTER TABLE seats     DISABLE ROW LEVEL SECURITY;
ALTER TABLE bookings  DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE reviews   DISABLE ROW LEVEL SECURITY;


-- ════ ADMIN ACCOUNT SETUP ════
-- Step 1: Go to Supabase Dashboard → Authentication → Users → Add user
--         Email:    admin@trimtime.com
--         Password: Admin@1234
--         Uncheck "Send invite email"  →  click "Create user"
--
-- Step 2: Copy the UUID shown for that user, then run the INSERT below,
--         replacing '<PASTE-ADMIN-UUID-HERE>' with the actual UUID.
--
-- INSERT INTO profiles (id, role, first_name, last_name)
-- VALUES ('<PASTE-ADMIN-UUID-HERE>', 'admin', 'Admin', 'TrimTime')
-- ON CONFLICT (id) DO UPDATE SET role = 'admin';
--
-- NOTE: If you skip Step 2, the profile is created automatically the
-- first time admin@trimtime.com logs in through the website.
