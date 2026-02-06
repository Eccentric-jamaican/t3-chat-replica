import { type Product } from "../data/mockProducts";

type EbayMoney = {
  currency?: string;
  value?: string | number;
};

type EbayImage = {
  imageUrl?: string;
};

type EbaySeller = {
  username?: string;
  feedbackPercentage?: number;
};

type EbayProductMeta = {
  averageRating?: number;
  reviewCount?: number;
};

export type EbayItemDetails = {
  itemId: string;
  title?: string;
  price?: EbayMoney;
  image?: EbayImage;
  additionalImages?: EbayImage[];
  itemWebUrl?: string;
  seller?: EbaySeller;
  condition?: string;
  product?: EbayProductMeta;
};

export function mapEbayItemDetailsToProduct(data: EbayItemDetails): Product {
  const currency = data.price?.currency;
  const value = data.price?.value;
  const priceRange =
    currency && value != null && String(value).trim()
      ? `${currency} ${value}`
      : "";

  return {
    id: data.itemId,
    title: data.title ?? "",
    priceRange,
    image: data.image?.imageUrl || data.additionalImages?.[0]?.imageUrl || "",
    url: data.itemWebUrl ?? "",
    source: "ebay",
    sellerName: data.seller?.username,
    sellerFeedback:
      data.seller?.feedbackPercentage != null
        ? `${data.seller.feedbackPercentage}%`
        : undefined,
    condition: data.condition,
    rating: data.product?.averageRating,
    reviews: data.product?.reviewCount,
  };
}

