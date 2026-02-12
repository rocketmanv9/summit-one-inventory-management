-- Update summit_bot password to new value
ALTER USER summit_bot WITH PASSWORD '03d70dd00ecbabe9443ffae9';

-- Verification notice
DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'summit_bot PASSWORD UPDATED';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'New Password: 03d70dd00ecbabe9443ffae9';
  RAISE NOTICE '========================================';
END
$$;
