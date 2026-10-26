ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(16) NOT NULL DEFAULT 'avista';

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_payment_method_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_payment_method_check
  CHECK (payment_method IN ('avista', 'parcelado'));

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_payment_status_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status IN ('CREATING', 'PENDING', 'UNKNOWN', 'PARTIALLY_PAID', 'PAID'));

CREATE TABLE IF NOT EXISTS order_payments (
  id CHAR(36) NOT NULL,
  order_id CHAR(36) NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  payment_kind VARCHAR(12) NOT NULL CHECK (payment_kind IN ('FULL', 'DEPOSIT', 'BALANCE')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  payment_status VARCHAR(16) NOT NULL DEFAULT 'CREATING' CHECK (payment_status IN ('CREATING', 'PENDING', 'UNKNOWN', 'PAID')),
  pixgate_transaction_id VARCHAR(128),
  webhook_token_hash CHAR(64) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  PRIMARY KEY (id),
  CONSTRAINT uq_order_payments_transaction UNIQUE (pixgate_transaction_id),
  CONSTRAINT uq_order_payments_webhook_token UNIQUE (webhook_token_hash)
);

CREATE INDEX IF NOT EXISTS idx_order_payments_order ON order_payments (order_id, payment_kind);
