'use client';

// ============================================================
// InviteMemberDialog
//
// Two-step modal:
//   1. Form  — role + expiry + optional label → POST creates the invite.
//   2. Result — the share URL, returned ONCE. Copy-to-clipboard, plus a
//              "Send via WhatsApp" deep link that pre-fills wa.me with
//              a friendly message containing the URL.
//
// The plaintext token is server-stored only as a SHA-256 hash, so once
// the result step is dismissed the link is gone forever — the dialog
// shouts this in copy.
// ============================================================

import { useState } from 'react';
import { toast } from 'sonner';
import { Copy, Loader2, MessageCircle, Sparkles, UserPlus } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';
import { getUsernameFromEmail } from '@/lib/username';

type InviteRole = 'admin' | 'agent' | 'viewer';

// 'existing' — the classic flow: generate a link, the recipient
//   already has (or will self-create) a login.
// 'new' — there's no public signup anymore, so this mode also
//   provisions the Supabase Auth user server-side before issuing
//   the invite. See /api/account/members/create-and-invite.
type DialogMode = 'existing' | 'new';

interface InviteMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful create so the parent re-fetches the
   *  pending-invitations list. */
  onCreated: () => void;
}

const EXPIRY_OPTIONS = [
  { value: '1', labelKey: 'days1' },
  { value: '7', labelKey: 'days7' },
  { value: '30', labelKey: 'days30' },
];

// Server caps label at 80 chars (see src/app/api/account/invitations/route.ts).
// Mirror it on the client so we short-circuit before the round-trip
// rather than letting the user submit and bounce off a 400.
const MAX_LABEL_LEN = 80;

// Mirrors MIN_PASSWORD_LEN in
// src/app/api/account/members/create-and-invite/route.ts (which itself
// mirrors MIN_PASSWORD in password-form.tsx). Client-side check exists
// only to fail fast with a clear inline error before the round-trip.
const MIN_PASSWORD_LEN = 8;

interface CreatedInvite {
  /** Absent when `autoJoin` skipped the invitation system entirely
   *  — there's no link to show in that case. */
  url?: string;
  role: InviteRole;
  expiresInDays: number;
  /** Snapshotted at creation time so a later account rename can't
   *  retroactively change the wa.me message text on the result step. */
  accountName: string;
  /** Only set in 'new' mode — the login credentials for the
   *  account we just provisioned, shown exactly once. */
  newAccount?: { username: string; tempPassword: string; isCustomPassword: boolean };
  /** True when `autoJoin` moved the user straight into the
   *  account server-side — no invite link exists for this one. */
  joined?: boolean;
}

