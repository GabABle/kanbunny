CREATE OR REPLACE FUNCTION public.can_edit_board(_board_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.board_role_of(_board_id, _user_id) IN ('owner','editor','member');
$function$;
