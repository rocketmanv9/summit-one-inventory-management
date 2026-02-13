-- Setup development user with tenant metadata for local testing
-- Run this to create a test user with proper tenant claims

BEGIN;

-- 1. Create tenant record
INSERT INTO public.tenants (id, name, slug, industry, metadata)
VALUES (
    'ae837809-1a24-4ab5-ba06-34fd98c05f48'::uuid,
    'Test Company',
    'test-company',
    'construction',
    '{}'::jsonb
)
ON CONFLICT (id) DO UPDATE
SET 
    name = EXCLUDED.name,
    slug = EXCLUDED.slug,
    updated_at = NOW(),
    synced_at = NOW();

-- 2. Create or update test user with tenant metadata
-- Email: test@example.com
-- Password: password123
DO $$
DECLARE
    v_user_id UUID;
BEGIN
    -- Check if user exists
    SELECT id INTO v_user_id
    FROM auth.users
    WHERE email = 'test@example.com';

    IF v_user_id IS NULL THEN
        -- Create new user
        INSERT INTO auth.users (
            instance_id,
            id,
            aud,
            role,
            email,
            encrypted_password,
            email_confirmed_at,
            raw_app_meta_data,
            raw_user_meta_data,
            created_at,
            updated_at,
            confirmation_token,
            recovery_token
        ) VALUES (
            '00000000-0000-0000-0000-000000000000',
            gen_random_uuid(),
            'authenticated',
            'authenticated',
            'test@example.com',
            crypt('password123', gen_salt('bf')),
            NOW(),
            jsonb_build_object(
                'tenant_id', 'ae837809-1a24-4ab5-ba06-34fd98c05f48',
                'role', 'admin',
                'modules', ARRAY['inventory']
            ),
            '{}',
            NOW(),
            NOW(),
            '',
            ''
        )
        RETURNING id INTO v_user_id;
        
        RAISE NOTICE 'Created new user with ID: %', v_user_id;
    ELSE
        -- Update existing user with tenant metadata
        UPDATE auth.users
        SET 
            raw_app_meta_data = jsonb_build_object(
                'tenant_id', 'ae837809-1a24-4ab5-ba06-34fd98c05f48',
                'role', 'admin',
                'modules', ARRAY['inventory']
            ),
            email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
            updated_at = NOW()
        WHERE id = v_user_id;
        
        RAISE NOTICE 'Updated existing user with ID: %', v_user_id;
    END IF;

    -- Create identity record if it doesn't exist
    INSERT INTO auth.identities (
        id,
        user_id,
        identity_data,
        provider,
        last_sign_in_at,
        created_at,
        updated_at
    )
    SELECT
        gen_random_uuid(),
        v_user_id,
        jsonb_build_object(
            'sub', v_user_id::text,
            'email', 'test@example.com'
        ),
        'email',
        NOW(),
        NOW(),
        NOW()
    WHERE NOT EXISTS (
        SELECT 1 FROM auth.identities 
        WHERE user_id = v_user_id AND provider = 'email'
    );
END $$;

COMMIT;

-- Verify the setup
SELECT 
    u.id,
    u.email,
    u.raw_app_meta_data->>'tenant_id' as tenant_id,
    u.raw_app_meta_data->>'role' as role,
    u.raw_app_meta_data->'modules' as modules,
    u.email_confirmed_at
FROM auth.users u
WHERE u.email = 'test@example.com';

SELECT * FROM public.tenants WHERE id = 'ae837809-1a24-4ab5-ba06-34fd98c05f48'::uuid;
