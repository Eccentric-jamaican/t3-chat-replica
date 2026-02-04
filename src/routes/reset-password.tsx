import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, ArrowRight, Loader2, AlertCircle, Check } from "lucide-react";
import { authClient } from "../lib/auth";
import { toast } from "sonner";
import { z } from "zod";
import { trackEvent } from "../lib/analytics";

const resetSearchSchema = z.object({
  token: z.string().optional(),
  error: z.string().optional(),
});

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search) => resetSearchSchema.parse(search),
  component: ResetPassword,
});

function ResetPassword() {
  const { token, error } = useSearch({ from: "/reset-password" });
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    trackEvent("reset_password_view", { hasToken: Boolean(token), error: error ?? null });
  }, [token, error]);

  const passwordRequirements = useMemo(
    () => [
      { text: "At least 8 characters", met: password.length >= 8 },
    ],
    [password],
  );

  const isPasswordValid = passwordRequirements.every((req) => req.met);
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0;

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!token) {
      setFormError("This reset link is invalid or expired.");
      return;
    }
    if (!isPasswordValid) {
      setFormError("Please meet the password requirements.");
      return;
    }
    if (!passwordsMatch) {
      setFormError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const { error: authError } = await authClient.resetPassword({
        token,
        newPassword: password,
      });

      if (authError) {
        setFormError(authError.message || "Unable to reset password.");
        return;
      }

      toast.success("Password reset successful. Please sign in.");
      navigate({ to: "/sign-in" });
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error("[AUTH CLIENT] Reset password error:", err);
      }
      setFormError("Unable to reset password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const showInvalid = !token || error;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
      <div className="edge-glow-top opacity-50" />
      <div className="edge-glow-bottom opacity-50" />
      <div className="bg-noise" />

      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 0.1, scale: 1 }}
        transition={{ duration: 2, repeat: Infinity, repeatType: "reverse" }}
        className="absolute h-[500px] w-[500px] rounded-full bg-primary/20 blur-[120px]"
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-md"
      >
        <div className="glass-morphic flex flex-col gap-6 rounded-3xl border border-white/10 p-8 shadow-2xl backdrop-blur-xl">
          <div className="space-y-2 text-center">
            <h1 className="text-4xl font-bold tracking-tight text-foreground">
              Set New Password
            </h1>
            <p className="text-muted-foreground">
              Choose a strong password to secure your account
            </p>
          </div>

          {showInvalid ? (
            <div className="space-y-4 text-center">
              <div className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
                This reset link is invalid or expired.
              </div>
              <Link
                to="/forgot-password"
                className="inline-flex items-center justify-center rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                Request a new link
              </Link>
            </div>
          ) : (
            <form onSubmit={handleReset} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground/80 ml-1">
                  New Password
                </label>
                <div className="group relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="********"
                    className="w-full rounded-2xl border border-white/5 bg-white/5 p-4 pl-10 text-sm outline-none transition-all focus:border-primary/50 focus:bg-white/10 focus:ring-4 focus:ring-primary/10"
                    required
                  />
                </div>
                <div className="mt-2 flex flex-col gap-1.5 px-1">
                  {passwordRequirements.map((req, i) => (
                    <div key={i} className="flex items-center gap-2 text-[10px]">
                      <span
                        className={req.met ? "text-green-500" : "text-muted-foreground"}
                      >
                        {req.met ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <div className="h-1 w-1 rounded-full bg-current ml-1" />
                        )}
                      </span>
                      <span
                        className={
                          req.met ? "text-green-500/80" : "text-muted-foreground/60"
                        }
                      >
                        {req.text}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground/80 ml-1">
                  Confirm Password
                </label>
                <div className="group relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="********"
                    className="w-full rounded-2xl border border-white/5 bg-white/5 p-4 pl-10 text-sm outline-none transition-all focus:border-primary/50 focus:bg-white/10 focus:ring-4 focus:ring-primary/10"
                    required
                  />
                </div>
              </div>

              <AnimatePresence>
                {formError && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive"
                  >
                    <AlertCircle className="h-4 w-4" />
                    {formError}
                  </motion.div>
                )}
              </AnimatePresence>

              <button
                type="submit"
                disabled={loading}
                className="relative w-full overflow-hidden rounded-2xl bg-primary p-4 text-sm font-semibold text-primary-foreground transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    Update Password <ArrowRight className="h-4 w-4" />
                  </span>
                )}
              </button>
            </form>
          )}

          <p className="text-center text-sm text-muted-foreground">
            Back to{" "}
            <Link
              to="/sign-in"
              className="font-semibold text-primary transition-colors hover:text-primary/80"
            >
              sign in
            </Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
