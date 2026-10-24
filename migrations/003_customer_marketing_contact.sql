ALTER TABLE customer_accounts
  ADD COLUMN IF NOT EXISTS phone VARCHAR(16);

ALTER TABLE customer_accounts
  ADD COLUMN IF NOT EXISTS whatsapp_marketing_consent_at TIMESTAMP(3);

ALTER TABLE customer_accounts
  ADD COLUMN IF NOT EXISTS whatsapp_marketing_revoked_at TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS idx_customer_marketing_consent
  ON customer_accounts (whatsapp_marketing_consent_at, created_at)
  WHERE whatsapp_marketing_consent_at IS NOT NULL;