export function InviteMemberDialog({
  open,
  onOpenChange,
  onCreated,
}: InviteMemberDialogProps) {
  const t = useTranslations('Settings.invite');
  const tRoles = useTranslations('Settings.roles');
  const { account } = useAuth();
  const [mode, setMode] = useState<DialogMode>('new');
  const [role, setRole] = useState<InviteRole>('agent');
  const [expiry, setExpiry] = useState<string>('7');
  const [label, setLabel] = useState('');
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [autoJoin, setAutoJoin] = useState(true);
  // Off by default — leaves the password field hidden and lets the
  // server hand out its generated diceware passphrase, same as before
  // this option existed. Flip on to type in a password of your own.
  const [setOwnPassword, setSetOwnPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreatedInvite | null>(null);

  function reset() {
    setMode('new');
    setRole('agent');
    setExpiry('7');
    setLabel('');
    setUsername('');
    setFullName('');
    setAutoJoin(true);
    setSetOwnPassword(false);
    setPassword('');
    setResult(null);
    setSubmitting(false);
  }

  async function handleCreate() {
    // Mirror the server's max-length check so we don't ship an
    // obviously-too-long label across the wire just to bounce off
    // a 400. The Input also has a `maxLength={MAX_LABEL_LEN}` cap
    // but a paste can land an over-limit string into state before
    // the limit kicks in on the next keystroke — this is the safety
    // net for that path.
    const trimmedLabel = label.trim();
    if (trimmedLabel.length > MAX_LABEL_LEN) {
      toast.error(t('labelTooLong', { max: MAX_LABEL_LEN }));
      return;
    }

    const trimmedUsername = username.trim();
    if (mode === 'new' && !trimmedUsername) {
      toast.error('Username is required to create an account');
      return;
    }

    // Mirror the server's bounds check (see MIN_PASSWORD_LEN comment
    // above) — same fail-fast-before-the-round-trip reasoning as the
    // label check just above.
    if (mode === 'new' && setOwnPassword && password.length < MIN_PASSWORD_LEN) {
      toast.error(`Password must be at least ${MIN_PASSWORD_LEN} characters`);
      return;
    }

    setSubmitting(true);
    try {
      const endpoint =
        mode === 'new'
          ? '/api/account/members/create-and-invite'
          : '/api/account/invitations';
      const payload =
        mode === 'new'
          ? {
            username: trimmedUsername,
            fullName: fullName.trim() || undefined,
            role,
            expiresInDays: Number(expiry),
            label: trimmedLabel || undefined,
            autoJoin,
            password: setOwnPassword ? password : undefined,
          }
          : {
            role,
            expiresInDays: Number(expiry),
            label: trimmedLabel || undefined,
          };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const responseBody = await res.json().catch(() => ({}));
        toast.error(
          responseBody.error ||
          (mode === 'new'
            ? 'Failed to create account and invitation'
            : 'Failed to create invitation')
        );
        return;
      }

      const data = (await res.json()) as {
        url?: string;
        expiresInDays?: number;
        user?: { email: string };
        tempPassword?: string;
        isCustomPassword?: boolean;
        joined?: boolean;
      };

      setResult({
        url: data.url,
        role,
        expiresInDays: data.expiresInDays ?? Number(expiry),
        // Snapshot the account name into the result so the wa.me
        // share message has team context. Falls back to a generic
        // string if `account` hasn't loaded yet (shouldn't happen
        // — the dialog requires admin+ which requires a loaded
        // profile — but stay safe).
        accountName: account?.name ?? 'our wacrm account',
        newAccount:
          data.user && data.tempPassword
            ? {
              username: getUsernameFromEmail(data.user.email),
              tempPassword: data.tempPassword,
              isCustomPassword: data.isCustomPassword === true,
            }
            : undefined,
        joined: data.joined === true,
      });
      onCreated();
    } catch (err) {
      console.error('[InviteMemberDialog] create error:', err);
      toast.error('Could not reach the server. Try again?');
    } finally {
      setSubmitting(false);
    }
  }

  async function copyToClipboard() {
    if (!result?.url) return;
    try {
      await navigator.clipboard.writeText(result.url);
      toast.success(t('copied'));
    } catch {
      // Most likely "not in a secure context" — happens on http://
      // local IPs. Surface the link in the toast so the admin can
      // hand-copy it.
      toast.error(t('clipboardBlocked'));
    }
  }

  function whatsappShareUrl(url: string): string {
    // Include the account name so the recipient knows which team
    // they're being invited to before clicking through. This matters
    // for users in multi-team contexts where "our wacrm account"
    // wouldn't be enough to disambiguate.
    const accountName = result?.accountName ?? 'our wacrm account';
    const message = t('whatsappMessage', { accountName, expiresInDays: result?.expiresInDays ?? 0, url });
    return `https://wa.me/?text=${encodeURIComponent(message)}`;
  }

  function handleOpenChange(next: boolean) {
    // Reset state when the dialog closes — both for cancel and
    // for dismissal after a successful create. The plaintext URL
    // (and any temp password) is intentionally NOT preserved across
    // opens. This is the single source of truth for closing the
    // dialog — every close path (overlay click, ESC, Cancel, Done)
    // must funnel through here, not call the `onOpenChange` prop
    // directly, or the reset gets skipped and the next open shows
    // stale credentials.
    if (!next) reset();
    onOpenChange(next);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
    >
      <DialogContent className="bg-popover border-border sm:max-w-lg">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-popover-foreground">
                <Sparkles className="size-4 text-primary" />
                {result.joined
                  ? 'Account created & joined'
                  : result.newAccount
                    ? 'Account created'
                    : t('inviteCreated')}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {result.joined ? (
                  <>
                    They&apos;re already a member — no invite link needed. Just
                    share the login below and they&apos;re in as{' '}
                  </>
                ) : result.newAccount ? (
                  <>
                    Share the login below and the invite link with your new
                    teammate. They&apos;ll sign in, then accept the invite to
                    join as{' '}
                  </>
                ) : t.rich('inviteCreatedDesc', {
                  role: tRoles(result.role),
                  days: result.expiresInDays,
                  bold: (chunks: React.ReactNode) => <strong>{chunks}</strong>
                })}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              {result.newAccount && (
                <>
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">Login username</Label>
                    <Input
                      readOnly
                      value={result.newAccount.username}
                      className="bg-muted border-border text-foreground font-mono text-xs"
                      onFocus={(e) => e.currentTarget.select()}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">
                      Password
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        readOnly
                        value={result.newAccount.tempPassword}
                        className="bg-muted border-border text-foreground font-mono text-xs"
                        onFocus={(e) => e.currentTarget.select()}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(
                              result.newAccount!.tempPassword
                            );
                            toast.success('Password copied');
                          } catch {
                            toast.error('Clipboard blocked — copy it manually');
                          }
                        }}
                        className="border-border text-muted-foreground hover:bg-muted shrink-0"
                      >
                        <Copy className="size-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="rounded-md border border-amber-500/50 bg-amber-500/15 px-3 py-2 text-xs text-amber-200">
                    <strong className="font-semibold text-amber-100">
                      Save this password now.
                    </strong>{' '}
                    It&apos;s shown once and not recoverable afterward. They can
                    change it from Settings once signed in.
                  </div>
                </>
              )}

              {result.url && (
                <><Label className="text-muted-foreground">{t('inviteLink')}</Label>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={result.url}
                      className="bg-muted border-border text-foreground font-mono text-xs"
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <Button
                      type="button"
                      onClick={copyToClipboard}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground shrink-0"
                    >
                      <Copy className="size-4" />
                      {t('copy')}
                    </Button>
                  </div>

                  {/* Higher-contrast amber than the original 10% / amber-200.
                  Reviewed against slate-900 to meet WCAG AAA for body
                  text (target ratio 7:1). Border bumped to /50, bg to
                  /15, foreground promoted to amber-100 for the strong
                  intro, amber-200 for the body. */}
                  <div className="rounded-md border border-amber-500/50 bg-amber-500/15 px-3 py-2 text-xs text-amber-200">
                    <strong className="font-semibold text-amber-100">
                      {t('saveLinkNow')}
                    </strong>{' '}
                    {t('saveLinkHint')}
                  </div>

                  {/* Anchor styled with `buttonVariants` rather than wrapping
                  in <Button asChild>. The wacrm Button is the Base UI
                  ButtonPrimitive — it has no Radix-style asChild slot.
                  Direct anchor preserves right-click "Open in new tab"
                  behaviour too. */}
                  <a
                    href={whatsappShareUrl(result.url)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={buttonVariants({
                      variant: 'outline',
                      className:
                        'w-full border-border text-muted-foreground hover:bg-muted',
                    })}
                  >
                    <MessageCircle className="size-4" />
                    {t('sendViaWhatsApp')}
                  </a>

                </>
              )}
            </div>

            <DialogFooter className="bg-popover border-border">
              <Button
                onClick={() => handleOpenChange(false)}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {t('done')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-popover-foreground">
                {mode === 'new'
                  ? 'Create account & invite'
                  : t('dialogTitle')}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {mode === 'new'
                  ? "Provision a login for someone who doesn't have one yet, then invite them to join."
                  : t('dialogDesc')}
              </DialogDescription>
            </DialogHeader>

            <Tabs
              value={mode}
              onValueChange={(v) => v && setMode(v as DialogMode)}
              className="px-0"
            >
              <TabsList className="w-full">
                <TabsTrigger value="existing" className="flex-1">
                  Existing user
                </TabsTrigger>
                <TabsTrigger value="new" className="flex-1">
                  <UserPlus className="size-3.5" />
                  New account
                </TabsTrigger>
              </TabsList>

              <TabsContent value={mode} className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label className="text-muted-foreground">{t('roleLabel')}</Label>
                  <Select
                    value={role}
                    onValueChange={(v) => v && setRole(v as InviteRole)}
                  >
                    <SelectTrigger className="w-full bg-muted border-border text-foreground">
                      <SelectValue>{tRoles(role)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">{tRoles('admin')}</SelectItem>
                      <SelectItem value="agent">{tRoles('agent')}</SelectItem>
                      <SelectItem value="viewer">{tRoles('viewer')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {tRoles(`${role}Hint` as 'adminHint' | 'agentHint' | 'viewerHint')}
                  </p>
                </div>

                {mode === 'new' && (
                  <>
                    <div className="space-y-2">
                      <Label className="text-muted-foreground">Username</Label>
                      <Input
                        type="text"
                        placeholder="janedoe"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-muted-foreground">
                        Full name{' '}
                        <span className="text-muted-foreground text-xs">
                          (optional)
                        </span>
                      </Label>
                      <Input
                        placeholder="Jane Doe"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                      />
                    </div>

                    <div className="border-border flex items-start justify-between gap-3 rounded-md border p-3">
                      <div className="space-y-0.5">
                        <Label
                          htmlFor="set-own-password"
                          className="text-foreground font-medium"
                        >
                          Set their password myself
                        </Label>
                        <p className="text-muted-foreground text-xs">
                          Off by default — we&apos;ll generate a random
                          passphrase for you to hand over instead.
                        </p>
                      </div>
                      <Switch
                        id="set-own-password"
                        checked={setOwnPassword}
                        onCheckedChange={(checked) => {
                          const next = checked === true;
                          setSetOwnPassword(next);
                          if (!next) setPassword('');
                        }}
                      />
                    </div>

                    {setOwnPassword && (
                      <div className="space-y-2">
                        <Label className="text-muted-foreground">
                          Password
                        </Label>
                        <Input
                          type="text"
                          placeholder="At least 8 characters"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="bg-muted border-border text-foreground placeholder:text-muted-foreground font-mono text-xs"
                        />
                        <p className="text-muted-foreground text-xs">
                          They can change this from Settings once signed in.
                        </p>
                      </div>
                    )}

                    <div className="border-border flex items-start justify-between gap-3 rounded-md border p-3">
                      <div className="space-y-0.5">
                        <Label
                          htmlFor="auto-join"
                          className="text-foreground font-medium"
                        >
                          Add directly, skip the invite link
                        </Label>
                        <p className="text-muted-foreground text-xs">
                          Joins them to {account?.name ?? 'this account'} as{' '}
                          {role} immediately — no link to send, nothing for them
                          to click.
                        </p>
                      </div>
                      <Switch
                        id="auto-join"
                        checked={autoJoin}
                        onCheckedChange={(checked) =>
                          setAutoJoin(checked === true)
                        }
                      />
                    </div>
                  </>
                )}

                {!(mode === 'new' && autoJoin) && (
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">{t('validForLabel')}</Label>
                    <Select
                      value={expiry}
                      onValueChange={(v) => v && setExpiry(v)}
                    >
                      <SelectTrigger className="w-full bg-muted border-border text-foreground">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EXPIRY_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {t(opt.labelKey as Parameters<typeof t>[0])}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-2">
                  <Label className="text-muted-foreground">
                    {t('labelTitle')}{' '}
                    <span className="text-xs text-muted-foreground">{t('optional')}</span>
                  </Label>
                  <Input
                    placeholder={t('labelPlaceholder')}
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    maxLength={MAX_LABEL_LEN}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                  />
                  <p className="text-xs text-muted-foreground">
                    {mode === 'new' && autoJoin
                      ? 'Helps you remember why this account was created, in the members audit log.'
                      : t('labelHint')}
                  </p>
                </div>
              </TabsContent>
            </Tabs>

            <DialogFooter className="bg-popover border-border">
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                className="border-border text-muted-foreground hover:bg-muted"
              >
                {t('cancel')}
              </Button>
              <Button
                onClick={handleCreate}
                disabled={submitting}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {mode === 'new' && autoJoin
                      ? 'Creating & joining...'
                      : t('creating')}
                  </>
                ) : mode === 'new' ? (
                  autoJoin ? (
                    'Create & add to workspace'
                  ) : (
                    'Create & invite'
                  )
                ) : (
                  t('generateLink')
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
