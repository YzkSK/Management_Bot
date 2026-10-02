import { API_URL } from "./trpc.js";

/** セッションを破棄してログイン画面へ移る。失敗時はfalseを返し、画面側でトースト等を出す。 */
export async function logout(): Promise<boolean> {
  const response = await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" });
  if (!response.ok) return false;
  window.location.href = `${API_URL}/auth/login`;
  return true;
}
