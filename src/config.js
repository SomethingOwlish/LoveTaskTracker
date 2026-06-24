// Два пользователя приложения. Доступ только этим e-mail.
// Чтобы добавить/сменить человека — правишь здесь И в firestore.rules.

export const USERS = {
  'argentummortis@gmail.com': { name: 'Совушка', avatar: 'owl' },
  'arentakasi@gmail.com': { name: 'Гусик', avatar: 'goose' },
};

export const ALLOWED_EMAILS = Object.keys(USERS);

// Удобные хелперы: найти второго человека, получить данные по email.
export function userByEmail(email) {
  if (!email) return null;
  return USERS[email.toLowerCase()] || null;
}

export function partnerEmail(email) {
  const e = (email || '').toLowerCase();
  return ALLOWED_EMAILS.find((x) => x !== e) || null;
}
