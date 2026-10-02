-- One-time catalog bootstrap. Runtime reads and writes use Supabase only.

insert into public.categories (slug, name, sort_order)
values
  ('packs-completos', 'Packs completos', 10),
  ('quiereme', 'Animaciones Quiéreme', 20),
  ('snipe-galeria', 'Snipe y galería', 30)
on conflict (slug) do update
set name = excluded.name,
    sort_order = excluded.sort_order,
    is_active = true;

insert into public.products (
  category_id, slug, name, image_path, price_cents, compare_at_price_cents, currency, sort_order
)
values
  ((select id from public.categories where slug = 'packs-completos'), 'mega-pack-dioses-nordicos', 'Mega Pack Dioses Nórdicos ❄️', 'assets/nordicos.webp', 13900, 19900, 'USD', 10),
  ((select id from public.categories where slug = 'packs-completos'), 'mega-pack-dioses-egipto', 'Mega Pack Dioses de Egipto 🏜️', 'assets/egipto.webp', 13900, 19900, 'USD', 20),
  ((select id from public.categories where slug = 'packs-completos'), 'mega-pack-dioses-olimpo', 'Mega Pack Dioses del Olimpo 🏛️', 'assets/olimpo.webp', 13900, 19900, 'USD', 30),
  ((select id from public.categories where slug = 'packs-completos'), 'mega-pack-galactico', 'Mega Pack Galáctico 🌌', 'assets/galactico.webp', 13900, 19900, 'USD', 40),
  ((select id from public.categories where slug = 'packs-completos'), 'mega-pack-dragon-fire', 'Mega Pack Dragon Fire 🐉', 'assets/dragon.webp', 13900, 19900, 'USD', 50),
  ((select id from public.categories where slug = 'packs-completos'), 'mega-pack-kawaii-pastel', 'Mega Pack Kawaii Pastel 🎀', 'assets/kawaii.webp', 13900, 18900, 'USD', 60),
  ((select id from public.categories where slug = 'packs-completos'), 'mega-pack-glam', 'Mega Pack Glam 💎', 'assets/glam.webp', 13900, 18900, 'USD', 70),
  ((select id from public.categories where slug = 'packs-completos'), 'mega-pack-carga-toxica', 'Mega Pack Carga Tóxica ☢️', 'assets/toxic.webp', 13900, 19900, 'USD', 80),
  ((select id from public.categories where slug = 'packs-completos'), 'pack-batallero-crystal-magic', 'Pack Batallero Crystal Magic 💎', 'assets/crystal.webp', 8900, 12900, 'USD', 90),
  ((select id from public.categories where slug = 'packs-completos'), 'pack-batallero-transformer', 'Pack Batallero Transformer 🤖', 'assets/transformer.webp', 8900, 12900, 'USD', 100),
  ((select id from public.categories where slug = 'quiereme'), 'quiereme-genio', 'Quiéreme Genio 🧞', 'assets/genio.webp', 2499, 3999, 'USD', 10),
  ((select id from public.categories where slug = 'quiereme'), 'quiereme-zeus', 'Quiéreme Zeus ⚡', 'assets/zeus.webp', 2499, 3999, 'USD', 20),
  ((select id from public.categories where slug = 'quiereme'), 'quiereme-luchador', 'Quiéreme Luchador 🤼', 'assets/luchador.webp', 2499, 3999, 'USD', 30),
  ((select id from public.categories where slug = 'quiereme'), 'quiereme-vaporwave', 'Quiéreme Vaporwave 🐬', 'assets/vaporwave.webp', 2499, 3999, 'USD', 40),
  ((select id from public.categories where slug = 'quiereme'), 'quiereme-detective', 'Quiéreme Detective 🕵️', 'assets/detective.webp', 2499, 3999, 'USD', 50),
  ((select id from public.categories where slug = 'snipe-galeria'), 'snipe-chrome-purple-pack', 'Snipe! Chrome-Purple Pack (3 animaciones)', 'assets/snipe-chrome.webp', 5900, null, 'USD', 10),
  ((select id from public.categories where slug = 'snipe-galeria'), 'snipe-amatista-pack', 'Snipe! Amatista (3 animaciones)', 'assets/snipe-amatista.webp', 5900, null, 'USD', 20),
  ((select id from public.categories where slug = 'snipe-galeria'), 'gracias-por-tu-regalo-pack', 'Paquete ''Gracias por tu regalo'' (3 animaciones)', 'assets/regalo.webp', 4999, null, 'USD', 30),
  ((select id from public.categories where slug = 'snipe-galeria'), 'llenemos-galeria', 'Animación ''Llenemos galería''', 'assets/galeria.webp', 3499, null, 'USD', 40)
on conflict (slug) do update
set category_id = excluded.category_id,
    name = excluded.name,
    image_path = excluded.image_path,
    price_cents = excluded.price_cents,
    compare_at_price_cents = excluded.compare_at_price_cents,
    currency = excluded.currency,
    sort_order = excluded.sort_order,
    is_active = true;
