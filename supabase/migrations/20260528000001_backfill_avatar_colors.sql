-- Backfill avatar_color for existing profiles that don't have one yet.
-- Uses the same 24-hue HSL spectrum as handle_new_user().
-- Safe to re-run (only updates rows where avatar_color IS NULL).

DO $$
DECLARE
  hues INT[] := ARRAY[0,15,30,45,60,75,90,105,120,135,150,165,180,195,210,225,240,255,270,285,300,315,330,345];
  r RECORD;
  chosen_hue INT;
BEGIN
  FOR r IN SELECT id FROM public.profiles WHERE avatar_color IS NULL LOOP
    chosen_hue := hues[1 + floor(random() * array_length(hues, 1))::int];
    UPDATE public.profiles
      SET avatar_color = 'hsl(' || chosen_hue || ', 70%, 50%)'
      WHERE id = r.id;
  END LOOP;
END;
$$;
