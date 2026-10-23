CREATE TABLE IF NOT EXISTS orders (
  id CHAR(36) NOT NULL,
  checkout_request_id CHAR(36) NOT NULL,
  product_id VARCHAR(80) NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  product_dose VARCHAR(100) NOT NULL,
  product_packaging VARCHAR(160) NOT NULL,
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  shipping_cents INTEGER NOT NULL DEFAULT 0 CHECK (shipping_cents >= 0),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  payer_name VARCHAR(150) NOT NULL,
  address_cep CHAR(8) NOT NULL,
  address_street VARCHAR(180) NOT NULL,
  address_number VARCHAR(40) NOT NULL,
  address_complement VARCHAR(120),
  address_neighborhood VARCHAR(120) NOT NULL,
  address_city VARCHAR(120) NOT NULL,
  address_state CHAR(2) NOT NULL,
  delivery_consent_at TIMESTAMP(3) NOT NULL,
  pixgate_consent_at TIMESTAMP(3) NOT NULL,
  research_consent_at TIMESTAMP(3),
  payment_status VARCHAR(16) NOT NULL DEFAULT 'CREATING' CHECK (payment_status IN ('CREATING', 'PENDING', 'UNKNOWN')),
  pixgate_transaction_id VARCHAR(128),
  created_at TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  PRIMARY KEY (id),
  CONSTRAINT uq_orders_checkout_request UNIQUE (checkout_request_id),
  CONSTRAINT uq_orders_pixgate_transaction UNIQUE (pixgate_transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders (payment_status);

CREATE TABLE IF NOT EXISTS admin_sessions (
  session_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMP(3) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  PRIMARY KEY (session_hash)
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiration ON admin_sessions (expires_at);
