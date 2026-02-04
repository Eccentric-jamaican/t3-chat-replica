import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mail, ArrowRight, Loader2 } from "lucide-react";
import { authClient } from "../lib/auth";
import { toast } from "sonner";
import { trackEvent } from "../lib/analytics";

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPassword,
});

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    trackEvent("forgot_password_view");
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { error: authError } = await authClient.requestPasswordReset({
        email,
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (authError && import.meta.env.DEV) {
        console.error("[AUTH CLIENT] Request password reset error:", authError);
      }
      setSent(true);
      toast.success("If that email exists, we'll send a reset link shortly.");
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error("[AUTH CLIENT] Request password reset error:", err);
      }
      toast.error(
        "Unable to send reset link. Please check your connection and try again.",
      );
    } finally {
      setLoading(false);
    }
  };

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
              Reset Password
            </h1>
            <p className="text-muted-foreground">
              Enter your email and we will send a reset link
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label
                htmlFor="forgot-password-email"
                className="text-sm font-medium text-foreground/80 ml-1"
              >
                Email
              </label>
              <div className="group relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                <input
                  id="forgot-password-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full rounded-2xl border border-white/5 bg-white/5 p-4 pl-10 text-sm outline-none transition-all focus:border-primary/50 focus:bg-white/10 focus:ring-4 focus:ring-primary/10"
                  required
                />
              </div>
            </div>

            <AnimatePresence>
              {sent && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="rounded-xl bg-primary/10 p-3 text-xs text-primary"
                >
                  If that email exists, we will send a reset link shortly.
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
                  Send Reset Link <ArrowRight className="h-4 w-4" />
                </span>
              )}
            </button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            Remembered your password?{" "}
            <Link
              to="/sign-in"
              className="font-semibold text-primary transition-colors hover:text-primary/80"
            >
              Sign in
            </Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
