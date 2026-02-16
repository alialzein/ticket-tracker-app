-- ============================================================
-- Seed: Insert all PREM clients
-- Run AFTER add_prem_client_columns.sql
-- Replace <YOUR_TEAM_ID> with the actual team UUID before running
-- (SELECT id FROM teams ORDER BY created_at LIMIT 1) to find your team id
-- ============================================================

-- Disable user-defined triggers so auth.uid() = NULL doesn't block the seed
ALTER TABLE clients DISABLE TRIGGER USER;

DO $$
DECLARE
    v_team_id UUID;
BEGIN
    -- Auto-resolve to the default (oldest) team
    SELECT id INTO v_team_id FROM teams ORDER BY created_at ASC LIMIT 1;

    -- --------------------------------------------------------
    -- Falcon 1
    -- --------------------------------------------------------
    INSERT INTO clients (name, client_type, bpal_url, servers, is_active, emails, team_id)
    VALUES (
        'Falcon 1',
        'prem',
        'bpal.falconinfosystems.com',
        '[
            {"role": "APP-SQL", "public_ip": "149.20.191.107", "private_ip": "192.168.20.10"},
            {"role": "GW",      "public_ip": "149.20.191.108", "private_ip": "192.168.20.12"}
        ]'::jsonb,
        true,
        ARRAY['sms.support@falconinfosystems.com','reddy@falconinfosystems.com'],
        v_team_id
    )
    ON CONFLICT DO NOTHING;

    -- --------------------------------------------------------
    -- Falcon 2
    -- --------------------------------------------------------
    INSERT INTO clients (name, client_type, bpal_url, servers, is_active, emails, team_id)
    VALUES (
        'Falcon 2',
        'prem',
        'fsbpal.falconinfosystems.com',
        '[
            {"role": "APP-SQL", "public_ip": "149.20.186.157", "private_ip": "10.20.90.20"},
            {"role": "GW",      "public_ip": "149.20.186.156", "private_ip": "10.20.90.10"}
        ]'::jsonb,
        true,
        ARRAY['sms.support@falconinfosystems.com','reddy@falconinfosystems.com'],
        v_team_id
    )
    ON CONFLICT DO NOTHING;

    -- --------------------------------------------------------
    -- Fusion
    -- --------------------------------------------------------
    INSERT INTO clients (name, client_type, bpal_url, servers, is_active, emails, team_id)
    VALUES (
        'Fusion',
        'prem',
        'smsdb.fusionbd.net',
        '[
            {"role": "APP-SQL",          "public_ip": "202.126.120.228", "private_ip": "10.10.100.228"},
            {"role": "GW",               "public_ip": "202.126.120.229", "private_ip": "202.126.120.229"},
            {"role": "SMS Portal Server","public_ip": "202.126.120.230"}
        ]'::jsonb,
        true,
        ARRAY['support@fusionbd.net','rony@fusionbd.net'],
        v_team_id
    )
    ON CONFLICT DO NOTHING;

    -- --------------------------------------------------------
    -- Icon Global
    -- --------------------------------------------------------
    INSERT INTO clients (name, client_type, bpal_url, servers, is_active, emails, team_id)
    VALUES (
        'Icon Global',
        'prem',
        'bpal.iconglobal.co.uk',
        '[
            {"role": "APP-SQL", "public_ip": "46.4.53.106"},
            {"role": "GW2",     "public_ip": "46.4.37.208"},
            {"role": "GW1",     "public_ip": "88.198.51.198"}
        ]'::jsonb,
        true,
        ARRAY['pallavi@iconglobal.co.uk','jaspreet@iconglobal.co.uk','bobby@iconglobal.co.uk'],
        v_team_id
    )
    ON CONFLICT DO NOTHING;

    -- --------------------------------------------------------
    -- Inet
    -- --------------------------------------------------------
    INSERT INTO clients (name, client_type, bpal_url, servers, is_active, emails, team_id)
    VALUES (
        'Inet',
        'prem',
        'Login.wrapsms.com',
        '[
            {"role": "APP-SQL", "public_ip": "149.20.187.236", "private_ip": "10.20.20.20"},
            {"role": "GW",      "public_ip": "149.20.187.235", "private_ip": "10.20.20.10"}
        ]'::jsonb,
        true,
        ARRAY['sms.noc@inetglobalservices.com','renu@inetglobalservices.com','nidhi@inetglobalservices.com','naveen@inetglobalservices.com'],
        v_team_id
    )
    ON CONFLICT DO NOTHING;

    -- --------------------------------------------------------
    -- InfoTelecom
    -- --------------------------------------------------------
    INSERT INTO clients (name, client_type, bpal_url, servers, is_active, emails, team_id)
    VALUES (
        'InfoTelecom',
        'prem',
        'smsbpal.infotelecom.al',
        '[
            {"role": "APP", "public_ip": "46.165.243.102",  "private_ip": "10.30.3.226"},
            {"role": "SQL", "public_ip": "46.165.251.201",  "private_ip": "10.30.3.229"},
            {"role": "GW",  "public_ip": "78.159.107.12",   "private_ip": "10.30.3.227"}
        ]'::jsonb,
        true,
        ARRAY['serxhio.xhaferaj@infotelecom-ics.com','rafael.selamaj@infotelecom-ics.com'],
        v_team_id
    )
    ON CONFLICT DO NOTHING;

    -- --------------------------------------------------------
    -- MontyMobile (no server IPs on record)
    -- --------------------------------------------------------
    INSERT INTO clients (name, client_type, bpal_url, servers, is_active, emails, team_id)
    VALUES (
        'MontyMobile',
        'prem',
        'billing.montymobile.com',
        '[]'::jsonb,
        true,
        '{}',
        v_team_id
    )
    ON CONFLICT DO NOTHING;

    -- --------------------------------------------------------
    -- OneWorld
    -- --------------------------------------------------------
    INSERT INTO clients (name, client_type, bpal_url, servers, is_active, emails, team_id)
    VALUES (
        'OneWorld',
        'prem',
        '1worldtecsms.com',
        '[
            {"role": "APP-SQL", "public_ip": "162.222.190.21"},
            {"role": "GW",      "public_ip": "162.222.190.22"}
        ]'::jsonb,
        true,
        ARRAY['rakesh@1worldtec.com','billing@1worldtec.com','kamal@1worldtec.com','noc@1worldtec.com'],
        v_team_id
    )
    ON CONFLICT DO NOTHING;

    -- --------------------------------------------------------
    -- Teways
    -- --------------------------------------------------------
    INSERT INTO clients (name, client_type, bpal_url, servers, is_active, emails, team_id)
    VALUES (
        'Teways',
        'prem',
        'billingz.teways.com',
        '[
            {"role": "APP-SQL", "public_ip": "54.228.173.117", "private_ip": "192.168.2.171"},
            {"role": "GW",      "public_ip": "99.80.181.173"}
        ]'::jsonb,
        true,
        ARRAY['ramsey.ezz@teways.com','support@teways.com'],
        v_team_id
    )
    ON CONFLICT DO NOTHING;

    -- --------------------------------------------------------
    -- Value First-Win
    -- --------------------------------------------------------
    INSERT INTO clients (name, client_type, bpal_url, servers, is_active, emails, team_id)
    VALUES (
        'Value First-Win',
        'prem',
        'admin.intvfirst.com',
        '[
            {"role": "APP-SQL", "public_ip": "3.6.72.121"},
            {"role": "GW",      "public_ip": "13.127.96.72",   "private_ip": "172.31.25.53"}
        ]'::jsonb,
        true,
        ARRAY['mukesh.k@vfirst.com','Simanta.anjan@vfirst.com','rajesh.bahl@vfirst.com','Jatin.Sehgal@vfirst.com','Ashu.Agarwal@vfirst.com','Debmalya.De@vfirst.com'],
        v_team_id
    )
    ON CONFLICT DO NOTHING;

    -- --------------------------------------------------------
    -- Vesper
    -- --------------------------------------------------------
    INSERT INTO clients (name, client_type, bpal_url, servers, is_active, emails, team_id)
    VALUES (
        'Vesper',
        'prem',
        'Bpal.vespertelecom.com',
        '[
            {"role": "SQL", "public_ip": "72.21.24.148", "private_ip": "72.21.24.139"},
            {"role": "APP", "public_ip": "72.21.24.152", "private_ip": "72.21.24.140"},
            {"role": "GW2", "public_ip": "72.21.24.153", "private_ip": "72.21.24.141"},
            {"role": "GW1", "public_ip": "72.21.24.149", "private_ip": "72.21.24.138"}
        ]'::jsonb,
        true,
        ARRAY['sms.noc@vespertelecom.com','ajay@vespertelecom.com','sahil@vespertelecom.com','prasad@vespertelecom.com'],
        v_team_id
    )
    ON CONFLICT DO NOTHING;

    -- --------------------------------------------------------
    -- Zentech
    -- --------------------------------------------------------
    INSERT INTO clients (name, client_type, bpal_url, servers, is_active, emails, team_id)
    VALUES (
        'Zentech',
        'prem',
        'https://admin.globalsms.ae/',
        '[
            {"role": "SQL", "public_ip": "86.96.206.107", "private_ip": "172.16.20.67"},
            {"role": "APP", "public_ip": "86.96.197.156", "private_ip": "172.16.20.15"},
            {"role": "GW",  "public_ip": "86.96.197.158", "private_ip": "172.16.20.11"}
        ]'::jsonb,
        true,
        ARRAY['rahul.chonsaliya@zen.ae','anand.jadhav@a2pmobility.com','smruti.chavan@a2pmobility.com','kavita.kadam@zen.ae'],
        v_team_id
    )
    ON CONFLICT DO NOTHING;

    -- --------------------------------------------------------
    -- Zentech LINUX
    -- --------------------------------------------------------
    INSERT INTO clients (name, client_type, bpal_url, servers, is_active, emails, team_id)
    VALUES (
        'Zentech LINUX',
        'prem',
        'http://core.globalsms.ae/Account/Login',
        '[
            {"role": "DB",  "public_ip": "86.96.206.113", "private_ip": "10.197.0.2"},
            {"role": "GW",  "public_ip": "86.96.206.119", "private_ip": "10.197.0.5"}
        ]'::jsonb,
        true,
        '{}',
        v_team_id
    )
    ON CONFLICT DO NOTHING;

    -- --------------------------------------------------------
    -- Saftelecom
    -- --------------------------------------------------------
    INSERT INTO clients (name, client_type, bpal_url, servers, is_active, emails, team_id)
    VALUES (
        'Saftelecom',
        'prem',
        'https://smsadmin.saftelco.com/',
        '[
            {"role": "sms-Rabbitmq01",  "public_ip": "10.50.50.12",  "note": "http://10.50.50.12:15672/"},
            {"role": "bpal-rabbitmq01", "public_ip": "10.50.50.19",  "note": "http://10.50.50.19:15672/"},
            {"role": "GW",              "public_ip": "185.106.240.16","private_ip": "10.50.50.11"}
        ]'::jsonb,
        true,
        '{}',
        v_team_id
    )
    ON CONFLICT DO NOTHING;

END $$;

-- Re-enable user-defined triggers
ALTER TABLE clients ENABLE TRIGGER USER;

-- Verify
SELECT name, client_type, bpal_url, jsonb_array_length(servers) AS servers_count
FROM clients
WHERE client_type = 'prem'
ORDER BY name;
