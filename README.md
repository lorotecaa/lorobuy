# LoroBuy — Render + Supabase

LoroBuy is a Node web service prepared for Render. Supabase is the only runtime source of truth for authentication, profiles, catalog records, carts, orders, purchase history, newsletter subscriptions, download authorization, and download history. Render serves the existing storefront and the API; it does not keep application data on its filesystem or in process memory.

Payments use an external Lemon Squeezy checkout. LoroBuy creates its own pending order first, but never receives or stores card details. A signed webhook is the only path that can complete an order and unlock private downloads.

## Architecture

- `frontend/index.html` and `frontend/assets/`: single source for the existing visual storefront.
- `dist/`: generated frontend output; `npm run build` recreates it and it is not committed.
- `src/server.mjs`: same-origin API and static delivery for Render.
- `src/auth.mjs`: secure, HTTP-only Supabase Auth session cookies.
- `src/payments.mjs`: provider adapter, Lemon Squeezy checkout requests, and webhook signature validation.
- `supabase/migrations/`: database schema, RLS policies, initial catalog, and private Storage rules.
- `render.yaml`: Render Blueprint with secrets declared as dashboard-managed values.
- `scripts/smoke-test.mjs`: read-only production connectivity test.

The browser never receives a Supabase secret key or Lemon Squeezy API secret. Normal API operations use the low-privilege publishable key and the signed-in user's JWT. The backend-only Supabase secret key is used solely for verified payment events that must bypass customer RLS.

## High-quality product previews

The storefront never resizes or recompresses videos during the build. The home hero and every MP4 placed in `frontend/assets/previews/` must be at least `1920x1080` for landscape video or `600x1080` for portrait video. The portrait floor stays above the largest rendered product width, so the browser displays it without enlargement. `npm run build` inspects the MP4 metadata and fails before deployment when a video is smaller, corrupt, or missing its visual metadata.

Name each product preview with the exact product slug followed by `.mp4`. For example, the preview for `mega-pack-dioses-nordicos` belongs at `frontend/assets/previews/mega-pack-dioses-nordicos.mp4`. The API discovers that file automatically; products without an individual preview use the verified Full HD `frontend/assets/hero.mp4` fallback. This rule applies to current and future catalog products without adding paths to the application code.

## 1. Create and configure Supabase

1. Create a Supabase project.
2. In Auth settings, enable email/password authentication and require email confirmation.
3. In **Authentication → URL Configuration**, set:
   - **Site URL** to the exact public value of `APP_ORIGIN`, for example `https://lorobuy.onrender.com`.
   - **Redirect URLs** to that same origin followed by `/auth/confirm`, for example `https://lorobuy.onrender.com/auth/confirm`.
   Supabase ignores a redirect that is not allow-listed and otherwise falls back to its Site URL, whose default is `http://localhost:3000`.
4. Enable Anonymous Sign-Ins. LoroBuy uses anonymous Supabase users for persistent pre-checkout carts; they can later be linked to a permanent identity.
5. Apply the migrations in filename order with the Supabase CLI:

   ```powershell
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```

   Alternatively, run each migration in the Supabase SQL editor in filename order.

6. Register and confirm `loroteca98@gmail.com`. Migration `202610020004_admin_role.sql` promotes only that confirmed identity to `profiles.role = 'admin'`. If the first three migrations were already applied, run only migration `202610020004_admin_role.sql` in the SQL Editor.

LoroBuy sends every new confirmation to `${APP_ORIGIN}/auth/confirm`. That page exchanges the short-lived confirmation session for secure, HTTP-only cookies and immediately removes the tokens from the browser address. Confirmation links already issued with `localhost:3000`, or links that have expired, cannot be repaired; after correcting the URL Configuration, enter the address in **Iniciar sesión** and use **Reenviar correo de confirmación**.

The account icon opens registration, sign-in, profile editing, and sign-out. A confirmed administrator is redirected to `/admin`. Both the page route and every administrative API operation verify the authenticated profile on the server; RLS remains the final authorization boundary. No API endpoint or profile grant allows a user to modify `role`.

## 2. Product download files

The migration creates a private `product-files` Storage bucket. Upload product archives or videos there as an administrator, then create the matching `public.product_files` record with its `product_id`, exact `storage_path`, download filename, MIME type, and byte size.

Customers can obtain a 60-second signed download URL only when a completed order contains the product. Every issued download is recorded in `public.downloads`.

## 3. Configure Lemon Squeezy

