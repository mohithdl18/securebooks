# Booking confirmation emails with Resend — setup guide

After a guest pays and sees the **Booking Confirmed** screen, the server sends them an email with:

- a thank-you message,
- their booking details (ID, dates, rooms, guests),
- the full invoice (rooms, meals, discount, tax, platform fee, total paid),
- the same invoice as a **PDF attachment**.

Each booking is emailed **once**, even though both the browser and the Razorpay webhook report the payment. If the guest closes the tab right after paying, the webhook still sends the email.

---

## What you need

- Your Resend API key (starts with `re_`).
- Access to the DNS settings of your domain (e.g. `suvilla.in`) — wherever you bought it or where the DNS is hosted (GoDaddy, Hostinger, Cloudflare, Vercel, etc.).
- About 15 minutes, plus waiting time for DNS (usually minutes, at most 72 hours).

---

## Step 1 — Log in to Resend

1. Go to <https://resend.com> and log in (or sign up).
2. Free plan limits: **100 emails/day, 3,000/month**. Each To / CC / BCC address counts as one email, so using `EMAIL_BCC` doubles the count.

## Step 2 — Add your domain (most important step)

Without this, Resend will only deliver to **your own** Resend login email — guests won't receive anything.

1. In the Resend dashboard, open **Domains → Add Domain**.
2. Enter a **subdomain** for sending, e.g. `mail.suvilla.in`. Resend recommends a subdomain so your main domain's email reputation stays separate.
3. Choose the region closest to your guests (for India, **Tokyo — ap-northeast-1** is closest).
4. Click **Add**. Resend now shows a list of DNS records — keep this page open.

## Step 3 — Add the DNS records

Open your domain's DNS settings in another tab and add **every record Resend shows you**, copied exactly. They'll look like this (yours will have their own values):

| Type | Name / Host | Value | Priority |
|------|-------------|-------|----------|
| MX   | `send.mail` | `feedback-smtp.<region>.amazonses.com` | 10 |
| TXT  | `send.mail` | `v=spf1 include:amazonses.com ~all` | — |
| TXT  | `resend._domainkey.mail` | `p=MIGfMA0G...` (long DKIM key) | — |

Tips:
- Most DNS panels add your domain automatically — enter only the part **before** `suvilla.in` in the Name field (e.g. `send.mail`, not `send.mail.suvilla.in`).
- If the MX priority 10 is already used, use 20 or 30.
- **Cloudflare:** set records to **DNS only** (grey cloud), not proxied.
- **Vercel DNS:** on the Resend domain page you can click **Auto Configure** instead of adding records by hand.

## Step 4 — Verify the domain

1. Back in Resend, click **Verify DNS Records**.
2. Wait until the status says **Verified**. This often takes under 15 minutes, but DNS can take up to 72 hours. If it's still pending after 72 hours, click **Restart verification** and re-check for copy-paste mistakes.

## Step 5 — Add DMARC (recommended, improves inbox placement)

Once verified, add one more TXT record:

| Type | Name / Host | Value |
|------|-------------|-------|
| TXT  | `_dmarc` | `v=DMARC1; p=none; rua=mailto:you@yourdomain.com` |

If you already have a `_dmarc` record for `suvilla.in`, don't add a second one — keep the existing one.

## Step 6 — Create (or check) your API key

1. In Resend go to **API Keys → Create API Key**.
2. Name it e.g. `suvilla-bookings`.
3. Permission: **Sending access**, Domain: **mail.suvilla.in** (limits the damage if the key ever leaks).
4. Copy the key — Resend shows it only once.

If you already have a key with **Full access**, it works, but a sending-only key is safer.

## Step 7 — Add the settings to `.env.local`

Open `.env.local` in the project root (next to `package.json`) and add:

```env
RESEND_API_KEY=re_your_key_here
EMAIL_FROM="SU VILLA by the Creek <bookings@mail.suvilla.in>"
EMAIL_REPLY_TO=your-reservations-inbox@gmail.com
EMAIL_BCC=
```

- `EMAIL_FROM` must use the domain you verified (`@mail.suvilla.in`). The name inside quotes is what guests see.
- `EMAIL_REPLY_TO` is where guest replies go (any inbox you check).
- `EMAIL_BCC` (optional) gets a copy of every confirmation — handy for the front desk. Leave empty to turn off.
- **Never** prefix these with `NEXT_PUBLIC_`, and never commit `.env.local` to git.

Then **stop and restart** `npm run dev` (env files are only read at start-up).

## Step 8 — Test it

**Quick test before your domain is verified:**
Set `EMAIL_FROM="SU VILLA <onboarding@resend.dev>"` and make a test booking using **the same email you log in to Resend with**. Resend's test sender only delivers to that address. Switch back to your own domain afterwards.

**Full test (domain verified):**
1. Use Razorpay **test keys** (`rzp_test_...`).
2. Book a room on `/bookings` with your own email, pay with a Razorpay test card/UPI.
3. Within a few seconds you should receive *"Booking confirmed — SU VILLA by the Creek · SUV-…"* with the PDF attached.
4. Check **Resend → Emails** to see it delivered.
5. In **/admin**, open the booking → the **Confirmation email** box shows *Sent* with the time.

## Step 9 — Going live (Vercel or other hosting)

Add the same four variables in your host's environment settings (Vercel: **Project → Settings → Environment Variables → Production**), then redeploy.

---

## Sending again / fixing a failed email

In **/admin**, open any confirmed booking:
- **Confirmation email** shows *Not sent*, *Sent (time)* or *Failed — reason*.
- **Send confirmation email / Send email again** re-sends it (max 3 times per booking per hour).

A failed send never affects the booking or payment — the booking stays confirmed.

## Troubleshooting

| What you see | Cause and fix |
|---|---|
| Terminal: `[email] Confirmation emails are off` | `RESEND_API_KEY` or `EMAIL_FROM` missing in `.env.local`, or server not restarted. |
| Admin: *Failed — You can only send testing emails to your own email address* | You're using `onboarding@resend.dev` or the domain isn't verified yet. Finish Steps 2–4. |
| Admin: *Failed — The … domain is not verified* | `EMAIL_FROM` uses a different domain from the verified one. Make them match exactly. |
| Admin: *Failed — API key is invalid* | Wrong / revoked key. Create a new one (Step 6) and restart. |
| Email lands in spam | Add DMARC (Step 5), keep `EMAIL_FROM` on your own domain, and ask early guests to mark it "Not spam". |
| 429 / rate limit | Free plan: 100/day. Upgrade the Resend plan if you get more bookings than that. |

## Where things are in the code

| File | What it does |
|---|---|
| `src/lib/email.js` | Email template (thank-you + invoice) and sending logic |
| `src/lib/invoicePdf.js` | Builds the PDF attachment |
| `src/config/business.js` | Resort name, address, phone, website, GSTIN shown in the email |
| `src/app/api/payments/verify/route.js` | Sends after the confirmation page is shown |
| `src/app/api/payments/webhook/route.js` | Backup send if the guest closed the tab |
| `src/app/api/admin/bookings/[id]/email/route.js` | Admin "send again" |
