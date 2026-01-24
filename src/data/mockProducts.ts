export type Product = {
  id: string;
  title: string;
  priceRange: string;
  image: string;
  url?: string;
  moq?: string;
  badge?: string;
  supplier?: {
    name: string;
    logo: string;
    years: number;
    country: string;
  };
  sellerName?: string;
  sellerFeedback?: string;
  condition?: string;
  rating?: number;
  reviews?: number;
};

export const MOCK_PRODUCTS: Product[] = [
  {
    id: "prod_001",
    title: "Eco-friendly Custom Printed Kraft Paper Packaging Box For Gift",
    priceRange: "$0.15 - $0.45",
    moq: "500 Pieces",
    image: "https://images.unsplash.com/photo-1606760227091-3dd870d97f1d?q=80&w=600&auto=format&fit=crop",
    badge: "Matches all 3/3 requirements",
    supplier: {
      name: "Shanghai Forest Packing Co., Ltd.",
      logo: "S",
      years: 12,
      country: "CN"
    },
    rating: 4.8,
    reviews: 142
  },
  {
    id: "prod_002",
    title: "Heavy Duty Industrial Warehouse Storage Rack Shelving Unit",
    priceRange: "$45.00 - $89.00",
    moq: "10 Sets",
    image: "https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?q=80&w=600&auto=format&fit=crop",
    badge: "Matches all 2/3 requirements",
    supplier: {
      name: "Guangzhou Maobang Storage Equipment",
      logo: "G",
      years: 8,
      country: "CN"
    },
    rating: 4.5,
    reviews: 56
  },
  {
    id: "prod_003",
    title: "Wholesale High Quality Cotton Blank Plain T Shirts For Men",
    priceRange: "$2.50 - $4.90",
    moq: "100 Pieces",
    image: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?q=80&w=600&auto=format&fit=crop",
    badge: "Matches all 5/5 requirements",
    supplier: {
      name: "Nanchang Ketai Safety Protective",
      logo: "N",
      years: 5,
      country: "CN"
    },
    rating: 4.9,
    reviews: 890
  },
  {
    id: "prod_004",
    title: "Custom Logo Stainless Steel Insulated Vacuum Water Bottle",
    priceRange: "$3.20 - $5.50",
    moq: "200 Pieces",
    image: "https://images.unsplash.com/photo-1602143407151-011141950038?q=80&w=600&auto=format&fit=crop",
    supplier: {
      name: "Yongkang Hersheen Industry & Trade",
      logo: "Y",
      years: 15,
      country: "CN"
    },
    rating: 4.7,
    reviews: 215
  },
  {
    id: "prod_005",
    title: "Modern Ergonomic Office Mesh Chair with Adjustable Headrest",
    priceRange: "$35.00 - $58.00",
    moq: "20 Pieces",
    image: "https://images.unsplash.com/photo-1505797149-4366564f9c2d?q=80&w=600&auto=format&fit=crop",
    badge: "Matches all 2/3 requirements",
    supplier: {
      name: "Foshan Sitzone Furniture Co., Ltd.",
      logo: "F",
      years: 9,
      country: "CN"
    },
    rating: 4.6,
    reviews: 78
  },
  {
    id: "prod_006",
    title: "Biodegradable Compostable Cornstarch Mailing Bags",
    priceRange: "$0.05 - $0.12",
    moq: "10000 Pieces",
    image: "https://images.unsplash.com/photo-1622329381862-2bd392135677?q=80&w=600&auto=format&fit=crop",
    badge: "Matches all 4/4 requirements",
    supplier: {
      name: "Dongguan Xinhai Packaging Material",
      logo: "D",
      years: 4,
      country: "CN"
    },
    rating: 4.8,
    reviews: 320
  },
  {
    id: "prod_007",
    title: "High Precision CNC Machining Aluminum Parts Custom Service",
    priceRange: "$5.00 - $100.00",
    moq: "1 Piece",
    image: "https://images.unsplash.com/photo-1565349196883-8a0a9db5c57b?q=80&w=600&auto=format&fit=crop",
    supplier: {
      name: "Shenzhen Yijin Hardware Co., Ltd.",
      logo: "S",
      years: 11,
      country: "CN"
    },
    rating: 5.0,
    reviews: 42
  },
  {
    id: "prod_008",
    title: "Portable Wireless Bluetooth Speaker Waterproof Outdoor",
    priceRange: "$12.50 - $18.90",
    moq: "50 Pieces",
    image: "https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?q=80&w=600&auto=format&fit=crop",
    badge: "Matches all 1/3 requirements",
    supplier: {
      name: "Shenzhen Jaskey Technology Limited",
      logo: "J",
      years: 14,
      country: "CN"
    },
    rating: 4.4,
    reviews: 156
  },
  {
    id: "prod_silk_dress",
    title: "Silk Slip Dress - Midnight Black",
    priceRange: "$120.00 - $150.00",
    moq: "1 Piece",
    image: "https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&q=80&w=400",
    supplier: { name: "Luxe Wear", logo: "L", years: 3, country: "FR" },
    rating: 4.8,
    reviews: 42
  },
  {
    id: "prod_boots",
    title: "Handcrafted Leather Chelsea Boots",
    priceRange: "$180.00 - $210.00",
    moq: "1 Pair",
    image: "https://images.unsplash.com/photo-1542291026-7eec264c274d?auto=format&fit=crop&q=80&w=400",
    supplier: { name: "SoleStyle", logo: "S", years: 7, country: "IT" },
    rating: 4.9,
    reviews: 89
  },
  {
    id: "prod_linen_blouse",
    title: "Pure Linen Summer Blouse",
    priceRange: "$45.00 - $65.00",
    moq: "2 Pieces",
    image: "https://images.unsplash.com/photo-1554412930-c74f637c8a3c?auto=format&fit=crop&q=80&w=400",
    supplier: { name: "EcoLuxe", logo: "E", years: 2, country: "ES" },
    rating: 4.8,
    reviews: 15
  }
];
