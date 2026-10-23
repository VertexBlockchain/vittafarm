CREATE TABLE IF NOT EXISTS customer_accounts (
  id CHAR(36) NOT NULL,
  email VARCHAR(254) NOT NULL,
  display_name VARCHAR(120) NOT NULL DEFAULT '',
  password_salt CHAR(32) NOT NULL,
  password_hash CHAR(128) NOT NULL,
  account_consent_at TIMESTAMP(3) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  PRIMARY KEY (id),
  CONSTRAINT uq_customer_accounts_email UNIQUE (email)
);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS customer_id CHAR(36) REFERENCES customer_accounts(id) ON DELETE SET NULL;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS webhook_token_hash CHAR(64);

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_payment_status_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status IN ('CREATING', 'PENDING', 'UNKNOWN', 'PAID'));

CREATE TABLE IF NOT EXISTS customer_sessions (
  session_hash CHAR(64) NOT NULL,
  customer_id CHAR(36) NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  expires_at TIMESTAMP(3) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  PRIMARY KEY (session_hash)
);

CREATE INDEX IF NOT EXISTS idx_customer_sessions_customer ON customer_sessions (customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_expiration ON customer_sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_orders_customer_created ON orders (customer_id, created_at DESC);
