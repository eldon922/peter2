// ============================================================
// /api/account/members/create-and-invite
//
//   POST — provision a brand-new Supabase Auth user (admin-side,
//          since self-signup was removed) AND either:
//
//            - `autoJoin: false` (default) — create a workspace
//              invitation for them, same as before.
//            - `autoJoin: true` — skip the invitation/token system
//              entirely and move them straight into this account,
//              server-side. No link, no click-through.
//
// This replaces the old flow where a new teammate without an
// existing account would hit `/signup?invite=<token>` and create
// their own login. With public signup gone, an admin must create
// the `auth.users` row themselves — this route does that via the
// service-role Admin API, then either issues an invite (same logic
// as `POST /api/account/invitations`) or joins them directly.
//
// Why `autoJoin` can't just call the existing `redeem_invitation`
// RPC
// ----------------------------------------------------------------
// `redeem_invitation` is SECURITY DEFINER but still reads
// `auth.uid()` from the request's session to know who's redeeming.
// A service-role call has no session — `auth.uid()` is NULL there,
// so the RPC would raise "Unauthorized". There's no "redeem on
// behalf of user X" parameter, by design (it would let a service
// caller move *any* existing user's account, not just one we just
// created).
//
// So `autoJoin` mode reimplements the RPC's three-step move
// directly via the service-role client instead: re-point the new
// user's profile at this account, mark a (synthetic, already-
// accepted) invitation row for audit history, then delete their
// now-orphaned personal account. This is safe ONLY because we just
// created the user a few lines above — their personal account is
// guaranteed fresh, empty, and sole-owned, which is exactly what
// `redeem_invitation`'s own safety checks verify for the normal
// link-based path. This code must never be reachable for an
// arbitrary *existing* user — there is deliberately no "join this
// already-registered email into my account" endpoint anywhere in
// this codebase, and this one stays scoped to brand-new users only.
//
// Auth model (both modes)
// ------------------------
// By default we generate a random password and return it
// ONCE, the same "shown once, never persisted in plaintext" contract
// the invite token already uses. The admin can instead supply their
// own `password` in the request body — e.g. because they want to set
// something the new user already knows and will remember — which is
// validated against the same length bounds as the self-service
// change-password form and used verbatim instead of the generated
// default. Either way this sidesteps any dependency on SMTP/email
// delivery being configured — the admin shares the login email+
// password (and, in invite mode, the link) over WhatsApp/Slack/
// whatever, same as the existing invite-only flow.
//
// If you'd rather Supabase email the new user a "set your
// password" link instead, swap the `admin.createUser` call below
// for `admin.inviteUserByEmail` — see the comment at that call
// site.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  clampExpiryDays,
  generateInviteToken,
  inviteExpiresAt,
  inviteUrl,
} from '@/lib/auth/invitations';
import { isAccountRole } from '@/lib/auth/roles';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { generatePassphrase } from '@/lib/generators/passphrase';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

const MAX_LABEL_LEN = 80;
const MAX_FULL_NAME_LEN = 120;
// Mirrors MIN_PASSWORD in src/components/settings/password-form.tsx —
// keep the two in sync if the policy ever changes.
const MIN_PASSWORD_LEN = 8;
const MAX_PASSWORD_LEN = 72; // bcrypt's effective cap, which Supabase Auth uses under the hood

