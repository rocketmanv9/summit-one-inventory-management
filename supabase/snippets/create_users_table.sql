-- Create users table to cache user info from auth service
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    email TEXT,
    name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON public.users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);

-- Function to upsert user info
CREATE OR REPLACE FUNCTION public.upsert_user_info(
    p_user_id UUID,
    p_tenant_id UUID,
    p_email TEXT DEFAULT NULL,
    p_name TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO public.users (id, tenant_id, email, name, last_seen_at)
    VALUES (p_user_id, p_tenant_id, p_email, p_name, NOW())
    ON CONFLICT (id) DO UPDATE SET
        email = COALESCE(EXCLUDED.email, users.email),
        name = COALESCE(EXCLUDED.name, users.name),
        last_seen_at = NOW(),
        updated_at = NOW();
END;
$$;

GRANT SELECT ON public.users TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_user_info TO authenticated, service_role;

COMMENT ON TABLE public.users IS 'Cached user information from auth service';
COMMENT ON FUNCTION public.upsert_user_info IS 'Upsert user information when they interact with the system';
