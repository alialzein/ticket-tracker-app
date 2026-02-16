-- ============================================================
-- Migration: Add PREM client support columns to clients table
-- Run once in Supabase SQL Editor
-- ============================================================

-- Add client_type column (default 'saas' for all existing clients)
ALTER TABLE clients
    ADD COLUMN IF NOT EXISTS client_type TEXT NOT NULL DEFAULT 'saas'
        CHECK (client_type IN ('saas', 'prem'));

-- Add servers column: array of server objects with role, public_ip, private_ip
ALTER TABLE clients
    ADD COLUMN IF NOT EXISTS servers JSONB NOT NULL DEFAULT '[]';

-- Add bpal_url column: the B-PAL login URL for PREM clients
ALTER TABLE clients
    ADD COLUMN IF NOT EXISTS bpal_url TEXT;

-- Make SAAS-specific columns nullable so PREM clients can omit them
ALTER TABLE clients ALTER COLUMN private_ip  DROP NOT NULL;
ALTER TABLE clients ALTER COLUMN public_ip   DROP NOT NULL;
ALTER TABLE clients ALTER COLUMN smpp_port   DROP NOT NULL;
ALTER TABLE clients ALTER COLUMN http_port   DROP NOT NULL;
ALTER TABLE clients ALTER COLUMN dlr_port    DROP NOT NULL;

-- Verify
SELECT id, name, client_type, bpal_url, jsonb_array_length(servers) AS server_count
FROM clients
ORDER BY client_type, name
LIMIT 50;
