CREATE TABLE IF NOT EXISTS orders (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  checkout_request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_id VARCHAR(80) NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  product_dose VARCHAR(100) NOT NULL,
  product_packaging VARCHAR(160) NOT NULL,
  unit_price_cents INT UNSIGNED NOT NULL,
  shipping_cents INT UNSIGNED NOT NULL DEFAULT 0,
  total_cents INT UNSIGNED NOT NULL,
  payer_name VARCHAR(150) NOT NULL,
  address_cep CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  address_street VARCHAR(180) NOT NULL,
  address_number VARCHAR(40) NOT NULL,
  address_complement VARCHAR(120) NULL,
  address_neighborhood VARCHAR(120) NOT NULL,
  address_city VARCHAR(120) NOT NULL,
  address_state CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  delivery_consent_at DATETIME(3) NOT NULL,
  pixgate_consent_at DATETIME(3) NOT NULL,
  research_consent_at DATETIME(3) NULL,
  payment_status ENUM('CREATING', 'PENDING', 'UNKNOWN') NOT NULL DEFAULT 'CREATING',
  pixgate_transaction_id VARCHAR(128) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_orders_checkout_request (checkout_request_id),
  UNIQUE KEY uq_orders_pixgate_transaction (pixgate_transaction_id),
  KEY idx_orders_created_at (created_at),
  KEY idx_orders_payment_status (payment_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_sessions (
  session_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (session_hash),
  KEY idx_admin_sessions_expiration (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
