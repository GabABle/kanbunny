-- Add 'member' to board_role enum
ALTER TYPE public.board_role ADD VALUE IF NOT EXISTS 'member';
