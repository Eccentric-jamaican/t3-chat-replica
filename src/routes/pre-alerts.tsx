import { createFileRoute } from "@tanstack/react-router";
import { Sidebar } from "../components/layout/Sidebar";
import { useEffect, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { useIsMobile } from "../hooks/useIsMobile";
import { toast } from "sonner";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs";
import { Card, CardContent } from "../components/ui/card";
import { Label } from "../components/ui/label";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { motion } from "framer-motion";
import {
  Package,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Upload,
  Truck,
  ShoppingBag,
  Edit3,
  Save,
  X,
  Lock,
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { authClient } from "../lib/auth";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const Route = createFileRoute("/pre-alerts")({
  component: PreAlertsPage,
});

const CARRIER_LABELS: Record<string, string> = {
  ups: "UPS",
  usps: "USPS",
  fedex: "FedEx",
  dhl: "DHL",
  amazon: "Amazon",
  other: "Other",
};

const MERCHANT_LABELS: Record<string, string> = {
  amazon: "Amazon",
  shein: "SHEIN",
  ebay: "eBay",
  temu: "Temu",
};

type PurchaseDraft = Doc<"purchaseDrafts">;
type PackagePreAlert = Doc<"packagePreAlerts">;
type DraftUpdates = {
  orderNumber?: string;
  valueUsd?: number;
  itemsSummary?: string;
};

function PreAlertsPage() {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const { data: session, isPending } = authClient.useSession();

  const isAuthenticated = !isPending && !!session;

  const drafts = useQuery(
    api.integrations.evidence.listDrafts,
    isAuthenticated ? { status: "draft" } : "skip",
  );
  const confirmedDrafts = useQuery(
    api.integrations.evidence.listDrafts,
    isAuthenticated ? { status: "confirmed" } : "skip",
  );
  const allDrafts = useQuery(
    api.integrations.evidence.listDrafts,
    isAuthenticated ? {} : "skip",
  );
  const confirmDraft = useMutation(api.integrations.evidence.confirmDraft);
  const rejectDraft = useMutation(api.integrations.evidence.rejectDraft);

  useEffect(() => {
    setSidebarOpen(!isMobile);
  }, [isMobile]);

  if (isPending) {
    return null;
  }

  if (!isAuthenticated) {
    return (
      <div className="relative flex h-dvh min-h-screen overflow-hidden bg-background">
        <div className="edge-glow-top" />
        <div className="edge-glow-bottom" />
        <div className="bg-noise" />

        <Sidebar isOpen={sidebarOpen} onToggle={setSidebarOpen} />

        <div className="scrollbar-hide relative flex min-w-0 flex-1 flex-col overflow-y-auto">
          <div className="mx-auto mt-12 w-full max-w-md px-6 py-12 md:py-20">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <div className="text-center">
                <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                  <Lock size={32} className="text-primary" />
                </div>
                <h1 className="mb-2 text-2xl font-bold text-foreground">
                  Sign in Required
                </h1>
                <p className="mb-8 text-foreground/50">
                  You need to be signed in to view and manage your pre-alerts.
                </p>
                <Button
                  onClick={() => (window.location.href = "/sign-in")}
                  className="w-full"
                >
                  Sign In
                </Button>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    );
  }

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
              <Package size={28} />
              Pre-alerts
            </h1>
            <p className="mb-8 font-medium text-foreground/50">
              Review and manage your purchase drafts and package pre-alerts.
            </p>

            <Tabs defaultValue="pending" className="w-full">
              <TabsList className="scrollbar-hide mb-8 flex h-auto flex-nowrap justify-start gap-2 overflow-x-auto bg-transparent p-0 pb-2">
                <TabsTrigger
                  value="pending"
                  className="shrink-0 gap-2 data-[state=active]:bg-primary data-[state=active]:text-white"
                >
                  <AlertTriangle size={16} />
                  <span>Pending Review</span>
                  {drafts && drafts.length > 0 && (
                    <span className="ml-1 rounded-full bg-white/20 px-1.5 py-0.5 text-xs font-bold">
                      {drafts.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="confirmed"
                  className="shrink-0 gap-2 data-[state=active]:bg-primary data-[state=active]:text-white"
                >
                  <CheckCircle2 size={16} />
                  <span>Confirmed</span>
                </TabsTrigger>
                <TabsTrigger
                  value="all"
                  className="shrink-0 gap-2 data-[state=active]:bg-primary data-[state=active]:text-white"
                >
                  <ShoppingBag size={16} />
                  <span>All</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="pending" className="space-y-4">
                {!drafts ? (
                  <div className="py-12 text-center text-foreground/40">
                    Loading...
                  </div>
                ) : drafts.length === 0 ? (
                  <Card>
                    <CardContent className="py-12 text-center">
                      <Package
                        size={48}
                        className="mx-auto mb-4 text-foreground/20"
                      />
                      <p className="font-medium text-foreground/50">
                        No pending drafts
                      </p>
                      <p className="mt-1 text-sm text-foreground/30">
                        Connect Gmail or WhatsApp in Settings to start receiving
                        pre-alerts.
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  drafts.map((draft) => (
                    <DraftCard
                      key={draft._id}
                      draft={draft}
                      onConfirm={() =>
                        confirmDraft({ draftId: draft._id })
                          .then(() => toast.success("Draft confirmed"))
                          .catch(() => toast.error("Failed to confirm draft"))
                      }
                      onReject={() =>
                        rejectDraft({ draftId: draft._id })
                          .then(() => toast.success("Draft rejected"))
                          .catch(() => toast.error("Failed to reject draft"))
                      }
                    />
                  ))
                )}
              </TabsContent>

              <TabsContent value="confirmed" className="space-y-4">
                {!confirmedDrafts ? (
                  <div className="py-12 text-center text-foreground/40">
                    Loading...
                  </div>
                ) : confirmedDrafts.length === 0 ? (
                  <Card>
                    <CardContent className="py-12 text-center">
                      <CheckCircle2
                        size={48}
                        className="mx-auto mb-4 text-foreground/20"
                      />
                      <p className="font-medium text-foreground/50">
                        No confirmed pre-alerts yet
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  confirmedDrafts.map((draft) => (
                    <DraftCard key={draft._id} draft={draft} />
                  ))
                )}
              </TabsContent>

              <TabsContent value="all" className="space-y-4">
                {!allDrafts ? (
                  <div className="py-12 text-center text-foreground/40">
                    Loading...
                  </div>
                ) : allDrafts.length === 0 ? (
                  <Card>
                    <CardContent className="py-12 text-center">
                      <ShoppingBag
                        size={48}
                        className="mx-auto mb-4 text-foreground/20"
                      />
                      <p className="font-medium text-foreground/50">
                        No pre-alerts found
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  allDrafts.map((draft) => (
                    <DraftCard key={draft._id} draft={draft} />
                  ))
                )}
              </TabsContent>
            </Tabs>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function DraftCard({
  draft,
  onConfirm,
  onReject,
}: {
  draft: PurchaseDraft;
  onConfirm?: () => void;
  onReject?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValues, setEditValues] = useState({
    orderNumber: draft.orderNumber !== null && draft.orderNumber !== undefined ? draft.orderNumber : "",
    valueUsd: draft.valueUsd !== null && draft.valueUsd !== undefined ? (draft.valueUsd / 100).toFixed(2) : "",
    itemsSummary: draft.itemsSummary !== null && draft.itemsSummary !== undefined ? draft.itemsSummary : "",
  });

  const updateDraft = useMutation(api.integrations.evidence.updateDraft);
  const uploadInvoice = useMutation(api.integrations.evidence.uploadInvoice);
  const generateUploadUrl = useMutation(
    api.integrations.evidence.generateUploadUrl,
  );

  const preAlerts = useQuery(api.integrations.evidence.listPreAlerts, {
    purchaseDraftId: draft._id,
  });

  const handleSaveEdit = async () => {
    try {
      const updates: DraftUpdates = {};
      if (editValues.orderNumber) updates.orderNumber = editValues.orderNumber;
      if (editValues.valueUsd)
        updates.valueUsd = Math.round(parseFloat(editValues.valueUsd) * 100);
      if (editValues.itemsSummary)
        updates.itemsSummary = editValues.itemsSummary;
      await updateDraft({ draftId: draft._id, updates });
      setEditing(false);
      toast.success("Draft updated");
    } catch {
      toast.error("Failed to update draft");
    }
  };

  const handleInvoiceUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const uploadUrl = await generateUploadUrl({});
      const result = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!result.ok) {
        const errorBody = await result.text();
        throw new Error(`Upload failed (${result.status}): ${errorBody}`);
      }
      const { storageId } = await result.json();
      if (!storageId) {
        throw new Error("Upload response missing storageId");
      }
      await uploadInvoice({ draftId: draft._id, storageId });
      toast.success("Invoice uploaded");
    } catch {
      toast.error("Failed to upload invoice");
    }
  };

  const merchantDisplay =
    MERCHANT_LABELS[draft.merchant] ||
    draft.storeName ||
    draft.merchant ||
    "Unknown";
  const statusColors: Record<PurchaseDraft["status"], string> = {
    draft: "bg-amber-100 text-amber-800",
    confirmed: "bg-green-100 text-green-800",
    rejected: "bg-red-100 text-red-800",
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-black/5 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <ShoppingBag size={18} className="text-primary" />
          </div>
          <div>
            <p className="text-sm font-bold">{merchantDisplay}</p>
            {draft.orderNumber !== null && draft.orderNumber !== undefined && (
              <p className="text-xs text-foreground/50">
                Order #{draft.orderNumber}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ConfidenceIndicator confidence={draft.confidence} />
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-bold",
              statusColors[draft.status],
            )}
          >
            {draft.status}
          </span>
        </div>
      </div>

      <CardContent className="space-y-4 p-4">
        {/* Missing fields warning */}
        {draft.missingFields?.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <AlertTriangle
              size={16}
              className="mt-0.5 shrink-0 text-amber-600"
            />
            <div>
              <p className="text-xs font-bold text-amber-800">
                Missing information
              </p>
              <p className="text-xs text-amber-700">
                {draft.missingFields.join(", ")}
              </p>
            </div>
          </div>
        )}

        {/* Editable fields */}
        {editing ? (
          <div className="space-y-3">
            <div className="grid gap-2">
              <Label htmlFor={`order-${draft._id}`} className="text-xs">
                Order Number
              </Label>
              <Input
                id={`order-${draft._id}`}
                value={editValues.orderNumber}
                onChange={(e) =>
                  setEditValues((v) => ({ ...v, orderNumber: e.target.value }))
                }
                placeholder="Enter order number"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`value-${draft._id}`} className="text-xs">
                Value (USD)
              </Label>
              <Input
                id={`value-${draft._id}`}
                type="number"
                step="0.01"
                value={editValues.valueUsd}
                onChange={(e) =>
                  setEditValues((v) => ({ ...v, valueUsd: e.target.value }))
                }
                placeholder="0.00"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`items-${draft._id}`} className="text-xs">
                Items Summary
              </Label>
              <Input
                id={`items-${draft._id}`}
                value={editValues.itemsSummary}
                onChange={(e) =>
                  setEditValues((v) => ({ ...v, itemsSummary: e.target.value }))
                }
                placeholder="Brief description of items"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSaveEdit}>
                <Save size={14} className="mr-1" /> Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(false)}
              >
                <X size={14} className="mr-1" /> Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <p className="text-xs font-medium text-foreground/40">Value</p>
              <p className="text-sm font-bold">
                {draft.valueUsd !== null && draft.valueUsd !== undefined
                  ? `$${(draft.valueUsd / 100).toFixed(2)}`
                  : "--"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-foreground/40">Items</p>
              <p className="text-sm">                {draft.itemsSummary !== null && draft.itemsSummary !== undefined ? draft.itemsSummary : "--"}
</p>
            </div>
            <div>
              <p className="text-xs font-medium text-foreground/40">Invoice</p>
              <p className="text-sm">
                {draft.invoicePresent ? "Attached" : "Not attached"}
              </p>
            </div>
          </div>
        )}

        {/* Tracking numbers */}
        {preAlerts && preAlerts.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-foreground/40">
              Tracking
            </p>
            <div className="flex flex-wrap gap-2">
              {preAlerts.map((pa: PackagePreAlert) => (
                <div
                  key={pa._id}
                  className="flex items-center gap-2 rounded-lg border border-black/5 bg-black/[0.03] px-3 py-1.5"
                >
                  <Truck size={14} className="text-foreground/40" />
                  <span className="font-mono text-xs font-bold">
                    {pa.trackingNumber}
                  </span>
                  {pa.carrier && (
                    <span className="text-xs text-foreground/50">
                      {CARRIER_LABELS[pa.carrier] || pa.carrier}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between border-t border-black/5 pt-2">
          <div className="flex gap-2">
            {draft.status === "draft" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing(!editing)}
              >
                <Edit3 size={14} className="mr-1" /> Edit
              </Button>
            )}
            {!draft.invoicePresent && draft.status === "draft" && (
              <label className="cursor-pointer">
                <Button variant="ghost" size="sm" asChild>
                  <span>
                    <Upload size={14} className="mr-1" /> Invoice
                  </span>
                </Button>
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.png,.jpg,.jpeg"
                  onChange={handleInvoiceUpload}
                />
              </label>
            )}
          </div>
          {draft.status === "draft" && (
            <div className="flex gap-2">
              {onReject && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onReject}
                  className="text-red-600 hover:text-red-700"
                >
                  <XCircle size={14} className="mr-1" /> Reject
                </Button>
              )}
              {onConfirm && (
                <Button size="sm" onClick={onConfirm}>
                  <CheckCircle2 size={14} className="mr-1" /> Confirm
                </Button>
              )}
            </div>
          )}
          {draft.confirmedAt && (
            <p className="text-xs text-foreground/30">
              Confirmed {new Date(draft.confirmedAt).toLocaleDateString()}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ConfidenceIndicator({ confidence }: { confidence: number }) {
  const color =
    confidence >= 0.8
      ? "bg-green-500"
      : confidence >= 0.5
        ? "bg-amber-500"
        : "bg-red-500";

  const label =
    confidence >= 0.8 ? "High" : confidence >= 0.5 ? "Medium" : "Low";

  return (
    <div
      className="flex items-center gap-1.5"
      title={`Confidence: ${Math.round(confidence * 100)}%`}
    >
      <div className={cn("h-2 w-2 rounded-full", color)} />
      <span className="text-xs text-foreground/40">{label}</span>
    </div>
  );
}
