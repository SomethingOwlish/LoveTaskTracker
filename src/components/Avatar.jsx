import { userByEmail } from '../config';

// Совушка — сова. Гусик — гусь. Цвета берут акцент темы через currentColor.
function Owl() {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <circle cx="32" cy="32" r="32" fill="currentColor" opacity="0.16" />
      <path d="M16 26c0-10 7-16 16-16s16 6 16 16v8c0 11-7 18-16 18s-16-7-16-18v-8z" fill="currentColor" opacity="0.9" />
      <circle cx="24" cy="29" r="8" fill="var(--surface)" />
      <circle cx="40" cy="29" r="8" fill="var(--surface)" />
      <circle cx="24" cy="29" r="3.4" fill="currentColor" />
      <circle cx="40" cy="29" r="3.4" fill="currentColor" />
      <path d="M28 34l4 4 4-4z" fill="var(--warn)" />
      <path d="M19 12l7 7M45 12l-7 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function Goose() {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <circle cx="32" cy="32" r="32" fill="currentColor" opacity="0.16" />
      <path d="M40 12c-9 0-15 6-15 14v2c-6 1-11 6-11 13 0 8 7 13 17 13 11 0 19-6 19-16V26c0-8-3-14-9-14z" fill="currentColor" opacity="0.9" />
      <circle cx="38" cy="24" r="3.2" fill="var(--surface)" />
      <circle cx="38" cy="24" r="1.5" fill="currentColor" />
      <path d="M46 26l10-2-10-4z" fill="var(--warn)" />
    </svg>
  );
}

export function Avatar({ avatar, email, size = '' }) {
  const kind = avatar || userByEmail(email)?.avatar || 'owl';
  return (
    <span className={`ava ${size}`} style={{ color: 'var(--accent)' }}>
      {kind === 'goose' ? <Goose /> : <Owl />}
    </span>
  );
}
