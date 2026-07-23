import { createClient } from '@supabase/supabase-js';

const AUTO_LOGIN_KEY = 'fms_auto_login';

function persistentLoginEnabled() {
  try {
    return window.localStorage.getItem(AUTO_LOGIN_KEY) !== 'false';
  } catch {
    return true;
  }
}

const authStorage = {
  getItem(key) {
    try {
      const storage = persistentLoginEnabled() ? window.localStorage : window.sessionStorage;
      return storage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    const persistent = persistentLoginEnabled();
    try {
      const storage = persistent ? window.localStorage : window.sessionStorage;
      const otherStorage = persistent ? window.sessionStorage : window.localStorage;
      storage.setItem(key, value);
      otherStorage.removeItem(key);
    } catch {
      // 브라우저 저장소가 차단된 경우 현재 탭의 Supabase 메모리 세션으로만 동작합니다.
    }
  },
  removeItem(key) {
    try { window.localStorage.removeItem(key); } catch {}
    try { window.sessionStorage.removeItem(key); } catch {}
  },
};

export function isAutoLoginEnabled() {
  return persistentLoginEnabled();
}

export function setAutoLoginEnabled(enabled) {
  try {
    window.localStorage.setItem(AUTO_LOGIN_KEY, enabled ? 'true' : 'false');
  } catch {
    // 저장소가 차단돼도 로그인 자체는 계속 진행합니다.
  }
}

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: authStorage,
    }
  }
);
