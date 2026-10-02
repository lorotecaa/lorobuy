# LoroBuy — Render + Supabase

LoroBuy is a Node web service prepared for Render. Supabase is the only runtime source of truth for authentication, profiles, catalog records, carts, orders, purchase history, newsletter subscriptions, download authorization, and download history. Render serves the existing storefront and the API; it does not keep application data on its filesystem or in process memory.

Payments and third-party integrations are intentionally not implemented yet.

## Architecture

- `dist/index.html` and `dist/assets/`: existing visual storefront and local presentation assets.
- `src/server.mjs`: same-origin API and static delivery for Render.
- `src/auth.mjs`: secure, HTTP-only Supabase Auth session cookies.
- `supabase/migrations/`: database schema, RLS policies, initial catalog, and private Storage rules.
- `render.yaml`: Render Blueprint with secrets declared as dashboard-managed values.
- `scripts/smoke-test.mjs`: read-only production connectivity test.

The browser never receives a Supabase secret key. The API uses the low-privilege publishable key and forwards the signed-in user's JWT, so Supabase RLS remains the final authorization boundary.

## 1. Create and configure Supabase

1. Create a Supabase project.
2. In Auth settings, enable email/password authentication.
3. Enable Anonymous Sign-Ins. LoroBuy uses anonymous Supabase users for persistent pre-checkout carts; they can later be linked to a permanent identity.
4. Apply the migrations in filename order with the Supabase CLI:

   ```powershell
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```

   Alternatively, run each migration in the Supabase SQL editor in filename order.

5. Create a permanent user through Supabase Auth, then bootstrap the first administrator once in the SQL editor:

   ```sql
   update public.profiles
   set role = 'admin'
   where id = (
     select id from auth.users where email = 'YOUR_ADMIN_EMAIL'
   );
   ```

No API endpoint allows a user to promote their own role.

## 2. Product download files

The migration creates a private `product-files` Storage bucket. Upload product archives or videos there as an administrator, then create the matching `public.product_files` record with its `product_id`, exact `storage_path`, download filename, MIME type, and byte size.

Customers can obtain a 60-second signed download URL only when a completed order contains the product. Every issued download is recorded in `public.downloads`.

## 3. Deploy to Render

1. Push this repository to the Git provider you will connect to Render.
2. In Render, create a Blueprint from the repository. Render reads `render.yaml`.
3. Fill the three dashboard-managed variables:
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `APP_ORIGIN` — the exact Render URL, for example `https://lorobuy.onrender.com`
4. Deploy. Render supplies `PORT` automatically and calls `/api/health`.

Do not add a Supabase secret key unless a future backend-only feature truly requires it. The current application deliberately works with the publishable key plus RLS.

## 4. Local checks

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
- Auth tokens are stored in secure, HTTP-only, same-site cookies and API writes require the configured same origin.
- The server validates inputs, limits request bodies, hides internal errors, and sends a strict CSP and browser security headers.
