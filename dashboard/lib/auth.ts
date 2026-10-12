// dashboard/lib/auth.ts
// Secure Client-Side Authentication Management for Treadiiiio Terminal

export const AUTH_CREDENTIALS = {
  username: "AdiVish",
  password: "VISHA@2611",
};

const AUTH_USER_KEY = "treadiiiio_auth_user";
const AUTH_TOKEN_KEY = "treadiiiio_auth_session";

export interface AuthSession {
  username: string;
  loginTime: number;
  token: string;
}

export function validateCredentials(usernameInput: string, passwordInput: string): boolean {
  if (!usernameInput || !passwordInput) return false;
  return (
    usernameInput.trim() === AUTH_CREDENTIALS.username &&
    passwordInput === AUTH_CREDENTIALS.password
  );
}

export function createSession(username: string): AuthSession {
  const loginTime = Date.now();
  const raw = `${username}:${loginTime}:treadiiiio_secure_quantum_key_2026`;
  const token = typeof window !== 'undefined' ? btoa(raw) : Buffer.from(raw).toString('base64');
  
  if (typeof window !== 'undefined') {
    localStorage.setItem(AUTH_USER_KEY, username);
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    // Also store in cookie for middleware compatibility
    document.cookie = `treadiiiio_session=${token}; path=/; max-age=604800; SameSite=Strict`;
  }

  return { username, loginTime, token };
}

export function getSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;

  const username = localStorage.getItem(AUTH_USER_KEY);
  const token = localStorage.getItem(AUTH_TOKEN_KEY);

  if (!username || !token || username !== AUTH_CREDENTIALS.username) {
    return null;
  }

  try {
    const decoded = atob(token);
    const [tokenUser, timeStr] = decoded.split(':');
    if (tokenUser !== AUTH_CREDENTIALS.username) return null;
    return {
      username: tokenUser,
      loginTime: parseInt(timeStr, 10) || Date.now(),
      token,
    };
  } catch {
    return null;
  }
}

export function clearSession(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(AUTH_USER_KEY);
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem("antigravity_session");
    localStorage.removeItem("treadiiiio_auth");
    sessionStorage.clear();
    document.cookie = "treadiiiio_session=; path=/; max-age=0; SameSite=Strict";
  }
}

export function logout(): void {
  clearSession();
}

export function isAuthenticated(): boolean {
  return getSession() !== null;
}
