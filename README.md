# Dofol's Freshly Baked Pizza Ordering System

A small restaurant ordering website built with HTML, CSS, vanilla JavaScript, Node.js, Express, Supabase Auth, and Supabase-hosted PostgreSQL. It runs on Windows PowerShell and does not need Docker or a local database.

The menu starts empty on purpose: the owner must enter the actual products and prices. Delivery and e-wallets also start disabled until the owner configures their real details.

## 1. Create or verify the Supabase project

1. Go to [Supabase Dashboard](https://supabase.com/dashboard) and select the organization you already created.
2. If that organization does not have this app's project yet, click **New project**. Enter `dofols-pizza`, choose the nearest available Asia-Pacific region, and create a strong database password. Save that password privately; it is not needed in this app's `.env`.
3. Wait until the project status says it is ready. Open **SQL Editor** in that project.
4. Open `database/schema.sql` from this project, copy the whole file, paste it into a new SQL Editor query, and click **Run**.
5. Open **Table Editor**. Confirm these tables exist: `admin_profiles`, `products`, `product_sizes`, `orders`, `order_items`, `payments`, `payment_status_history`, and `business_settings`. The settings table should contain one row.
6. Open the project **Connect** panel or **Settings → API Keys**. Copy the Project URL, the publishable key (`sb_publishable_…`), and the secret key (`sb_secret_…`). Do not paste keys into chat, public files, or source control.
7. In **Authentication → Settings** (or the project's Auth settings), turn off public sign-ups. The owner creates administrator accounts using the private command in section 4. Email/password sign-in must remain enabled.

If `/api/health/database` reports `schema_missing`, first check that the `.env` Project URL is for this project, then run the SQL schema as described above. If you already ran an older schema, inspect its tables before applying changes. `CREATE TABLE IF NOT EXISTS` will not update old columns; use a reviewed migration instead of assuming the old schema matches.

## 2. Configure and start the app in PowerShell

Install Node.js 20 or newer if it is not already installed. Open PowerShell in this project folder (`D:\Dofols-Pizza`) and run:

```powershell
Copy-Item .env.example .env
notepad .env
```

In `.env`, replace the example values with the Project URL, publishable key, and secret key from Supabase. Keep the secret key only in `.env`. Do not add quotes around values. Save and close Notepad. `.env` is ignored by Git.

Then install and start the server:

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`. To confirm that the server can read Supabase, open `http://localhost:3000/api/health/database`; the expected response after schema setup is `{"status":"connected"}`. `{"status":"schema_missing"}` means the app connected but the settings row/table is missing. `{"status":"migration_required"}` means the older database needs migration `0002_paymongo_and_route_delivery.sql`. An error means check the URL and keys in `.env`.

For a normal run without auto-restart, use `npm start`. Stop the current server with **Ctrl+C** before changing environment values, then start it again.

## 3. Verify the schema and public site

- `/api/health` returning `{"status":"ok",...}` confirms Express is running.
- `/api/health/database` returning `connected` confirms the backend can query Supabase.
- `/api/menu` returns `{"products":[]}` until the owner adds real products. The public menu is read from Supabase; it is not seeded with invented prices.
- The public website pages are `/`, `/menu.html`, `/cart.html`, `/checkout.html`, `/order-confirmation.html`, and `/my-orders.html`.

## 4. Create the first administrator

With Supabase configured in `.env` and the schema installed, stop the development server if it is running. Run this once in an interactive PowerShell terminal:

```powershell
npm run create-admin
```

Enter the owner's email and name. Type a password with at least 12 characters; password input is hidden and the script does not log it. The script creates a Supabase Auth user and gives that user the `owner` role in `admin_profiles`. If profile creation fails, it removes the Auth user it just created.

Restart the app (`npm run dev`) and sign in at `http://localhost:3000/admin/login.html`. There is no public registration page. Admin APIs verify the Supabase Auth token and the corresponding `admin_profiles` row on every protected request. Admin page navigation also checks a short-lived HTTP-only cookie. Do not share an administrator account.

### Reset an administrator password

If an administrator forgets their password, open PowerShell in the project folder and run:

```powershell
npm run reset-admin-password
```

Enter the existing administrator email and type a new password twice. The password entry is hidden. This command uses the server-only Supabase secret key, confirms that the Auth user has an `admin_profiles` record, and updates that user's password without creating another account. Then sign in again at `/admin/login.html`. Never share the secret key or type the new password into chat.

## 5. Set up product photo storage

Before uploading product photos, create one Supabase Storage bucket:

1. In the same Supabase project, open **Storage** and choose **New bucket**.
2. Name it `product-images` and enable **Public bucket** so customers can view menu photos.
3. Set the maximum file size to **5 MB** and allowed MIME types to `image/jpeg`, `image/png`, and `image/webp`, then create the bucket.
4. Return to **Storage → Buckets** and verify `product-images` is listed as public.

Public access is used only to display the menu images. Uploads go through the Express API, which requires an authenticated administrator, checks the image file, and keeps the Supabase secret key on the server. Supabase documents public buckets as public for retrieval while uploads and other mutations remain access controlled ([bucket access model](https://supabase.com/docs/guides/storage/buckets/fundamentals)).

## 6. Configure the actual menu and business details

After signing in:

1. Open **Products** and add each current pizza, category, description, optional photo upload, sizes, and actual prices. Choose a JPEG, PNG, or WebP photo up to 5 MB; it uploads to Supabase Storage and appears on the customer menu. Use one size per line in `size name = price` format. Customers see only available products and sizes.
2. Open **Settings** and enter the real contact details. Pickup is on by default; delivery is off by default.
3. To configure distance-based delivery, add the exact shop latitude/longitude from the shop pin in Google Maps, a base fee, a fee per kilometre, and a maximum driving distance. In Google Cloud, enable billing and the Routes API, create a server-side API key, restrict it to the Routes API (and your server IP when you have a stable IP), then add it as `GOOGLE_MAPS_ROUTES_API_KEY` in `.env`. The system sends the customer's full address to Routes, which resolves the route destination, calculates driving distance, and rounds it up to the next whole kilometre before applying `base fee + (chargeable kilometres × fee per kilometre)`. Customers can open a Google Maps link to review the resolved drop-off pin. Delivery stays unavailable until these values and the Routes key are configured.
4. To accept real GCash payments, finish PayMongo's live account verification and activate GCash in the PayMongo Dashboard under **Settings → Payment Methods**. PayMongo requires a registered business type for GCash; an account with an individual business type must upgrade first. Copy the live API secret (`sk_live_...`) and the signing secret from the **live-mode** webhook endpoint into server `.env` as `PAYMONGO_SECRET_KEY` and `PAYMONGO_WEBHOOK_SECRET`. Set `APP_BASE_URL` to the public HTTPS site origin. In PayMongo Developer Tools with **live mode** selected, register `https://your-domain/api/webhooks/paymongo` for `checkout_session.payment.paid`. The application rejects test API keys and test-mode webhook events. Enable GCash in DoFol's Admin Settings only after PayMongo has activated the method. Keep keys private; real customer payments settle to your PayMongo account. See PayMongo's [Hosted Checkout guide](https://docs.paymongo.com/docs/payment-channels-hosted-checkout), [go-live checklist](https://docs.paymongo.com/docs/get-started-go-live-checklist), and [account capabilities](https://docs.paymongo.com/docs/account-settings-account-capabilities).
5. Maya remains a manual-reference method: enter verified merchant instructions before enabling it. References do not prove that money arrived. The system does not collect wallet PINs, passwords, or OTPs.
6. Use **Orders** to confirm and process orders. PayMongo GCash is marked Paid only after a verified webhook or PayMongo status check. Use **Payments** for cash and Maya verification. Order state and payment state are separate.
7. Use **Reports** to distinguish order totals from verified collection, refunds, and net collected.

### Update an existing database

If you already ran the original `database/schema.sql`, run `database/migrations/0002_paymongo_and_route_delivery.sql` once in Supabase SQL Editor after taking a backup. New Supabase projects can run the updated `database/schema.sql` instead.

Editing a product refreshes its size IDs, so customers with an old cart may need to select the size again. Archiving hides a product while saved order item names and prices remain in order history.

## REST API

All endpoints use JSON. Admin endpoints require `Authorization: Bearer <Supabase access token>` and a matching administrator profile.

| Method and path | Purpose |
| --- | --- |
| `GET /api/health` | Express health check |
| `GET /api/health/database` | Verify the Supabase settings row is reachable |
| `GET /api/public-config` | Browser-safe project URL and publishable key for Supabase Auth |
| `GET /api/menu` | Available products, sizes, and prices |
| `GET /api/settings` | Public business details and currently available order/payment methods |
| `POST /api/delivery/quote` | Resolve a complete delivery address, then calculate a server-side Google Maps driving route and fee |
| `POST /api/orders` | Validate cart and create order + items + pending payment atomically |
| `GET /api/orders/:orderNumber` | Read an order with `X-Order-Token`; does not return the customer's phone |
| `POST /api/orders/:orderNumber/gcash-checkout` | Resume a pending GCash checkout with `X-Order-Token` |
| `POST /api/webhooks/paymongo` | Verify PayMongo webhook signatures and record successful hosted-checkout payments |
| `POST /api/admin/login` | Rate-limited Supabase Auth password sign-in; returns tokens only for admins |
| `GET /api/admin/me` | Validate current administrator |
| `POST /api/admin/session`, `DELETE /api/admin/session` | Start/end protected admin page cookie |
| `GET /api/admin/products`, `POST /api/admin/products` | List or create/update menu products |
| `POST /api/admin/uploads/product-image` | Upload an image to the `product-images` Storage bucket (JPEG/PNG/WebP, max 5 MB) |
| `PATCH /api/admin/products/:id/archive` | Archive a menu item |
| `GET /api/admin/orders`, `PATCH /api/admin/orders/:id/status` | List orders and validate a status transition |
| `GET /api/admin/payments`, `PATCH /api/admin/payments/:id/status` | Inspect references and record payment verification/history |
| `GET /api/admin/settings`, `PUT /api/admin/settings` | Read or update business configuration |
| `GET /api/admin/reports` | Order, payment, refund, method, and daily totals |

The backend calculates menu prices from Supabase and recomputes the driving route and delivery fee before saving an order. Browser-supplied prices, routes, and totals are ignored. Public database tables have RLS enabled and no browser table grants; provider keys stay in Node.js.

## Payment and order behavior

- New orders start `Pending`; new payments start `Pending`.
- Cash on Pickup is available only for pickup. Cash on Delivery is available only when delivery is enabled.
- Automatic GCash uses a PayMongo hosted checkout session. The server verifies the signed `checkout_session.payment.paid` webhook and checks the payment amount/order reference before marking the payment Paid. A return URL alone never confirms a payment.
- Maya remains manual: a customer reference stays Pending until the merchant checks it and an admin records the result.
- Delivery quotes use Google Maps Routes to resolve the customer's full delivery address and calculate driving distance, round up to the next whole kilometre, and apply the configured base and per-kilometre rate. Customers can review the mapped drop-off pin. The server recalculates the route at order submission, and the order RPC checks the saved distance and fee against current settings. Google documents address waypoints as internally geocoded by Routes ([specifying route locations](https://developers.google.com/maps/documentation/routes/specify_location)).
- Allowed order progress is Pending → Confirmed → Preparing → Ready for Pickup or Out for Delivery → Completed. The server checks each transition and order type. Cancellation is permitted from active stages.
- Payments can move Pending → Paid or Failed, and Paid → Refunded. The server records the administrator ID, timestamp, and note in payment history.
- Order tracking requires both the order number and a random 256-bit token. Only a SHA-256 hash of the token is stored in the database. The raw token is shown after checkout and saved on that browser for convenience.
- The report's order totals exclude cancelled orders. Collected revenue includes payments marked Paid or Refunded; refund totals are subtracted to produce net collected. Pending wallet references are excluded from collected revenue.

## Testing and acceptance checklist

The project folder is a fresh implementation. After configuring Supabase, use this checklist and expected results before taking real customer orders:

1. **Supabase connectivity:** `/api/health/database` returns `connected`.
2. **Schema:** Table Editor shows the eight named tables and one `business_settings` row.
3. **Menu and availability:** Add a product in admin; `/api/menu` and the customer menu show its available sizes/prices. Mark it unavailable and confirm it disappears from the customer menu.
4. **Product photo:** Create the public `product-images` bucket; upload a valid JPEG, PNG, and WebP under 5 MB and confirm each appears on the customer menu. Oversize, unsupported, or incorrectly labeled files are rejected.
5. **Cart:** Add products, adjust quantities, remove a line, refresh the page; the browser cart remains and totals recalculate.
6. **Checkout validation:** Empty cart cannot place an order; unavailable product/size is rejected; delivery is absent while disabled; invalid wallet reference is rejected.
7. **Authoritative pricing:** Change the browser's cached cart price in developer tools; submit an order and confirm the stored price uses the database size price.
8. **Atomic order:** Submit a valid pickup order. Expect one order number, saved item snapshots, a Pending payment, and a Pending order. Refresh and use the tracking code to see its status.
9. **Order privacy:** A wrong tracking code returns 404; an order lookup does not return the customer's phone. Admin APIs without a token return 401; a signed-in non-admin returns 403.
10. **Cash payment:** Confirm the order, mark the cash payment Paid only after collection; expect payment history to record admin and time.
11. **GCash live setup:** Complete PayMongo's live verification and GCash activation, configure the live secret key and live webhook signing secret, deploy at the public HTTPS `APP_BASE_URL`, and register `/api/webhooks/paymongo` for `checkout_session.payment.paid` in PayMongo live mode. The app refuses test keys and test-mode events. A real checkout charges the customer; only use a transaction when ready to accept and refund/settle an actual payment.
12. **Delivery:** Configure the shop pin, base fee, per-kilometre fee, maximum distance, and Routes API key. Quote a nearby drop-off and one outside the service area; the fee should use driving distance rounded up to a whole kilometre, and the outside location should be rejected.
13. **Maya:** Enter a test reference; it stays Pending until manually checked. An incorrect transaction can be marked Failed; it is never auto-approved.
14. **Order transitions:** Try a valid next status and an invalid jump; the valid transition saves and the invalid one is rejected. A pickup order cannot go Out for Delivery.
15. **Reports:** Pending payments do not increase collected totals. Mark a payment Paid and check gross/net; mark it Refunded and check the refund and net calculations.
16. **Refresh/persistence:** Order, item snapshots, payment history, and status remain after restarting the Node server.
17. **Layouts and errors:** Review pages at phone and desktop widths. Stop Supabase credentials or use an invalid key and confirm public pages show a safe connection error without secrets or stack traces.

Supabase-dependent checklist items cannot be honestly confirmed until this project is connected to your Supabase project and populated with owner-provided data.

## Troubleshooting

- **`Missing required environment variable`:** confirm `.env` is in the project root and has `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY`; restart Node.
- **Database health returns an error:** re-copy the Project URL and secret key; make sure `database/schema.sql` ran successfully in the same Supabase project.
- **Menu is empty:** this is expected before products are entered. Sign in to Admin → Products.
- **Product photo upload says storage is not set up:** create the public `product-images` bucket in Supabase Storage and retry.
- **Product photo upload is rejected:** use a JPEG, PNG, or WebP image no larger than 5 MB.
- **Admin login says no administrator access:** run `npm run create-admin` after confirming the schema exists and you are using the right Supabase project.
- **Admin page returns to login:** sign in again; the admin page cookie expires after one hour. Check that the browser accepts same-site cookies.
- **GCash unavailable:** set the PayMongo secret key and webhook secret in `.env`, restart Node, register the webhook, then enable GCash in Admin Settings.
- **Old cart item is no longer available:** edit your cart and add the current size from Menu.
- **Port already in use:** stop the other process or set another unused `PORT` value in `.env`.

## Deployment

Run the Node server on a host that supports persistent Express processes. Configure Supabase credentials, `APP_BASE_URL`, PayMongo keys, `GOOGLE_MAPS_ROUTES_API_KEY`, and `NODE_ENV=production` in the host secret manager, use HTTPS, and set the host listening port in `PORT`. Restrict the Google key to the Routes API and, if your host has a stable outbound address, to that server IP. Never upload `.env` to the host source repository. Set Supabase Auth site URL to the deployed website origin. The production admin cookie is marked `Secure` and requires HTTPS.

## Schema updates

`database/schema.sql` is the initial schema. For later changes, follow `database/migrations/README.md`: make a numbered SQL migration, review it, back up the Supabase project, apply it first to a staging project, and only then apply it to production using the Supabase SQL Editor. Do not assume rerunning an initial `CREATE TABLE IF NOT EXISTS` changes existing tables.
