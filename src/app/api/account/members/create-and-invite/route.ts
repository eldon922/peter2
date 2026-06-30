// ============================================================
// /api/account/members/create-and-invite
//
//   POST — provision a brand-new Supabase Auth user (admin-side,
//          since self-signup was removed) AND create a workspace
//          invitation for them in one call.
//
// This replaces the old flow where a new teammate without an
// existing account would hit `/signup?invite=<token>` and create
// their own login. With public signup gone, an admin must create
// the `auth.users` row themselves — this route does that via the
// service-role Admin API, then reuses the exact same invitation
// logic as `POST /api/account/invitations` so the rest of the
// join flow (`/join/<token>` → `redeem_invitation`) is untouched.
//
// Auth model
// ----------
// We generate a random temporary password and return it ONCE,
// the same "shown once, never persisted in plaintext" contract
// the invite token already uses. This sidesteps any dependency on
// SMTP/email delivery being configured — the admin shares both
// the login email+password and the invite link over WhatsApp/
// Slack/whatever, same as the existing invite-only flow.
//
// If you'd rather Supabase email the new user a "set your
// password" link instead, swap the `admin.createUser` call below
// for `admin.inviteUserByEmail` — see the comment at that call
// site.
// ============================================================

import { randomBytes } from 'node:crypto';
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
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

const MAX_LABEL_LEN = 80;
const MAX_FULL_NAME_LEN = 120;

// Deliberately loose — this is a sanity check to fail fast with a
// clear 400, not a security boundary. Supabase's Admin API is the
// real source of truth and will reject anything it doesn't like.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generateTempPassword(): string {
  // 24 bytes -> 32 base64url chars. Comfortably above any
  // reasonable minimum length policy; the user is expected to
  // change it (or you hand them a "set your password" reset link
  // instead — see module header).
  return randomBytes(24).toString('base64url');
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');

    // Two side effects in one call (create a user, then write an
    // invitation row) — same bucket/limit as other admin member-
    // management actions so this doesn't get a quieter ceiling
    // than, say, the plain invite-create endpoint.
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
    // sole-owned state `redeem_invitation` requires.
    //
    // Swap-in alternative: `supabaseAdmin().auth.admin
    //   .inviteUserByEmail(email, { data: { full_name: fullName } })`
    // creates the same user but emails them a "set your password"
    // link instead of you handing out a temp password. Requires
    // SMTP to be configured for this Supabase project.
    // ------------------------------------------------------------
    const tempPassword = generateTempPassword();
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

    // ------------------------------------------------------------
    // Step 2 — create the workspace invitation, identical to
    // `POST /api/account/invitations`. Uses the caller's own
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
          user: { id: created.user.id, email: created.user.email },
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        user: { id: created.user.id, email: created.user.email },
        tempPassword,
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
