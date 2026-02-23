import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Sidebar } from "../components/layout/Sidebar";
import { useEffect, useState, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { useIsMobile } from "../hooks/useIsMobile";
import { motion, AnimatePresence } from "framer-motion";
import {
  Package as PackageIcon,
  Truck,
  MapPin,
  CheckCircle2,
  Search,
  Box,
  LayoutDashboard,
  ChevronRight,
  Database,
  List as ListIcon,
  LayoutGrid,
  Download,
  X,
  ArrowUpDown,
  type LucideIcon,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { authClient } from "../lib/auth";
import { cn } from "../lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/packages")({
  component: PackagesPage,
});

const STATUS_CONFIG = {
  warehouse: {
    label: "In Warehouse",
    icon: Box,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    indicatorColor: "bg-blue-500",
    barColor: "bg-blue-500",
  },
  in_transit: {
    label: "In Transit",
    icon: Truck,
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
    indicatorColor: "bg-amber-500",
    barColor: "bg-amber-500",
  },
  ready_for_pickup: {
    label: "Ready for Pickup",
    icon: MapPin,
    color: "text-green-500",
    bgColor: "bg-green-500/20",
    indicatorColor: "bg-green-500",
    barColor: "bg-green-500",
    highlight: true,
  },
  delivered: {
    label: "Picked Up",
    icon: CheckCircle2,
    color: "text-foreground/40",
    bgColor: "bg-black/[0.03]",
    indicatorColor: "bg-foreground/20",
    barColor: "bg-black/10",
  },
} as const;

type Package = Doc<"packages">;

function PackagesPage() {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const [viewMode, setViewMode] = useState<"card" | "table">("card");
  
  // Filtering & Sorting State
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("newest");

  const { data: session, isPending } = authClient.useSession();
  const isAuthenticated = !isPending && !!session;

  const rawPackages = useQuery(
    api.packages.list,
    isAuthenticated ? {} : "skip"
  );
  
  const seedPackages = useMutation(api.packages.seed);

  // Derived filtered & sorted packages
  const packages = useMemo(() => {
    if (!rawPackages) return rawPackages;

    let filtered = [...rawPackages];

    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(p => 
        p.merchant.toLowerCase().includes(q) || 
        p.trackingNumber.toLowerCase().includes(q) || 
        p.description.toLowerCase().includes(q)
      );
    }

    // Status filter
    if (statusFilter !== "all") {
      filtered = filtered.filter(p => p.status === statusFilter);
    }

    // Sorting
    filtered.sort((a, b) => {
      const tsA = a.updatedAt ?? a._creationTime;
      const tsB = b.updatedAt ?? b._creationTime;

      switch (sortBy) {
        case "oldest":
          return tsA - tsB;
        case "cost_high":
          return (b.cost || 0) - (a.cost || 0);
        case "cost_low":
          return (a.cost || 0) - (b.cost || 0);
        case "weight_high":
          return (b.weight || 0) - (a.weight || 0);
        case "weight_low":
          return (a.weight || 0) - (b.weight || 0);
        case "newest":
        default:
          return tsB - tsA;
      }
    });

    return filtered;
  }, [rawPackages, searchQuery, statusFilter, sortBy]);

  // Status counts for tabs
  const statusCounts = useMemo(() => {
    if (!rawPackages) return {};
    const counts: Record<string, number> = { all: rawPackages.length };
    rawPackages.forEach(p => {
       counts[p.status] = (counts[p.status] || 0) + 1;
    });
    return counts;
  }, [rawPackages]);

  const filteredPickupItems = useMemo(() => 
    packages?.filter(p => p.status === "ready_for_pickup") || []
  , [packages]);

  const handleClearFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setSortBy("newest");
  };


  useEffect(() => {
    setSidebarOpen(!isMobile);
  }, [isMobile]);

  const handleSeed = async () => {
    try {
      const result = await seedPackages();
      toast.success(result);
    } catch (err) {
      toast.error("Failed to seed data");
    }
  };

  const handleExportCSV = () => {
    if (!packages || packages.length === 0) {
      toast.error("No packages to export");
      return;
    }

    const headers = ["Merchant", "Tracking Number", "Description", "Status", "Weight (lbs)", "Cost (JMD)", "Location", "Updated At"];
    
    // Proper CSV escaping function
    const escapeCSV = (val: unknown) => {
      const str = String(val ?? "");
      // If it contains quotes, commas, or newlines, wrap in quotes and escape internal quotes
      if (/[",\n\r]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = packages.map(p => {
      const ts = p.updatedAt ?? p._creationTime ?? 0;
      return [
        escapeCSV(p.merchant),
        escapeCSV(p.trackingNumber),
        escapeCSV(p.description),
        escapeCSV(STATUS_CONFIG[p.status].label || p.status),
        p.weight || 0,
        p.cost || 0,
        escapeCSV(p.location),
        escapeCSV(new Date(ts).toLocaleString())
      ];
    });

    // Calculate totals accurately
    const totalWeight = packages.reduce((sum, p) => sum + (p.weight || 0), 0);
    const totalCost = packages.reduce((sum, p) => sum + (p.cost || 0), 0);
    
    rows.push([]); // Empty row
    rows.push(["TOTALS", "", "", "", totalWeight.toFixed(2), totalCost.toFixed(2), "", ""]);

    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `packages_export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success("CSV Exported successfully");
  };

  // Global stats from raw data
  const pickupCount = rawPackages?.filter(p => p.status === "ready_for_pickup").length || 0;
  const transitCount = rawPackages?.filter(p => p.status === "in_transit" || p.status === "warehouse").length || 0;

  return (
    <div className="relative flex h-dvh min-h-screen overflow-hidden bg-background">
      <div className="edge-glow-top" />
      <div className="edge-glow-bottom" />
      <div className="bg-noise" />

      <Sidebar isOpen={sidebarOpen} onToggle={setSidebarOpen} />

      <div className="scrollbar-hide relative flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-4 py-12 md:px-8 md:py-16">
          <header className="mb-8 pt-4 md:pt-0">
            <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
              <div>
                <h1 className="flex items-center gap-2 text-3xl font-black tracking-tight text-foreground md:text-4xl">
                  <PackageIcon size={32} className="text-primary" />
                  Packages
                </h1>
                <p className="mt-1 font-medium text-foreground/50">
                   Track your local and international shipments.
                </p>
              </div>
              
              <div className="flex flex-wrap items-center gap-2">
                 <Button variant="outline" size="sm" onClick={handleExportCSV} className="h-9 gap-2 text-xs font-bold">
                    <Download size={14} />
                    <span className="hidden sm:inline">Export CSV</span>
                    <span className="sm:hidden">Export</span>
                 </Button>

                 <Button variant="outline" size="sm" onClick={handleSeed} className="h-9 gap-2 text-xs font-bold">
                    <Database size={14} />
                    <span className="hidden sm:inline">Seed Real Data</span>
                    <span className="sm:hidden">Seed</span>
                 </Button>
              </div>
            </div>
          </header>

          {/* Stats Summary - Responsive Grid */}
          <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
             <StatCard 
                label="Ready for Pickup" 
                value={pickupCount} 
                icon={MapPin}
                variant="success"
             />
             <StatCard 
                label="In Transit" 
                value={transitCount} 
                icon={Truck}
             />
             <StatCard 
                label="Total Active" 
                value={isAuthenticated ? ((rawPackages?.filter(p => p.status !== "delivered").length) || 0) : 0} 
                icon={PackageIcon}
             />
             <StatCard 
                label="Delivered" 
                value={(rawPackages?.filter(p => p.status === "delivered").length) || 0} 
                icon={CheckCircle2}
                variant="ghost"
             />
          </div>

          {/* Filtering & View Bar */}
          <div className="mb-6 flex flex-col gap-4">
             <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative flex-1 max-w-md">
                   <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground/30" size={16} />
                   <input 
                      type="text"
                      placeholder="Search by merchant, tracking #, or items..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-10 w-full rounded-xl border border-black/5 bg-black/[0.02] pl-10 pr-10 text-sm font-medium transition-all focus:border-primary/20 focus:bg-white focus:outline-none focus:ring-4 focus:ring-primary/5"
                   />
                   {searchQuery && (
                      <button 
                        onClick={() => setSearchQuery("")}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground/30 hover:text-foreground"
                      >
                        <X size={14} />
                      </button>
                   )}
                </div>

                <div className="flex items-center gap-3">
                   <div className="flex items-center gap-2 rounded-xl border border-black/5 bg-black/[0.02] px-3 h-10">
                      <ArrowUpDown size={14} className="text-foreground/30" />
                      <select 
                         value={sortBy}
                         onChange={(e) => setSortBy(e.target.value)}
                         className="bg-transparent text-xs font-bold text-foreground/60 focus:outline-none"
                      >
                         <option value="newest">Newest</option>
                         <option value="oldest">Oldest</option>
                         <option value="cost_high">Highest Cost</option>
                         <option value="cost_low">Lowest Cost</option>
                         <option value="weight_high">Heaviest</option>
                         <option value="weight_low">Lightest</option>
                      </select>
                   </div>

                    <div className="flex items-center gap-1 rounded-xl bg-black/[0.03] p-1">
                       <button 
                          onClick={() => setViewMode("card")}
                          aria-label="Card view"
                          className={cn(
                             "flex h-8 w-8 items-center justify-center rounded-lg transition-all",
                             viewMode === "card" ? "bg-white text-primary shadow-sm" : "text-foreground/40 hover:text-foreground"
                          )}
                       >
                          <LayoutGrid size={16} />
                       </button>
                       <button 
                          onClick={() => setViewMode("table")}
                          aria-label="Table view"
                          className={cn(
                             "flex h-8 w-8 items-center justify-center rounded-lg transition-all",
                             viewMode === "table" ? "bg-white text-primary shadow-sm" : "text-foreground/40 hover:text-foreground"
                          )}
                       >
                          <ListIcon size={16} />
                       </button>
                    </div>
                </div>
             </div>

             <div className="flex flex-wrap items-center justify-between gap-y-4">
                <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
                   <button 
                      onClick={() => setStatusFilter("all")}
                      className={cn(
                         "flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-all",
                         statusFilter === "all" ? "bg-primary text-primary-foreground shadow-sm" : "bg-black/[0.03] text-foreground/40 hover:bg-black/[0.06]"
                      )}
                   >
                      All Packages
                      {statusCounts.all > 0 && <span className="opacity-40">{statusCounts.all}</span>}
                   </button>
                   {Object.entries(STATUS_CONFIG).map(([key, config]) => (
                      <button 
                         key={key}
                         onClick={() => setStatusFilter(key)}
                         className={cn(
                            "flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-all",
                            statusFilter === key ? config.bgColor + " " + config.color : "bg-black/[0.03] text-foreground/40 hover:bg-black/[0.06]"
                         )}
                      >
                         {config.label}
                         {statusCounts[key] > 0 && <span className="opacity-40">{statusCounts[key]}</span>}
                      </button>
                   ))}
                </div>

                {(searchQuery || statusFilter !== "all") && (
                   <button 
                      onClick={handleClearFilters}
                      className="text-[10px] font-bold text-primary hover:underline"
                   >
                      Clear all filters
                   </button>
                )}
             </div>

             <div className="text-[10px] font-bold uppercase tracking-widest text-foreground/20">
                Showing {packages?.length || 0} of {rawPackages?.length || 0} packages
             </div>
          </div>


          <AnimatePresence mode="wait">
             {!isAuthenticated ? (
               <motion.div
                 key="auth-prompt"
                 initial={{ opacity: 0, scale: 0.95 }}
                 animate={{ opacity: 1, scale: 1 }}
                 exit={{ opacity: 0, scale: 0.95 }}
                 className="mt-8"
               >
                 <PackageAuthPrompt />
               </motion.div>
             ) : viewMode === "card" ? (
               <motion.div 
                  key="card-view"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-8"
               >
                  {/* Pickup Section Highlight */}
                  {filteredPickupItems.length > 0 && (
                    <section>
                      <h2 className="mb-4 flex items-center gap-2 text-sm font-bold tracking-wider text-green-500 uppercase">
                        <MapPin size={16} />
                        Ready at Branch
                      </h2>
                      <div className="grid grid-cols-1 gap-4">
                        {filteredPickupItems.map(pkg => (
                          <PackageCard key={pkg._id} pkg={pkg} />
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Main List */}
                  <section>
                    <h2 className="mb-4 flex items-center gap-2 text-sm font-bold tracking-wider text-foreground/40 uppercase">
                      <LayoutDashboard size={16} />
                      All Shipments
                    </h2>
                    <div className="grid grid-cols-1 gap-4">
                      {!packages ? (
                         Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-32 w-full animate-pulse rounded-2xl bg-black/[0.03]" />)
                      ) : (packages.length === 0 || packages.filter(p => p.status !== "ready_for_pickup").length === 0) && (searchQuery || statusFilter !== "all") ? (
                        <EmptyState hasFilters onClear={handleClearFilters} />
                      ) : packages.length === 0 ? (
                        <EmptyState />
                      ) : (
                        packages.filter(p => p.status !== "ready_for_pickup").map(pkg => (
                          <PackageCard key={pkg._id} pkg={pkg} />
                        ))
                      )}
                    </div>
                  </section>
               </motion.div>
             ) : (
               <motion.div 
                  key="table-view"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  transition={{ duration: 0.2 }}
               >
                  <section>
                     <h2 className="mb-4 flex items-center gap-2 text-sm font-bold tracking-wider text-foreground/40 uppercase">
                        <ListIcon size={16} />
                        Package Inventory
                     </h2>
                     <div className="overflow-hidden rounded-2xl border border-black/5 bg-background shadow-sm">
                        <div className="overflow-x-auto">
                           {!packages ? (
                              <div className="h-64 w-full animate-pulse bg-black/[0.01]" />
                            ) : packages.length === 0 ? (
                               <EmptyState 
                                 hasFilters={!!(searchQuery || statusFilter !== "all")} 
                                 onClear={handleClearFilters} 
                               />
                           ) : (
                              <table className="w-full text-left">
                                 <thead className="bg-black/[0.02] text-[10px] font-bold tracking-wider text-foreground/40 uppercase">
                                    <tr>
                                       <th className="px-6 py-4">Merchant & Description</th>
                                       <th className="px-6 py-4">Tracking Number</th>
                                       <th className="px-6 py-4 text-right">Status</th>
                                       <th className="px-6 py-4 text-right">Weight</th>
                                       <th className="px-6 py-4 text-right">Cost</th>
                                       <th className="px-6 py-4"></th>
                                    </tr>
                                 </thead>
                                 <tbody className="divide-y divide-black/5">
                                    {packages.map(pkg => (
                                       <tr key={pkg._id} className="group hover:bg-black/[0.01]">
                                          <td className="px-6 py-5">
                                             <div className="flex flex-col">
                                                <span className="text-xs font-bold text-foreground">{pkg.merchant}</span>
                                                <span className="mt-0.5 truncate text-[13px] font-medium text-foreground/70">{pkg.description}</span>
                                             </div>
                                          </td>
                                          <td className="px-6 py-5">
                                             <span className="font-mono text-[11px] font-bold text-foreground/40 group-hover:text-foreground/60 transition-colors uppercase tracking-tight">{pkg.trackingNumber}</span>
                                          </td>
                                           <td className="px-6 py-5 text-right">
                                              <div className="flex items-center justify-end gap-2">
                                                 <div className={cn("h-1.5 w-1.5 rounded-full animate-pulse", STATUS_CONFIG[pkg.status].indicatorColor)} />
                                                 <span className={cn("text-[11px] font-black uppercase tracking-widest", STATUS_CONFIG[pkg.status].color)}>
                                                    {STATUS_CONFIG[pkg.status].label}
                                                 </span>
                                              </div>
                                           </td>
                                          <td className="px-6 py-5 text-right">
                                             <span className="text-xs font-bold text-foreground/60">{pkg.weight ? `${pkg.weight} lbs` : "--"}</span>
                                          </td>
                                          <td className="px-6 py-5 text-right">
                                             <span className="text-sm font-black text-foreground">
                                                {pkg.cost ? `$${pkg.cost.toLocaleString()}` : "--"}
                                             </span>
                                          </td>
                                          <td className="px-6 py-5 text-right">
                                             <button className="rounded-full p-2 text-foreground/20 hover:bg-black/[0.05] hover:text-foreground transition-all">
                                                <ChevronRight size={16} />
                                             </button>
                                          </td>
                                       </tr>
                                    ))}
                                 </tbody>
                              </table>
                           )}
                        </div>
                     </div>
                  </section>
               </motion.div>
             )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function PackageAuthPrompt() {
  const navigate = useNavigate();
  const location = window.location.pathname + window.location.search;

  return (
    <Card className="overflow-hidden border-none bg-black/[0.02] shadow-none">
      <CardContent className="flex flex-col items-center justify-center py-20 text-center">
        <div className="relative mb-8">
          <div className="absolute -inset-4 animate-pulse rounded-full bg-primary/10 blur-xl" />
          <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10">
            <PackageIcon size={40} className="text-primary" />
          </div>
        </div>
        
        <h2 className="mb-3 text-2xl font-black tracking-tight text-foreground">Sign in to track packages</h2>
        <p className="max-w-md text-sm font-medium text-foreground/40">
          Your active shipments, status updates, and history are only visible to you. Join SendCat to manage your deliveries.
        </p>

        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
          <Button 
            onClick={() => navigate({ to: "/sign-in", search: { redirect: location } })}
            className="h-12 rounded-2xl px-12 text-sm font-black uppercase tracking-wider shadow-lg shadow-primary/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            Sign In
          </Button>
          <Button 
            variant="ghost" 
            onClick={() => navigate({ to: "/sign-up", search: { redirect: location } })}
            className="h-12 rounded-2xl px-8 text-sm font-black uppercase tracking-wider text-foreground/40 hover:bg-black/[0.05] hover:text-foreground"
          >
            Create Account
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ onClear, hasFilters }: { onClear?: () => void, hasFilters?: boolean }) {
   return (
      <Card className="border-none bg-black/[0.02] shadow-none">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
           <Box size={48} className="mb-4 text-foreground/10" />
           <p className="font-bold text-foreground/40">
              {hasFilters ? "No matching packages found" : "No packages found"}
           </p>
           <p className="text-sm text-foreground/30">
              {hasFilters ? "Try adjusting your search or filters." : "Your shipments will appear here automatically."}
           </p>
           {hasFilters && onClear && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={onClear} 
                className="mt-6 h-9 rounded-xl border-primary/20 bg-primary/5 text-xs font-bold text-primary hover:bg-primary/10"
              >
                 Clear all filters
              </Button>
           )}
        </CardContent>
      </Card>
   );
}


function StatCard({ label, value, icon: Icon, variant = "default" }: { label: string, value: number, icon: LucideIcon, variant?: "default" | "success" | "ghost" }) {
  const styles = {
    default: "bg-black/[0.03] border-none shadow-none",
    success: "bg-green-500/10 border-green-500/20 shadow-none",
    ghost: "bg-transparent border border-black/5 shadow-none",
  };

  return (
    <Card className={cn("overflow-hidden rounded-2xl p-4 transition-all", styles[variant])}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold tracking-wider text-foreground/40 uppercase">{label}</span>
            <Icon size={14} className="text-foreground/30" />
        </div>
        <span className="text-2xl font-black text-foreground">{value}</span>
      </div>
    </Card>
  );
}

function PackageCard({ pkg }: { pkg: Package }) {
  const config = STATUS_CONFIG[pkg.status];
  const StatusIcon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "group relative overflow-hidden rounded-2xl border transition-all duration-300",
        pkg.status === "ready_for_pickup" 
          ? "border-green-500/30 bg-green-500/[0.02]" 
          : "border-black/5 bg-background hover:bg-black/[0.01] hover:shadow-sm"
      )}
    >
      <div className="flex flex-col md:flex-row">
        {/* Status Indicator Bar */}
        <div className={cn("flex shrink-0 h-1 md:w-1 md:h-auto", config.barColor)} />
        
        <div className="flex flex-1 flex-col p-4 md:flex-row md:items-center md:gap-6 md:p-5">
           {/* Primary Info */}
           <div className="flex flex-1 items-center gap-4">
              <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl md:h-14 md:w-14", config.bgColor)}>
                 <StatusIcon className={cn("w-6 h-6", config.color)} />
              </div>
              <div className="min-w-0">
                 <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-bold text-foreground">{pkg.merchant}</span>
                    {pkg.weight && (
                       <span className="rounded-md bg-black/[0.03] px-1.5 py-0.5 text-[10px] font-bold text-foreground/40">{pkg.weight} lbs</span>
                    )}
                 </div>
                 <h3 className="truncate text-base font-black text-foreground/90">{pkg.description}</h3>
                 <div className="mt-1 flex items-center gap-2 font-mono text-[10px] font-bold text-foreground/30">
                    <span className="uppercase tracking-wider">{pkg.trackingNumber}</span>
                 </div>
              </div>
           </div>

           {/* Location / Status Info */}
           <div className="mt-4 flex shrink-0 items-center justify-between border-t border-black/5 pt-4 md:mt-0 md:flex-col md:items-end md:justify-center md:border-none md:pt-0">
              <div className="flex flex-col md:items-end">
                 <span className={cn("text-[11px] font-black uppercase tracking-widest", config.color)}>
                    {config.label}
                 </span>
                 {pkg.location && (
                    <span className="mt-0.5 text-[11px] font-bold text-foreground/40">{pkg.location}</span>
                 )}
              </div>
              
              <div className="flex items-center gap-3 md:mt-2">
                 {pkg.cost && (
                    <span className="text-sm font-black text-foreground">
                       ${pkg.cost.toLocaleString()} <span className="text-[10px] text-foreground/30">JMD</span>
                    </span>
                 )}
                  <button 
                    aria-label="View package details"
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.03] text-foreground/30 transition-colors hover:bg-black/[0.06] hover:text-foreground"
                  >
                     <ChevronRight size={16} />
                  </button>
              </div>
           </div>
        </div>
      </div>
    </motion.div>
  );
}
