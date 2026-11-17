CREATE TABLE IF NOT EXISTS discount_vouchers (
  id CHAR(36) NOT NULL,
  code VARCHAR(40) NOT NULL,
  discount_type VARCHAR(12) NOT NULL CHECK (discount_type IN ('PERCENTAGE', 'FIXED')),
  discount_value INTEGER NOT NULL CHECK (discount_value > 0),
  starts_at TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  expires_at TIMESTAMP(3) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  PRIMARY KEY (id),
  CONSTRAINT uq_discount_vouchers_code UNIQUE (code),
  CONSTRAINT ck_discount_vouchers_expiry CHECK (expires_at > starts_at),
  CONSTRAINT ck_discount_vouchers_percentage CHECK (discount_type <> 'PERCENTAGE' OR discount_value BETWEEN 1 AND 100),
  CONSTRAINT ck_discount_vouchers_fixed CHECK (discount_type <> 'FIXED' OR discount_value <= 100000000)
);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(40),
  ADD COLUMN IF NOT EXISTS discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0);

CREATE INDEX IF NOT EXISTS idx_discount_vouchers_active ON discount_vouchers (code, starts_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_orders_coupon_code ON orders (coupon_code);
