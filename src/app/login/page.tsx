"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { Button, ErrorNotice } from "@/components/ui";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/api/auth/login", { password });
      window.location.href = "/";
    } catch (err) {
      setError(err as ApiError);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm items-center p-4">
      <form onSubmit={submit} className="w-full space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-bold">日报助手</h1>
        <div className="space-y-1">
          <label htmlFor="pw" className="text-sm font-medium">
            访问密码
          </label>
          <input
            id="pw"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        {error && <ErrorNotice error={error} />}
        <Button type="submit" variant="primary" className="w-full" disabled={busy || password === ""}>
          {busy ? "登录中…" : "登录"}
        </Button>
      </form>
    </main>
  );
}
