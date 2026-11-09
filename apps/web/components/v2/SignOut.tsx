"use client";

export function SignOut() {
  return (
    <button
      type="button"
      className="chip"
      onClick={async () => {
        await fetch("/api/auth/signout", { method: "POST" });
        window.location.href = "/workspace";
      }}
    >
      sign out
    </button>
  );
}
