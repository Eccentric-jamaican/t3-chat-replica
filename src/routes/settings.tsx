import {
  createFileRoute,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { Sidebar } from "../components/layout/Sidebar";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { authClient } from "../lib/auth";
import { useIsMobile } from "../hooks/useIsMobile";
import { toast } from "sonner";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Label } from "../components/ui/label";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { DatePicker } from "../components/ui/date-picker";
import { motion } from "framer-motion";
import {
  User,
  Shield,
  Link2,
  Gift,
  Mail,
  MapPin,
  RefreshCw,
  Loader2,
  Copy,
  Check,
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

const JAMAICA_PARISHES = [
  "Kingston",
  "St. Andrew",
  "St. Thomas",
  "Portland",
  "St. Mary",
  "St. Ann",
  "Trelawny",
  "St. James",
  "Hanover",
  "Westmoreland",
  "St. Elizabeth",
  "Manchester",
  "Clarendon",
  "St. Catherine",
] as const;

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const SUPPORTED_TABS = [
  "profile",
  "security",
  "connections",
  "rewards",
  "contact",
] as const;
const SUPPORTED_GMAIL_STATES = [
  "connected",
  "error",
  "expired",
  "reauth",
] as const;

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
  validateSearch: (search: Record<string, unknown>): { tab?: string; gmail?: string } => ({
    tab: SUPPORTED_TABS.includes(search.tab as (typeof SUPPORTED_TABS)[number])
      ? (search.tab as string)
      : undefined,
    gmail: SUPPORTED_GMAIL_STATES.includes(
      search.gmail as (typeof SUPPORTED_GMAIL_STATES)[number],
    )
      ? (search.gmail as string)
      : undefined,
  }),
});

