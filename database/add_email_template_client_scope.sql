-- ============================================================
-- Migration: Add client_scope to email_templates
-- Run in Supabase SQL Editor
--
-- client_scope controls which client type gets BCC'd when
-- an external template is loaded in the announcement modal:
--   'all'  → all active clients (SAAS + PREM)
--   'saas' → SAAS clients only
--   'prem' → PREM clients only
-- ============================================================

ALTER TABLE email_templates
    ADD COLUMN IF NOT EXISTS client_scope TEXT NOT NULL DEFAULT 'all'
        CHECK (client_scope IN ('all', 'saas', 'prem'));

-- Verify
SELECT id, name, template_type, client_scope FROM email_templates LIMIT 10;