1. Apply `202610030001_lemon_squeezy_payments.sql` after the existing migrations.
2. In Lemon Squeezy test mode, create a one-time digital product/variant for each LoroBuy product you want to sell.
3. Connect each LoroBuy product to its Lemon Squeezy Variant ID. Repeat this statement with the real slug and Variant ID:

   ```sql
   insert into public.payment_provider_variants (product_id, provider, external_variant_id)
   select id, 'lemon_squeezy', 'LEMON_VARIANT_ID'
   from public.products
   where slug = 'mega-pack-dioses-nordicos'
   on conflict (product_id, provider) do update
   set external_variant_id = excluded.external_variant_id,
       is_active = true;
   ```

4. Create a Lemon Squeezy webhook pointing to:

   ```text
   https://lorobuy.onrender.com/api/webhooks/lemon-squeezy
   ```

   Subscribe it to `order_created`. Use a long random signing secret and put the exact same value in Render as `LEMON_SQUEEZY_WEBHOOK_SECRET`.
5. Keep `LEMON_SQUEEZY_TEST_MODE=true` while testing. Test-mode API keys, store data, variants, purchases, and webhooks must all be created in Lemon Squeezy test mode. Create equivalent live products and replace the IDs and API key before setting the variable to `false`.

The checkout API fixes the price from Supabase, disables checkout discounts, and passes a random attempt token. The webhook verifies its HMAC-SHA256 signature, store, mode, variant, currency, subtotal, order, and token. The database completes the order and records the event in one transaction; a unique event key makes retries idempotent.

Apply `202610060002_admin_order_actions.sql` to enable the protected administrator actions for unpaid orders. Pending orders can only be cancelled after the 30-minute Lemon checkout has expired plus a five-minute safety margin. Permanent deletion is limited to cancelled test-mode orders with no payment or webhook event; paid orders remain immutable and must use Lemon Squeezy's refund workflow.

Guest purchases use an anonymous Supabase session, so registration is not required. The same secure browser session can retrieve the completed order and request a 60-second URL from the private `product-files` bucket.

## 4. Deploy to Render

1. Push this repository to the Git provider you will connect to Render.
2. In Render, create a Blueprint from the repository. Render reads `render.yaml`, installs dependencies, and generates `dist/` from `frontend/`.
3. Fill the dashboard-managed variables:
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY` — backend only
   - `APP_ORIGIN` — the exact Render URL, for example `https://lorobuy.onrender.com`
   - `LEMON_SQUEEZY_API_KEY` — backend only
   - `LEMON_SQUEEZY_STORE_ID`
   - `LEMON_SQUEEZY_WEBHOOK_SECRET` — backend only
   - `LEMON_SQUEEZY_TEST_MODE` — `true` for testing, `false` only after switching every Lemon Squeezy resource to live mode
4. Deploy. Render supplies `PORT` automatically and calls `/api/health`.

Use these commands if the Render service is configured manually instead of through the Blueprint:

```text
Build Command: npm ci && npm run build
Start Command: npm start
```

Never use `SUPABASE_SECRET_KEY`, `LEMON_SQUEEZY_API_KEY`, or `LEMON_SQUEEZY_WEBHOOK_SECRET` in `frontend/`, public JavaScript, screenshots, support messages, or Git. Render injects them only into the Node process.

## 5. Local checks

Copy `.env.example` to `.env`, fill only local values, then run:

```powershell
npm install
npm test
npm run dev
```

After Render deploys, verify the real Render-to-Supabase path:

```powershell
$env:BASE_URL = 'https://lorobuy.onrender.com'
npm run smoke
```

`/api/health` performs a real read against the Supabase `products` table. It returns HTTP 200 with `database: "connected"` only when Render can reach Supabase and the migration/RLS grants are correct. It returns HTTP 503 otherwise.

## Security notes

- All exposed application tables have RLS enabled and explicit grants.
- Anonymous visitors can only read active categories/products and submit a pending newsletter address.
- Authenticated users can access only their own profile, active cart, orders, order items, and download history.
- Catalog and order administration requires `profiles.role = 'admin'` and is enforced in both the API and RLS.
- Purchased files use a private Storage bucket with RLS; no public file URLs are created.
- Orders remain `pending` after checkout creation and become `completed` only inside the signed, service-role webhook transaction.
- Duplicate Lemon Squeezy events are stored once and safely acknowledged without granting access twice.
- Auth tokens are stored in secure, HTTP-only, same-site cookies and API writes require the configured same origin.
- The server validates inputs, limits request bodies, hides internal errors, and sends a strict CSP and browser security headers.
