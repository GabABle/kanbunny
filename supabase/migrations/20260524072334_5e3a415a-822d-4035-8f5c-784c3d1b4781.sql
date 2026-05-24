
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_color text;

-- 17 distinct colors matching the frontend palette
CREATE OR REPLACE FUNCTION public.pick_avatar_color(_seed uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (ARRAY[
    '#ef4444','#f97316','#f59e0b','#eab308','#84cc16',
    '#22c55e','#10b981','#14b8a6','#06b6d4','#0ea5e9',
    '#3b82f6','#6366f1','#8b5cf6','#a855f7','#d946ef',
    '#ec4899','#f43f5e'
  ])[1 + (abs(hashtext(_seed::text)) % 17)];
$$;

UPDATE public.profiles SET avatar_color = public.pick_avatar_color(id) WHERE avatar_color IS NULL;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, avatar_url, avatar_color)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url',
    public.pick_avatar_color(NEW.id)
  );
  RETURN NEW;
END;
$function$;
