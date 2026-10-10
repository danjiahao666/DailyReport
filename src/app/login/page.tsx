"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { Button, ErrorNotice } from "@/components/ui";
import { SiteHeader } from "@/components/pixel";

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
    <>
      <SiteHeader title="日报助手" tagline="请先报上暗号，再进小镇" />
      <main className="page-shell flex justify-center py-10">
        <form onSubmit={submit} className="pixel-panel w-full max-w-sm">
          <div className="pixel-titlebar">
            <h2 className="font-pixel text-lg">登录</h2>
          </div>
          <div className="space-y-4 p-4">
            <div className="space-y-1.5">
              <label htmlFor="pw" className="font-pixel text-base">
                访问密码
              </label>
              <input
                id="pw"
                type="password"
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pixel-field"
              />
            </div>
            {error && <ErrorNotice error={error} />}
            <Button type="submit" variant="primary" className="w-full" disabled={busy || password === ""}>
              {busy ? "登录中…" : "登录"}
            </Button>
          </div>
        </form>
      </main>
    </>
  );
}
