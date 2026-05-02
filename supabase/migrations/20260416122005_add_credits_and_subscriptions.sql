/*
  # Credits & Subscription System

  ## Overview
  Adds a pay-as-you-go credit system. Users who don't have their own API key
  consume credits from the admin's platform API key. Admin can grant credits
  to users manually from the admin panel.

  ## New Tables

  ### `user_credits`
  - `user_id` (uuid, FK auth.users) — one row per user
  - `balance` (integer) — current credit balance (each AI request costs 1 credit)
  - `total_purchased` (integer) — lifetime total credits added
  - `updated_at` (timestamptz)

  ### `credit_transactions`
  - `id` (uuid, primary key)
  - `user_id` (uuid, FK auth.users)
  - `amount` (integer) — positive = added, negative = consumed
  - `reason` (text) — "admin_grant", "ai_request", "manual_topup"
  - `note` (text) — optional admin note
  - `created_at` (timestamptz)

  ## Changes to Existing Tables
  - `profiles`: add `is_admin` boolean, `subscription_tier` text (free/pro/unlimited)

  ## Security
  - RLS on all new tables
  - Users can only read their own credits
  - Only service role / edge function can write credits (enforced via RLS policy check)
  - Admins identified by `is_admin = true` in profiles table

  ## Notes
  - Free tier: 10 free credits on signup
  - Each platform API request = 1 credit deducted
  - Users with own API key bypass credit check entirely
  - Admin can grant unlimited credits from admin panel
*/

-- Add admin and subscription fields to profiles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'is_admin'
  ) THEN
    ALTER TABLE profiles ADD COLUMN is_admin boolean NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'subscription_tier'
  ) THEN
    ALTER TABLE profiles ADD COLUMN subscription_tier text NOT NULL DEFAULT 'free';
  END IF;
END $$;

-- User credits table
CREATE TABLE IF NOT EXISTS user_credits (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance integer NOT NULL DEFAULT 0,
  total_purchased integer NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE user_credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own credits"
  ON user_credits FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Credit transactions ledger
CREATE TABLE IF NOT EXISTS credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount integer NOT NULL,
  reason text NOT NULL DEFAULT 'manual_topup',
  note text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own transactions"
  ON credit_transactions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Function to initialize credits on signup (10 free credits)
CREATE OR REPLACE FUNCTION public.handle_new_user_credits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_credits (user_id, balance, total_purchased)
  VALUES (NEW.id, 10, 10)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.credit_transactions (user_id, amount, reason, note)
  VALUES (NEW.id, 10, 'signup_bonus', 'Welcome! 10 free credits to get started.');

  RETURN NEW;
END;
$$;

-- Trigger on auth.users insert
DROP TRIGGER IF EXISTS on_auth_user_created_credits ON auth.users;
CREATE TRIGGER on_auth_user_created_credits
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user_credits();

-- Admin helper view: all users with credit info
CREATE OR REPLACE VIEW admin_users_view AS
  SELECT
    p.id,
    p.email,
    p.display_name,
    p.is_admin,
    p.subscription_tier,
    p.created_at,
    COALESCE(uc.balance, 0) AS credit_balance,
    COALESCE(uc.total_purchased, 0) AS total_purchased
  FROM profiles p
  LEFT JOIN user_credits uc ON uc.user_id = p.id
  ORDER BY p.created_at DESC;