// Deliberately loose — this is a sanity check to fail fast with a
// clear 400, not a security boundary. Supabase's Admin API is the
// real source of truth and will reject anything it doesn't like.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generateTempPassword(): string {
  // Bitwarden-style diceware passphrase (EFF long wordlist) instead of
  // an opaque base64 blob: 6 words + a trailing digit is comfortably
  // above any reasonable minimum length policy while staying easy to
  // read and retype off a phone screen when handed over WhatsApp/Slack.
  // The user is expected to change it (or you hand them a "set your
  // password" reset link instead — see module header).
  return generatePassphrase({
    numWords: 6,
    wordSeparator: '&',
    capitalize: true,
    includeNumber: true,
  });
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');

    // Two side effects in one call (create a user, then write an
    // invitation row or move them into the account) — same bucket/
    // limit as other admin member-management actions so this
    // doesn't get a quieter ceiling than, say, the plain invite-
    // create endpoint.
    const limit = checkRateLimit(
      `admin:createAndInvite:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      username?: unknown;
      fullName?: unknown;
      role?: unknown;
      expiresInDays?: unknown;
      label?: unknown;
      autoJoin?: unknown;
      password?: unknown;
    } | null;

    const username = typeof body?.username === 'string' ? body.username.trim() : '';
    const domain = process.env.USERNAME_EMAIL_DOMAIN || "";
    const email = username.trim().toLowerCase() + domain;
    if (!email || !EMAIL_RE.test(email)) {
      return NextResponse.json(
        { error: "A valid 'email' is required" },
        { status: 400 }
      );
    }

    let fullName = '';
    if (typeof body?.fullName === 'string') {
      fullName = body.fullName.trim();
      if (fullName.length > MAX_FULL_NAME_LEN) {
        return NextResponse.json(
          {
            error: `'fullName' must be ${MAX_FULL_NAME_LEN} characters or fewer`,
          },
          { status: 400 }
        );
      }
    }

    const role = body?.role;
    if (!isAccountRole(role) || role === 'owner') {
      return NextResponse.json(
        { error: "'role' must be one of admin, agent, viewer" },
        { status: 400 }
      );
    }

    const autoJoin = body?.autoJoin === true;

    // Optional admin-supplied password. Omitted/blank → we generate the
    // diceware default below, same as before. Validated with the same
    // bounds as the self-service change-password form so an admin can't
    // hand out a login that Supabase Auth (or the user later) would
    // reject.
    let customPassword: string | null = null;
    if (typeof body?.password === 'string' && body.password.length > 0) {
      if (body.password.length < MIN_PASSWORD_LEN) {
        return NextResponse.json(
          { error: `'password' must be at least ${MIN_PASSWORD_LEN} characters` },
          { status: 400 }
        );
      }
      if (body.password.length > MAX_PASSWORD_LEN) {
        return NextResponse.json(
          { error: `'password' must be ${MAX_PASSWORD_LEN} characters or fewer` },
          { status: 400 }
        );
      }
      customPassword = body.password;
    }

    let label: string | null = null;
    if (typeof body?.label === 'string') {
      const trimmed = body.label.trim();
      if (trimmed.length > MAX_LABEL_LEN) {
        return NextResponse.json(
          { error: `'label' must be ${MAX_LABEL_LEN} characters or fewer` },
          { status: 400 }
        );
      }
      label = trimmed === '' ? null : trimmed;
    }

    const expiresInDaysRaw = body?.expiresInDays;
    const expiresInDays =
      typeof expiresInDaysRaw === 'number' ? expiresInDaysRaw : undefined;
    const expiryDays = clampExpiryDays(expiresInDays);
    const expiresAt = inviteExpiresAt(expiryDays);

    // ------------------------------------------------------------
    // Step 1 — create the Supabase Auth user.
    //
    // `email_confirm: true` skips the confirmation-link step
    // entirely (there's no public /signup to land on after
    // clicking it anymore). `on_auth_user_created` (migration 017)
    // fires on this insert exactly like it did for self-signup,
    // giving the new user a fresh personal `accounts` row + a
    // linked `profiles` row with role 'owner' — the empty,
    // sole-owned state both `redeem_invitation` and the `autoJoin`
    // path below require.
    //
    // Swap-in alternative: `supabaseAdmin().auth.admin
    //   .inviteUserByEmail(email, { data: { full_name: fullName } })`
    // creates the same user but emails them a "set your password"
    // link instead of you handing out a temp password. Requires
    // SMTP to be configured for this Supabase project.
    // ------------------------------------------------------------
    // Admin-chosen password wins if given; otherwise fall back to the
    // auto-generated diceware passphrase default.
    const tempPassword = customPassword ?? generateTempPassword();
    const isCustomPassword = customPassword !== null;
    const { data: created, error: createError } =
      await supabaseAdmin().auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: fullName ? { full_name: fullName } : undefined,
      });

    if (createError || !created?.user) {
      // Supabase surfaces "already registered" as a 422/400 with a
      // descriptive message — pass it through rather than masking
      // it, since the right next step for the admin differs (use
      // the regular "Invite member" flow instead, the person
      // already has a login).
      console.error(
        '[POST /api/account/members/create-and-invite] createUser error:',
        createError
      );
      return NextResponse.json(
        {
          error:
            createError?.message ||
            'Failed to create the user. They may already have an account — try the regular invite flow instead.',
        },
        {
          status:
            createError?.status &&
            createError.status >= 400 &&
            createError.status < 500
              ? 409
              : 500,
        }
      );
    }

    const newUserId = created.user.id;

    // ------------------------------------------------------------
    // autoJoin branch — move the new user into this account
    // directly, server-side. No invitation row, no link, no click.
    // ------------------------------------------------------------
    if (autoJoin) {
      // The trigger above runs synchronously in the same Postgres
      // transaction as the auth.users insert, so the personal
      // profile/account it created is already readable here.
      const { data: profile, error: profileFetchError } = await supabaseAdmin()
        .from('profiles')
        .select('account_id')
        .eq('user_id', newUserId)
        .single();

      if (profileFetchError || !profile?.account_id) {
        console.error(
          '[POST /api/account/members/create-and-invite] profile fetch error:',
          profileFetchError
        );
        return NextResponse.json(
          {
            error:
              "Account was created but we couldn't read its bootstrap profile. The user exists in Auth — check Supabase directly or retry without autoJoin.",
            user: { id: newUserId, email: created.user.email },
          },
          { status: 500 }
        );
      }

      const oldAccountId = profile.account_id as string;

      // 1. Re-point the profile at this account (mirrors
      //    `redeem_invitation`'s first UPDATE).
      const { error: moveError } = await supabaseAdmin()
        .from('profiles')
        .update({ account_id: ctx.accountId, account_role: role })
        .eq('user_id', newUserId);

      if (moveError) {
        console.error(
          '[POST /api/account/members/create-and-invite] profile move error:',
          moveError
        );
        return NextResponse.json(
          {
            error:
              'Account was created but moving it into this workspace failed. The user exists in Auth with their own empty account — retry, or use the regular invite flow.',
            user: { id: newUserId, email: created.user.email },
          },
          { status: 500 }
        );
      }

      // 2. Clean up the now-orphaned personal account. Safe — it
      //    was created moments ago by the trigger above, so it's
      //    guaranteed empty and the profile has already been moved
      //    off it (mirrors `redeem_invitation`'s cleanup DELETE).
      const { error: cleanupError } = await supabaseAdmin()
        .from('accounts')
        .delete()
        .eq('id', oldAccountId);

      if (cleanupError) {
        // Non-fatal — the user is correctly joined either way, this
        // just leaves an orphan empty `accounts` row behind. Log it
        // rather than failing the request over housekeeping.
        console.error(
          '[POST /api/account/members/create-and-invite] orphan account cleanup error:',
          cleanupError
        );
      }

      // 3. Synthetic, already-accepted invitation row purely so this
      //    join shows up in the same audit trail as link-based ones
      //    (Members tab's history, `created_by_user_id`, etc.). The
      //    token/hash here is never generated or shown to anyone —
      //    it can't be redeemed because `accepted_at` is already set.
      const { hash } = generateInviteToken();
      const { error: auditError } = await ctx.supabase
        .from('account_invitations')
        .insert({
          account_id: ctx.accountId,
          token_hash: hash,
          role,
          created_by_user_id: ctx.userId,
          label,
          expires_at: expiresAt.toISOString(),
          accepted_at: new Date().toISOString(),
          accepted_by_user_id: newUserId,
        });

      if (auditError) {
        // Also non-fatal — the join itself already succeeded.
        console.error(
          '[POST /api/account/members/create-and-invite] audit row insert error:',
          auditError
        );
      }

      return NextResponse.json(
        {
          user: { id: newUserId, email: created.user.email },
          tempPassword,
          isCustomPassword,
          joined: true,
          accountId: ctx.accountId,
          role,
        },
        { status: 201 }
      );
    }

    // ------------------------------------------------------------
    // Default branch — create the workspace invitation, identical
    // to `POST /api/account/invitations`. Uses the caller's own
    // (RLS-scoped) client, not the service-role one, so this is
    // still subject to the same `account_invitations_modify`
    // policy (admin+ of ctx.accountId) as the plain invite route.
    // ------------------------------------------------------------
    const { token, hash } = generateInviteToken();

    const { data: invitation, error: inviteError } = await ctx.supabase
      .from('account_invitations')
      .insert({
        account_id: ctx.accountId,
        token_hash: hash,
        role,
        created_by_user_id: ctx.userId,
        label,
        expires_at: expiresAt.toISOString(),
      })
      .select('id, role, label, expires_at, created_at')
      .single();

    if (inviteError || !invitation) {
      // The user now exists in Auth but has no invitation. That's
      // recoverable — the admin can issue a normal invite for this
      // email via the existing dialog — so surface a clear error
      // rather than trying to roll back the user creation (Admin
      // API has no transactional tie between the two calls).
      console.error(
        '[POST /api/account/members/create-and-invite] invitation insert error:',
        inviteError
      );
      return NextResponse.json(
        {
          error:
            "Account was created but the invitation failed. Use 'Invite member' to send one to this email.",
          user: { id: newUserId, email: created.user.email },
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        user: { id: newUserId, email: created.user.email },
        tempPassword,
        isCustomPassword,
        invitation,
        token,
        url: inviteUrl(token, getBaseUrl(request)),
        expiresInDays: expiryDays,
      },
      { status: 201 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}

// Mirrors `getBaseUrl` in `/api/account/invitations/route.ts` (kept
// local rather than imported — it reads request headers, not worth
// a shared module for one ~15-line helper). Keep the two in sync if
// you change one.
function getBaseUrl(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const forwardedHost = request.headers
    .get('x-forwarded-host')
    ?.split(',')[0]
    ?.trim();
  const forwardedProto = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim();
  if (forwardedHost) {
    return `${forwardedProto || 'https'}://${forwardedHost}`;
  }

  const host = request.headers.get('host')?.trim();
  if (host) {
    const reqProto = new URL(request.url).protocol.replace(':', '');
    return `${reqProto}://${host}`;
  }

  console.warn(
    '[POST /api/account/members/create-and-invite] could not derive base URL from request; falling back to marketing domain'
  );
  return 'https://wacrm.tech';
}