function SettingsPage() {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const search = useSearch({ from: "/settings" });
  const navigate = useNavigate({ from: "/settings" });
  const [sessionId] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("sendcat_session_id") || "";
  });

  // Auth session for userId
  const { data: authSession } = authClient.useSession();
  const currentUserId = authSession?.user?.id ?? null;

  // Profile data
  const profile = useQuery(api.profiles.get, { sessionId });
  const updateProfile = useMutation(api.profiles.update);

  // Integration status
  const gmailStatus = useQuery(api.integrations.gmail.connection.getStatus);
  const disconnectGmail = useMutation(
    api.integrations.gmail.connection.disconnect,
  );
  const triggerGmailSync = useAction(
    api.integrations.gmail.connection.triggerSync,
  );
  const startGmailOAuth = useAction(
    api.integrations.gmail.connection.startOAuth,
  );
  const [isSyncing, setIsSyncing] = useState(false);

  const whatsappStatus = useQuery(api.integrations.whatsapp.getLinkingStatus);
  const requestLinkingCode = useMutation(
    api.integrations.whatsapp.requestLinkingCode,
  );
  const disconnectWhatsapp = useMutation(
    api.integrations.whatsapp.disconnectWhatsapp,
  );
  const [linkingCode, setLinkingCode] = useState<string | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);

  const preferences = useQuery(api.integrations.preferences.get);
  const updatePreferences = useMutation(api.integrations.preferences.update);

  // Handle post-OAuth redirect toasts
  useEffect(() => {
    if (!search.gmail) return;

    if (search.gmail === "connected") {
      toast.success("Gmail connected successfully! Initial sync started.");
    } else if (search.gmail === "error") {
      toast.error("Failed to connect Gmail. Please try again.");
    } else if (search.gmail === "expired") {
      toast.error("Connection attempt expired. Please try again.");
    } else if (search.gmail === "reauth") {
      toast.error("Gmail requires re-authentication. Please try again.");
    }

    // Clear the gmail param so the toast doesn't reappear on navigation
    navigate({ search: { ...search, gmail: undefined }, replace: true });
  }, [search.gmail]);

  // Set linking code from WhatsApp status
  useEffect(() => {
    if (
      whatsappStatus &&
      !whatsappStatus.linked &&
      whatsappStatus.linkingCode
    ) {
      setLinkingCode(whatsappStatus.linkingCode);
    }
  }, [whatsappStatus]);

  const handleConnectGmail = async () => {
    if (!currentUserId) {
      toast.error("Please sign in first");
      return;
    }
    try {
      const authUrl = await startGmailOAuth({});
      window.location.href = authUrl;
    } catch {
      toast.error("Failed to start Gmail connection");
    }
  };

  const handleDisconnectGmail = async () => {
    try {
      await disconnectGmail({});
      toast.success("Gmail disconnected");
    } catch {
      toast.error("Failed to disconnect Gmail");
    }
  };

  const handleSyncGmail = async () => {
    setIsSyncing(true);
    try {
      const result = await triggerGmailSync({});
      const created = result?.draftsCreated ?? 0;
      const updated = result?.draftsUpdated ?? 0;
      const parts: string[] = [];
      if (created) parts.push(`${created} drafts created`);
      if (updated) parts.push(`${updated} drafts updated`);
      if (!parts.length) parts.push("no drafts created");
      toast.success(`Synced: ${parts.join(", ")}`);
    } catch {
      toast.error("Sync failed");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleRequestLinkingCode = async () => {
    try {
      const code = await requestLinkingCode({});
      setLinkingCode(code);
      toast.success("Linking code generated");
    } catch {
      toast.error("Failed to generate linking code");
    }
  };

  const handleCopyCode = async () => {
    if (linkingCode) {
      try {
        await navigator.clipboard.writeText(linkingCode);
        setCodeCopied(true);
        setTimeout(() => setCodeCopied(false), 2000);
      } catch (err) {
        console.error("[Settings] Clipboard write failed:", err);
        toast.error("Failed to copy code to clipboard");
      }
    }
  };

  const handleDisconnectWhatsapp = async () => {
    try {
      await disconnectWhatsapp({});
      setLinkingCode(null);
      toast.success("WhatsApp disconnected");
    } catch {
      toast.error("Failed to disconnect WhatsApp");
    }
  };

  // Local state for profile fields
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [gender, setGender] = useState("");
  const [dob, setDob] = useState<number | undefined>();
  const [trn, setTrn] = useState("");
  const [streetAddress, setStreetAddress] = useState("");
  const [streetAddress2, setStreetAddress2] = useState("");
  const [city, setCity] = useState("");
  const [parish, setParish] = useState("");
  const [postalCode, setPostalCode] = useState("");

  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      setFullName(profile.fullName || "");
      setEmail(profile.email || "");
      setPhone(profile.phone || "");
      setGender(profile.gender || "");
      setDob(profile.dob);
      setTrn(profile.trn || "");
      setStreetAddress(profile.address?.streetAddress || "");
      setStreetAddress2(profile.address?.streetAddress2 || "");
      setCity(profile.address?.city || "");
      setParish(profile.address?.parish || "");
      setPostalCode(profile.address?.postalCode || "");
    }
  }, [profile]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateProfile({
        sessionId,
        profile: {
          fullName,
          email,
          phone,
          gender,
          dob,
          trn,
          address: {
            streetAddress,
            streetAddress2,
            city,
            parish,
            postalCode,
          },
        },
      });
      toast.success("Settings saved successfully");
    } catch (error) {
      console.error(error);
      toast.error("Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    setSidebarOpen(!isMobile);
  }, [isMobile]);

  return (
    <div className="relative flex h-dvh min-h-screen overflow-hidden bg-background">
      <div className="edge-glow-top" />
      <div className="edge-glow-bottom" />
      <div className="bg-noise" />

      <Sidebar isOpen={sidebarOpen} onToggle={setSidebarOpen} />

      <div className="scrollbar-hide relative flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto mt-12 w-full max-w-4xl px-6 py-12 md:py-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <h1 className="mb-2 flex items-center gap-2 text-3xl font-black text-foreground">
              Settings
            </h1>
            <p className="mb-8 font-medium text-foreground/50">
              Manage your account settings and preferences.
            </p>

            <Tabs defaultValue={search.tab || "profile"} className="w-full">
              <TabsList className="scrollbar-hide mb-8 flex h-auto flex-nowrap justify-start gap-2 overflow-x-auto bg-transparent p-0 pb-2">
                <TabsTrigger
                  value="profile"
                  className="shrink-0 gap-2 data-[state=active]:bg-primary data-[state=active]:text-white"
                >
                  <User size={16} />
                  <span>Profile</span>
                </TabsTrigger>
                <TabsTrigger
                  value="security"
                  className="shrink-0 gap-2 data-[state=active]:bg-primary data-[state=active]:text-white"
                >
                  <Shield size={16} />
                  <span>Security</span>
                </TabsTrigger>
                <TabsTrigger
                  value="connections"
                  className="shrink-0 gap-2 data-[state=active]:bg-primary data-[state=active]:text-white"
                >
                  <Link2 size={16} />
                  <span>Connections</span>
                </TabsTrigger>
                <TabsTrigger
                  value="rewards"
                  className="shrink-0 gap-2 data-[state=active]:bg-primary data-[state=active]:text-white"
                >
                  <Gift size={16} />
                  <span>Rewards</span>
                </TabsTrigger>
                <TabsTrigger
                  value="contact"
                  className="shrink-0 gap-2 data-[state=active]:bg-primary data-[state=active]:text-white"
                >
                  <Mail size={16} />
                  <span>Contact Us</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="profile" className="space-y-6">
                {/* Personal Information Section */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <User size={20} />
                      Personal Information
                    </CardTitle>
                    <CardDescription>
                      Update your personal details.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid gap-4">
                      <div className="space-y-4">
                        <div className="grid gap-2">
                          <Label htmlFor="fullName">Full Name</Label>
                          <Input
                            id="fullName"
                            placeholder="Enter your full name"
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="email">Email Address</Label>
                          <Input
                            id="email"
                            type="email"
                            placeholder="user@example.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="phone">Phone Number</Label>
                          <Input
                            id="phone"
                            type="tel"
                            placeholder="+1 (876) 000-0000"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                          />
                        </div>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <div className="grid gap-2">
                            <Label htmlFor="gender">Gender</Label>
                            <Select value={gender} onValueChange={setGender}>
                              <SelectTrigger id="gender">
                                <SelectValue placeholder="Select gender" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="male">Male</SelectItem>
                                <SelectItem value="female">Female</SelectItem>
                                <SelectItem value="other">Other</SelectItem>
                                <SelectItem value="prefer-not-to-say">
                                  Prefer not to say
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="grid gap-2">
                            <Label htmlFor="dob">Date of Birth</Label>
                            <DatePicker
                              placeholder="Select date of birth"
                              date={dob ? new Date(dob) : undefined}
                              onDateChange={(date) => setDob(date?.getTime())}
                              fromYear={1920}
                              toYear={new Date().getFullYear() - 13}
                            />
                          </div>
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="trn">
                            TRN (Taxpayer Registration Number)
                          </Label>
                          <Input
                            id="trn"
                            placeholder="000-000-000"
                            maxLength={11}
                            value={trn}
                            onChange={(e) => setTrn(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Address Section */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <MapPin size={20} />
                      Address
                    </CardTitle>
                    <CardDescription>
                      Your residential address information.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-2">
                      <Label htmlFor="streetAddress">Street Address</Label>
                      <Input
                        id="streetAddress"
                        placeholder="123 Main Street"
                        value={streetAddress}
                        onChange={(e) => setStreetAddress(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="streetAddress2">
                        Street Address Line 2
                      </Label>
                      <Input
                        id="streetAddress2"
                        placeholder="Apartment, suite, unit, etc. (optional)"
                        value={streetAddress2}
                        onChange={(e) => setStreetAddress2(e.target.value)}
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="grid gap-2">
                        <Label htmlFor="city">City / Town</Label>
                        <Input
                          id="city"
                          placeholder="Enter city or town"
                          value={city}
                          onChange={(e) => setCity(e.target.value)}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="parish">Parish</Label>
                        <Select value={parish} onValueChange={setParish}>
                          <SelectTrigger id="parish">
                            <SelectValue placeholder="Select parish" />
                          </SelectTrigger>
                          <SelectContent>
                            {JAMAICA_PARISHES.map((p) => (
                              <SelectItem
                                key={p}
                                value={p.toLowerCase().replace(/\s+/g, "-")}
                              >
                                {p}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="postalCode">Postal Code</Label>
                      <Input
                        id="postalCode"
                        placeholder="Enter postal code (optional)"
                        value={postalCode}
                        onChange={(e) => setPostalCode(e.target.value)}
                      />
                    </div>
                  </CardContent>
                </Card>

                <div className="flex justify-end">
                  <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="security">
                <Card>
                  <CardHeader>
                    <CardTitle>Security</CardTitle>
                    <CardDescription>
                      Manage your account password and security preferences.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid gap-4">
                      <div className="grid gap-2">
                        <Label htmlFor="current-password">
                          Current Password
                        </Label>
                        <Input id="current-password" type="password" />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="new-password">New Password</Label>
                        <Input id="new-password" type="password" />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="confirm-password">
                          Confirm New Password
                        </Label>
                        <Input id="confirm-password" type="password" />
                      </div>
                    </div>
                    <div className="border-t border-black/5 pt-4">
                      <h4 className="mb-4 text-sm font-bold">
                        Two-Factor Authentication
                      </h4>
                      <div className="flex items-center justify-between rounded-xl border border-black/5 bg-black/[0.02] p-4">
                        <div>
                          <p className="text-sm font-bold">Authenticator App</p>
                          <p className="text-xs text-foreground/50">
                            Protect your account with a mobile authenticator
                            app.
                          </p>
                        </div>
                        <Button variant="secondary" size="sm">
                          Setup
                        </Button>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button>Update Security</Button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="connections" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Connections</CardTitle>
                    <CardDescription>
                      Manage your connected third-party accounts and
                      integrations.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Gmail Connection */}
                    <div className="flex flex-col justify-between gap-4 rounded-xl border border-black/5 bg-black/[0.02] p-4 sm:flex-row sm:items-start">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black/5 bg-white text-xs font-bold">
                          <svg
                            viewBox="0 0 24 24"
                            className="h-5 w-5"
                            aria-hidden="true"
                          >
                            <path
                              fill="#4285F4"
                              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                            />
                            <path
                              fill="#34A853"
                              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                            />
                            <path
                              fill="#FBBC05"
                              d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z"
                            />
                            <path
                              fill="#EA4335"
                              d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83c.87-2.6 3.3-4.52 6.16-4.52z"
                            />
                          </svg>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold">Gmail</p>
                          {gmailStatus?.connected ? (
                            <div className="min-w-0">
                              <p className="max-w-full truncate text-xs text-foreground/50 sm:max-w-[240px]">
                                {gmailStatus.email}
                              </p>
                              {gmailStatus.lastSyncAt && (
                                <p className="text-xs text-foreground/30">
                                  Last synced:{" "}
                                  {new Date(
                                    gmailStatus.lastSyncAt,
                                  ).toLocaleString()}
                                </p>
                              )}
                            </div>
                          ) : (
                            <p className="text-xs text-foreground/50">
                              Not connected
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 self-end sm:mt-1 sm:self-start">
                        {gmailStatus?.connected && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleSyncGmail}
                            disabled={isSyncing}
                          >
                            {isSyncing ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <RefreshCw size={14} />
                            )}
                            <span className="ml-1">
                              {isSyncing ? "Syncing..." : "Sync"}
                            </span>
                          </Button>
                        )}
                        <Button
                          variant={
                            gmailStatus?.connected ? "outline" : "secondary"
                          }
                          size="sm"
                          onClick={
                            gmailStatus?.connected
                              ? handleDisconnectGmail
                              : handleConnectGmail
                          }
                        >
                          {gmailStatus?.connected ? "Disconnect" : "Connect"}
                        </Button>
                      </div>
                    </div>

                    {/* WhatsApp Connection */}
                    <div className="rounded-xl border border-black/5 bg-black/[0.02] p-4">
                      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                        <div className="flex min-w-0 flex-1 items-start gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black/5 bg-white text-xs font-bold">
                            <svg
                              viewBox="0 0 24 24"
                              className="h-5 w-5 fill-[#25D366]"
                            >
                              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                            </svg>
                          </div>
                          <div>
                            <p className="text-sm font-bold">WhatsApp</p>
                            {whatsappStatus?.linked ? (
                              <p className="text-xs text-foreground/50">
                                {whatsappStatus.phoneNumber}
                              </p>
                            ) : (
                              <p className="text-xs text-foreground/50">
                                Not linked
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 self-end sm:mt-1 sm:self-start">
                          {whatsappStatus?.linked ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleDisconnectWhatsapp}
                            >
                              Disconnect
                            </Button>
                          ) : (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={handleRequestLinkingCode}
                            >
                              {linkingCode ? "Refresh Code" : "Get Link Code"}
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Linking code display */}
                      {!whatsappStatus?.linked && linkingCode && (
                        <div className="mt-4 rounded-lg border border-black/5 bg-white p-3">
                          <p className="mb-2 text-xs text-foreground/50">
                            Send this code to our WhatsApp business number to
                            link your account:
                          </p>
                          <div className="flex items-center gap-2">
                            <code className="rounded-lg bg-primary/5 px-4 py-2 font-mono text-lg font-black tracking-[0.3em] text-primary">
                              {linkingCode}
                            </code>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={handleCopyCode}
                            >
                              {codeCopied ? (
                                <Check size={14} className="text-green-600" />
                              ) : (
                                <Copy size={14} />
                              )}
                            </Button>
                          </div>
                          {whatsappStatus &&
                            !whatsappStatus.linked &&
                            whatsappStatus.linkingCodeExpiresAt && (
                              <p className="mt-2 text-xs text-foreground/30">
                                Expires:{" "}
                                {new Date(
                                  whatsappStatus.linkingCodeExpiresAt,
                                ).toLocaleTimeString()}
                              </p>
                            )}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Preferences */}
                <Card>
                  <CardHeader>
                    <CardTitle>Pre-alert Preferences</CardTitle>
                    <CardDescription>
                      Control how pre-alerts are created from your messages.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between rounded-xl border border-black/5 bg-black/[0.02] p-4">
                      <div>
                        <p className="text-sm font-bold">
                          Auto-create pre-alerts
                        </p>
                        <p className="text-xs text-foreground/50">
                          Automatically create pre-alerts from incoming messages
                          instead of drafts.
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={preferences?.autoCreatePreAlerts ?? false}
                        onClick={() =>
                          updatePreferences({
                            autoCreatePreAlerts: !(
                              preferences?.autoCreatePreAlerts ?? false
                            ),
                          }).catch(() =>
                            toast.error("Failed to update preference"),
                          )
                        }
                        className={cn(
                          "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                          preferences?.autoCreatePreAlerts
                            ? "bg-primary"
                            : "bg-black/10",
                        )}
                      >
                        <span
                          className={cn(
                            "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform",
                            preferences?.autoCreatePreAlerts
                              ? "translate-x-5"
                              : "translate-x-0",
                          )}
                        />
                      </button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="rewards">
                <Card>
                  <CardHeader>
                    <CardTitle>Rewards & Credits</CardTitle>
                    <CardDescription>
                      View your current balance and earning history.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex flex-col items-center rounded-2xl border border-primary/10 bg-primary/5 p-6 text-center">
                        <span className="mb-1 text-xs font-bold tracking-widest text-primary/60 uppercase">
                          Total Credits
                        </span>
                        <span className="text-4xl font-black text-primary">
                          250
                        </span>
                      </div>
                      <div className="flex flex-col items-center rounded-2xl border border-t3-berry/10 bg-t3-berry/5 p-6 text-center">
                        <span className="mb-1 text-xs font-bold tracking-widest text-t3-berry/60 uppercase">
                          Messages Left
                        </span>
                        <span className="text-4xl font-black text-t3-berry">
                          9
                        </span>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h4 className="text-sm font-bold">Recent Activity</h4>
                      {[
                        {
                          title: "Daily Login Reward",
                          date: "Jan 26, 2026",
                          amount: "+10",
                          type: "positive",
                        },
                        {
                          title: "Referral Bonus",
                          date: "Jan 24, 2026",
                          amount: "+50",
                          type: "positive",
                        },
                        {
                          title: "Message Quota Refill",
                          date: "Jan 20, 2026",
                          amount: "+100",
                          type: "positive",
                        },
                      ].map((activity, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between border-b border-black/5 py-2 last:border-0"
                        >
                          <div>
                            <p className="text-sm font-bold">
                              {activity.title}
                            </p>
                            <p className="text-xs text-foreground/50">
                              {activity.date}
                            </p>
                          </div>
                          <span
                            className={cn(
                              "font-black",
                              activity.type === "positive"
                                ? "text-green-600"
                                : "text-red-500",
                            )}
                          >
                            {activity.amount}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="contact">
                <Card>
                  <CardHeader>
                    <CardTitle>Contact Us</CardTitle>
                    <CardDescription>
                      Have a question or feedback? We'd love to hear from you.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4">
                      <div className="grid gap-2">
                        <Label htmlFor="subject">Subject</Label>
                        <Input
                          id="subject"
                          placeholder="What is this regarding?"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="message">Message</Label>
                        <textarea
                          id="message"
                          className="flex min-h-[150px] w-full rounded-xl border border-black/5 bg-black/[0.03] px-3 py-2 text-sm text-foreground shadow-sm transition-colors placeholder:text-foreground/30 focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:outline-none"
                          placeholder="Write your message here..."
                        />
                      </div>
                    </div>
                    <div className="flex justify-end pt-2">
                      <Button className="h-12 w-full md:w-auto md:px-12">
                        Send Message
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
