import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE_NAME = 'studio_session';
const COACH_SESSION_MS = 14 * 86400000;
const STUDENT_SESSION_MS = 30 * 86400000;
const INVITE_TTL_MS = 7 * 86400000;

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sha256Buf(value) {
  return createHash('sha256').update(value).digest();
}

function check(ok, message, status = 400) {
  if (!ok) {
    throw Object.assign(new Error(message), { status });
  }
}

export function isPasswordAuthEnabled() {
  return Boolean(process.env.COACH_PASSWORD && process.env.COACH_PASSWORD.length > 0);
}

export function isTrialAuthEnabled() {
  if (!isPasswordAuthEnabled()) return true;
  return process.env.ALLOW_TRIAL_AUTH === '1';
}

export function parseCookieToken(req) {
  const header = String(req.headers.cookie || '');
  if (!header) return '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === SESSION_COOKIE_NAME) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return '';
}

export function extractSessionToken(req) {
  const headerToken = String(req.headers['x-studio-session'] || '').trim();
  if (headerToken) return headerToken;
  return parseCookieToken(req);
}

function isSecureRequest(req) {
  return (
    process.env.RENDER === 'true' ||
    String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https'
  );
}

export function setSessionCookie(req, res, token, maxAgeSec) {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAgeSec}`,
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(req, res) {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    'Max-Age=0',
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export async function handleAuthRoute(db, route, body, isPost, req, res, currentOwner, currentToken) {
  if (route === '/api/auth/mode' && !isPost) {
    return {
      mode: isPasswordAuthEnabled() ? 'password' : 'trial',
      trialEnabled: isTrialAuthEnabled(),
      authenticated: currentOwner !== undefined,
      coach: currentOwner === 0,
    };
  }

  if (route === '/api/auth/login' && isPost) {
    check(isPasswordAuthEnabled(), '当前运行在免登录试验模式', 400);
    const password = String(body.password || '');
    const expected = sha256Buf(process.env.COACH_PASSWORD);
    const provided = sha256Buf(password);
    check(timingSafeEqual(expected, provided), '教练密码错误', 401);

    const token = randomBytes(32).toString('hex');
    await db.run('DELETE FROM sessions WHERE expires <= ?', Date.now());
    await db.run('INSERT INTO sessions VALUES(?,?,?)', sha256Hex(token), 0, Date.now() + COACH_SESSION_MS);
    setSessionCookie(req, res, token, Math.floor(COACH_SESSION_MS / 1000));
    return { ok: true, coach: true };
  }

  if (route === '/api/auth/redeem' && isPost) {
    const rawInvite = String(body.invite || '').trim();
    check(rawInvite.length >= 16 && rawInvite.length <= 128, '邀请链接无效', 401);
    const hashedInvite = sha256Hex(rawInvite);
    const student = await db.one(
      'SELECT id, name FROM students WHERE invite = ? AND expires > ? AND archived = 0',
      hashedInvite,
      Date.now()
    );
    check(Boolean(student), '邀请链接已失效或已撤销，请联系教练重新获取', 401);

    const token = randomBytes(32).toString('hex');
    await db.run('DELETE FROM sessions WHERE expires <= ?', Date.now());
    await db.run(
      'INSERT INTO sessions VALUES(?,?,?)',
      sha256Hex(token),
      student.id,
      Date.now() + STUDENT_SESSION_MS
    );
    setSessionCookie(req, res, token, Math.floor(STUDENT_SESSION_MS / 1000));
    return { ok: true, studentId: student.id, name: student.name };
  }

  if (route === '/api/auth/logout' && isPost) {
    if (currentToken) {
      await db.run('DELETE FROM sessions WHERE token = ?', sha256Hex(currentToken));
    }
    clearSessionCookie(req, res);
    return { ok: true };
  }

  check(false, '页面不存在', 404);
}

export async function issueStudentInvite({ one, run }, studentId) {
  const sid = Number(studentId);
  const student = await one('SELECT id, name FROM students WHERE id = ? AND archived = 0', sid);
  check(Boolean(student), '学员不存在或已归档', 404);
  const rawInvite = randomBytes(24).toString('hex');
  const expires = Date.now() + INVITE_TTL_MS;
  await run('UPDATE students SET invite = ?, expires = ? WHERE id = ?', sha256Hex(rawInvite), expires, sid);
  return {
    student: sid,
    invite: rawInvite,
    path: `/?invite=${rawInvite}`,
    expires,
  };
}

export async function revokeStudentAccess({ one, run }, studentId) {
  const sid = Number(studentId);
  const student = await one('SELECT id FROM students WHERE id = ?', sid);
  check(Boolean(student), '学员不存在', 404);
  await run('UPDATE students SET invite = NULL, expires = NULL WHERE id = ?', sid);
  await run('DELETE FROM sessions WHERE owner = ?', sid);
  return { revoked: true, student: sid };
}
