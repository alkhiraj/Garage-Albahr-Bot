-- =============================================
--  جداول بوت كرت البحر — Supabase SQL
--  شغّلها في SQL Editor في Supabase
-- =============================================

-- 1. العملاء
CREATE TABLE IF NOT EXISTS jc_customers (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. السيارات
CREATE TABLE IF NOT EXISTS jc_cars (
  id          SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES jc_customers(id) ON DELETE CASCADE,
  brand       TEXT NOT NULL DEFAULT '',
  model       TEXT NOT NULL DEFAULT '',
  plate       TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 3. جلسات البوت (session state)
CREATE TABLE IF NOT EXISTS jc_sessions (
  chat_id    BIGINT PRIMARY KEY,
  state      TEXT NOT NULL DEFAULT 'idle',
  data       JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. كروت العمل
CREATE TABLE IF NOT EXISTS job_cards (
  id            SERIAL PRIMARY KEY,
  card_number   TEXT UNIQUE NOT NULL,
  customer_id   INTEGER REFERENCES jc_customers(id),
  car_id        INTEGER REFERENCES jc_cars(id),
  problem_notes TEXT DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'closed')),
  opened_at     TIMESTAMPTZ DEFAULT NOW(),
  closed_at     TIMESTAMPTZ
);

-- Indexes للسرعة
CREATE INDEX IF NOT EXISTS idx_job_cards_status     ON job_cards(status);
CREATE INDEX IF NOT EXISTS idx_job_cards_customer   ON job_cards(customer_id);
CREATE INDEX IF NOT EXISTS idx_jc_cars_customer     ON jc_cars(customer_id);
CREATE INDEX IF NOT EXISTS idx_jc_cars_plate        ON jc_cars(plate);
CREATE INDEX IF NOT EXISTS idx_jc_customers_phone   ON jc_customers(phone);

-- ملاحظة: لو عندك جداول customers/cars بالفعل في المشروع،
-- تقدر تربط job_cards بها بدل jc_customers/jc_cars
