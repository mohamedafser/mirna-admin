-- Development seed data — clearly fictional. Never run against production.
-- Runs automatically after migrations on `supabase db reset` (local).
-- No users are created here; see README "Creating the first admin".

insert into public.categories (name, slug, description, sort_order)
values
  ('[DEV] Home Fragrance', 'dev-home-fragrance', 'Development sample category.', 1),
  ('[DEV] Gift Sets', 'dev-gift-sets', 'Development sample category.', 2)
on conflict (slug) do nothing;

insert into public.products
  (category_id, name, slug, sku, short_description, price, compare_at_price, currency_code)
select c.id, v.name, v.slug, v.sku, v.short_description, v.price, v.compare_at_price, v.currency_code
from (
  values
    ('dev-home-fragrance', '[DEV] Sample Oud Candle', 'dev-sample-oud-candle', 'DEV-CANDLE-001',
      'Fictional product for local development.', 89.000, 119.000, 'AED'),
    ('dev-home-fragrance', '[DEV] Sample Reed Diffuser', 'dev-sample-reed-diffuser', 'DEV-DIFFUSER-001',
      'Fictional product for local development.', 145.500, null, 'AED'),
    ('dev-gift-sets', '[DEV] Sample Gift Box', 'dev-sample-gift-box', 'DEV-GIFTBOX-001',
      'Fictional product for local development.', 249.000, null, 'AED')
) as v(category_slug, name, slug, sku, short_description, price, compare_at_price, currency_code)
join public.categories c on c.slug = v.category_slug
on conflict (slug) do nothing;

-- Inventory rows are created automatically by the products trigger; set stock.
update public.inventory i
set quantity = v.quantity, reserved_quantity = v.reserved_quantity
from (
  values
    ('DEV-CANDLE-001', 25, 0),
    ('DEV-DIFFUSER-001', 10, 2),
    ('DEV-GIFTBOX-001', 0, 0)
) as v(sku, quantity, reserved_quantity)
join public.products p on p.sku = v.sku
where i.product_id = p.id;
