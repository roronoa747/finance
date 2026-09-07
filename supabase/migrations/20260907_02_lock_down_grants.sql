-- Postgres по умолчанию даёт EXECUTE роли PUBLIC, то есть и анонимам.
-- Внутри функций стоит проверка входа, поэтому дыры нет, но незачем оставлять
-- их дёргаемыми снаружи: отзываем у всех и возвращаем только вошедшим.

revoke all on function public.my_households()                    from public, anon;
revoke all on function public.can_write(uuid)                    from public, anon;
revoke all on function public.create_household(text, text)       from public, anon;
revoke all on function public.create_invite(uuid)                from public, anon;
revoke all on function public.join_household(text, text)         from public, anon;
revoke all on function public.pull_doc(uuid)                     from public, anon;
revoke all on function public.push_doc(uuid, bigint, jsonb)      from public, anon;
revoke all on function public.push_private(uuid, bigint, jsonb)  from public, anon;
revoke all on function public.my_membership()                    from public, anon;

grant execute on function public.my_households()                   to authenticated;
grant execute on function public.can_write(uuid)                   to authenticated;
grant execute on function public.create_household(text, text)      to authenticated;
grant execute on function public.create_invite(uuid)               to authenticated;
grant execute on function public.join_household(text, text)        to authenticated;
grant execute on function public.pull_doc(uuid)                    to authenticated;
grant execute on function public.push_doc(uuid, bigint, jsonb)     to authenticated;
grant execute on function public.push_private(uuid, bigint, jsonb) to authenticated;
grant execute on function public.my_membership()                   to authenticated;
