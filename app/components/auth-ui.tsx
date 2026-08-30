/**
 * The small vocabulary the account screens are assembled from.
 *
 * These exist so that every message in the account area is announced the same
 * way, and so that no screen has to reinvent the association between a field,
 * its label, its hint and its error — the part that quietly stops working the
 * third time it is written out by hand.
 *
 * Two rules run through all of it:
 *
 * A message that appears in response to something the reader just did is a
 * `role="alert"` when it is a failure and a `role="status"` when it is not.
 * Both are live regions, so a screen reader hears them without moving focus;
 * the difference is that an alert interrupts and a status waits for a gap.
 * Errors interrupt. Confirmations do not.
 *
 * A control that is doing something says so in its own text rather than only
 * by spinning. `aria-busy` on a button whose label still reads "Continue"
 * tells a sighted reader nothing, and a spinner tells a screen reader nothing.
 */

import { useId, type ReactNode } from "react";

/** The centred panel every signed-out screen sits in. */
export function AuthCard({
  title,
  lede,
  children,
  footer,
}: {
  title: string;
  lede?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="auth-shell">
      <section className="auth-card">
        <h1>{title}</h1>
        {lede ? <p className="lede">{lede}</p> : null}
        {children}
      </section>
      {footer ? <p className="auth-aside">{footer}</p> : null}
    </div>
  );
}

export type BannerTone = "error" | "success" | "info";

/**
 * A message about the operation as a whole, as opposed to about one field.
 *
 * `title` is the sentence the reader needs; `children` is the sentence that
 * tells them what to do about it. Splitting them is what keeps error copy from
 * collapsing into either a bare "Error" or a paragraph nobody reads.
 */
export function Banner({
  tone,
  title,
  children,
}: {
  tone: BannerTone;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div
      className="auth-banner"
      data-tone={tone}
      role={tone === "error" ? "alert" : "status"}
    >
      <p className="auth-banner-title">{title}</p>
      {children ? <p className="auth-banner-body">{children}</p> : null}
    </div>
  );
}

interface TextFieldProps {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email";
  /** The browser's autofill hint. Getting this right is most of the UX. */
  autoComplete?: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  disabled?: boolean;
  inputMode?: "text" | "email" | "numeric";
  maxLength?: number;
}

export function TextField({
  label,
  name,
  value,
  onChange,
  type = "text",
  autoComplete,
  hint,
  error,
  required,
  disabled,
  inputMode,
  maxLength,
}: TextFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  // The hint and the error are both described-by rather than one replacing the
  // other: an error does not stop the format rule from being useful, and
  // dropping it at the moment someone has got the format wrong is exactly
  // backwards.
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className="auth-field">
      <label htmlFor={id}>
        {label}
        {required ? null : <span className="auth-field-optional">Optional</span>}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        required={required}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {hint ? (
        <p className="auth-field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="auth-field-error" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A button that is honest about being busy.
 *
 * It swaps its own label while working, so the change is available to everyone
 * rather than only to whoever can see the cursor, and it stays disabled for
 * the duration so a double press cannot start two ceremonies.
 */
export function SubmitButton({
  pending,
  pendingLabel,
  children,
  disabled,
  variant = "primary",
  onClick,
  type = "submit",
}: {
  pending: boolean;
  pendingLabel: string;
  children: ReactNode;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
  onClick?: () => void;
  type?: "submit" | "button";
}) {
  return (
    <button
      type={type}
      className={
        variant === "primary"
          ? "button button-primary"
          : variant === "danger"
            ? "button button-danger"
            : "button"
      }
      disabled={pending || disabled}
      aria-busy={pending || undefined}
      onClick={onClick}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

/**
 * What the account area draws while it is still asking the server who the
 * reader is.
 *
 * It deliberately says nothing about whether anyone is signed in. This is the
 * state the prerendered HTML is frozen in — see `app/auth/session.tsx` — so it
 * is served to every visitor, cached, and read by crawlers. Any claim it made
 * would be wrong for somebody.
 */
export function SessionPending({ label }: { label: string }) {
  return (
    <div className="auth-pending" role="status">
      <span className="auth-pending-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
