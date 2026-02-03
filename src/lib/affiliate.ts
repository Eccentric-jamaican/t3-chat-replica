export type EpnConfig = {
  campid: string;
  mkcid: string;
  mkrid: string;
  toolid: string;
  mkevt: string;
  customid?: string;
};

export function buildEpnUrl(targetUrl: string, config?: EpnConfig | null) {
  if (!targetUrl || !config) return targetUrl;
  try {
    const url = new URL(targetUrl);
    url.searchParams.set("mkevt", config.mkevt);
    url.searchParams.set("mkcid", config.mkcid);
    url.searchParams.set("mkrid", config.mkrid);
    url.searchParams.set("campid", config.campid);
    url.searchParams.set("toolid", config.toolid);
    if (config.customid) {
      url.searchParams.set("customid", config.customid);
    } else {
      url.searchParams.delete("customid");
    }
    return url.toString();
  } catch {
    return targetUrl;
  }
}

export function isEbayUrl(targetUrl?: string) {
  if (!targetUrl) return false;
  try {
    const host = new URL(targetUrl).hostname;
    const labels = host.toLowerCase().split(".");
    return labels.includes("ebay");
  } catch {
    return false;
  }
}
