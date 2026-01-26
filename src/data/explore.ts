export interface ExploreCard {
  id: string;
  title: string;
  subtitle: string;
  image: string;
}

export interface Category {
  id: string;
  name: string;
  image: string;
}

export const featuredCards: ExploreCard[] = [
  {
    id: "1",
    title: "Spring Fashion",
    subtitle: "Trending Now",
    image:
      "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&q=80&w=800",
  },
  {
    id: "2",
    title: "Modern Interior Design",
    subtitle: "Home Decor",
    image:
      "https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&q=80&w=800",
  },
  {
    id: "3",
    title: "Gourmet Recipes",
    subtitle: "Culinary Arts",
    image:
      "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&q=80&w=800",
  },
];

export const categories: Category[] = [
  {
    id: "c1",
    name: "Nature",
    image:
      "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&q=80&w=400",
  },
  {
    id: "c2",
    name: "Travel",
    image:
      "https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?auto=format&fit=crop&q=80&w=400",
  },
  {
    id: "c3",
    name: "Architecture",
    image:
      "https://images.unsplash.com/photo-1487958449913-d9279906c275?auto=format&fit=crop&q=80&w=400",
  },
  {
    id: "c4",
    name: "Art",
    image:
      "https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?auto=format&fit=crop&q=80&w=400",
  },
  {
    id: "c5",
    name: "Tech",
    image:
      "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&q=80&w=400",
  },
  {
    id: "c6",
    name: "Fitness",
    image:
      "https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&q=80&w=400",
  },
  {
    id: "c7",
    name: "Movies",
    image:
      "https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&q=80&w=400",
  },
  {
    id: "c8",
    name: "Music",
    image:
      "https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&q=80&w=400",
  },
  {
    id: "women",
    name: "Women",
    image:
      "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&q=80&w=400",
  },
  {
    id: "men",
    name: "Men",
    image:
      "https://images.unsplash.com/photo-1488161628813-244a2ce077a1?auto=format&fit=crop&q=80&w=400",
  },
];

export interface DetailCategory {
  id: string;
  name: string;
  image: string;
  description: string;
  subcategories: Array<{ id: string; name: string; image: string }>;
  featuredItems: ShopItem[];
}

export const categoryDetails: Record<string, DetailCategory> = {
  women: {
    id: "women",
    name: "Women",
    image:
      "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&q=80&w=800",
    description:
      "Explore the latest in womens fashion, from everyday essentials to high-end trends.",
    subcategories: [
      {
        id: "w1",
        name: "Clothing",
        image:
          "https://images.unsplash.com/photo-1525507119028-ed4c629a60a3?auto=format&fit=crop&q=80&w=400",
      },
      {
        id: "w2",
        name: "Shoes",
        image:
          "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?auto=format&fit=crop&q=80&w=400",
      },
      {
        id: "w3",
        name: "Accessories",
        image:
          "https://images.unsplash.com/photo-1523206489230-c012c64b2b48?auto=format&fit=crop&q=80&w=400",
      },
      {
        id: "w4",
        name: "Bags",
        image:
          "https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&q=80&w=400",
      },
    ],
    featuredItems: [
      {
        id: "prod_silk_dress",
        title: "Silk Slip Dress",
        image:
          "https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&q=80&w=400",
        brand: "Luxe Wear",
        rating: 4.8,
      },
      {
        id: "prod_boots",
        title: "Leather Boots",
        image:
          "https://images.unsplash.com/photo-1542291026-7eec264c274d?auto=format&fit=crop&q=80&w=400",
        brand: "SoleStyle",
        rating: 4.9,
      },
      {
        id: "wf3",
        title: "Gold Hoop Earrings",
        image:
          "https://images.unsplash.com/photo-1535633302743-bc90477f183c?auto=format&fit=crop&q=80&w=400",
        brand: "Aurum",
        rating: 4.7,
      },
      {
        id: "wf4",
        title: "Classic Trench",
        image:
          "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&q=80&w=400",
        brand: "OuterShell",
        rating: 4.6,
      },
    ],
  },
  men: {
    id: "men",
    name: "Men",
    image:
      "https://images.unsplash.com/photo-1488161628813-244a2ce077a1?auto=format&fit=crop&q=80&w=800",
    description:
      "Discover curated styles for men, focusing on quality, comfort, and timeless design.",
    subcategories: [
      {
        id: "m1",
        name: "Apparel",
        image:
          "https://images.unsplash.com/photo-1490114538077-0a7f8cb49891?auto=format&fit=crop&q=80&w=400",
      },
      {
        id: "m2",
        name: "Footwear",
        image:
          "https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&q=80&w=400",
      },
      {
        id: "m3",
        name: "Watches",
        image:
          "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&q=80&w=400",
      },
      {
        id: "m4",
        name: "Grooming",
        image:
          "https://images.unsplash.com/photo-1512496015851-a90fb38ba796?auto=format&fit=crop&q=80&w=400",
      },
    ],
    featuredItems: [
      {
        id: "mf1",
        title: "Oxford Shirt",
        image:
          "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&q=80&w=400",
        brand: "CottonCraft",
        rating: 4.8,
      },
      {
        id: "mf2",
        title: "Denim Jacket",
        image:
          "https://images.unsplash.com/photo-1551232864-3f0890e580d9?auto=format&fit=crop&q=80&w=400",
        brand: "Indigo",
        rating: 4.9,
      },
      {
        id: "mf3",
        title: "Minimalist Watch",
        image:
          "https://images.unsplash.com/photo-1524592094714-0f0654e20314?auto=format&fit=crop&q=80&w=400",
        brand: "Tempo",
        rating: 4.7,
      },
      {
        id: "mf4",
        title: "Chelsea Boots",
        image:
          "https://images.unsplash.com/photo-1620138546344-7b2c38516da3?auto=format&fit=crop&q=80&w=400",
        brand: "Urbane",
        rating: 4.6,
      },
    ],
  },
};

export interface ShopItem {
  id: string;
  title: string;
  image: string;
  brand: string;
  rating: number;
  price?: string;
  url?: string;
}

export interface ShopSection {
  id: string;
  title: string;
  items: ShopItem[];
}

export const shopSections: ShopSection[] = [
  {
    id: "trending",
    title: "Trending",
    items: [
      {
        id: "t1",
        title: "Minimalist Setup",
        image:
          "https://images.unsplash.com/photo-1499951360447-b19be8fe80f5?auto=format&fit=crop&q=80&w=400",
        brand: "TechSpace",
        rating: 4.8,
      },
      {
        id: "t2",
        title: "Ergonomic Chair",
        image:
          "https://images.unsplash.com/photo-1580480055273-228ff5388ef8?auto=format&fit=crop&q=80&w=400",
        brand: "ComfortPlus",
        rating: 4.9,
      },
      {
        id: "t3",
        title: "Wireless Buds",
        image:
          "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?auto=format&fit=crop&q=80&w=400",
        brand: "AudioPro",
        rating: 4.7,
      },
      {
        id: "t4",
        title: "Smart Watch",
        image:
          "https://images.unsplash.com/photo-1579586337278-3befd40fd17a?auto=format&fit=crop&q=80&w=400",
        brand: "WristTech",
        rating: 4.6,
      },
      {
        id: "t5",
        title: "Mechanical Keeb",
        image:
          "https://images.unsplash.com/photo-1595225476474-87563907a212?auto=format&fit=crop&q=80&w=400",
        brand: "KeyMaster",
        rating: 4.9,
      },
    ],
  },
  {
    id: "new",
    title: "New Arrivals",
    items: [
      {
        id: "n1",
        title: "Abstract Art",
        image:
          "https://images.unsplash.com/photo-1549490349-8643362247b5?auto=format&fit=crop&q=80&w=400",
        brand: "GalleryOne",
        rating: 4.5,
      },
      {
        id: "n2",
        title: "Ceramic Vase",
        image:
          "https://images.unsplash.com/photo-1578749556935-ef887c462ead?auto=format&fit=crop&q=80&w=400",
        brand: "HomeDeco",
        rating: 4.8,
      },
      {
        id: "n3",
        title: "Travel Bag",
        image:
          "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&q=80&w=400",
        brand: "Wanderlust",
        rating: 4.7,
      },
      {
        id: "n4",
        title: "Desk Lamp",
        image:
          "https://images.unsplash.com/photo-1507473888900-52a11b6d8d66?auto=format&fit=crop&q=80&w=400",
        brand: "Lumina",
        rating: 4.6,
      },
      {
        id: "n5",
        title: "Coffee Maker",
        image:
          "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&q=80&w=400",
        brand: "BrewMaster",
        rating: 4.9,
      },
    ],
  },
];

export interface SubcategoryDetail {
  id: string;
  name: string;
  parentCategory: string;
  image: string;
  items: ShopItem[];
}

export const subcategoryDetails: Record<string, SubcategoryDetail> = {
  w1: {
    id: "w1",
    name: "Clothing",
    parentCategory: "Women",
    image:
      "https://images.unsplash.com/photo-1525507119028-ed4c629a60a3?auto=format&fit=crop&q=80&w=800",
    items: [
      {
        id: "prod_linen_blouse",
        title: "Linen Blouse",
        image:
          "https://images.unsplash.com/photo-1554412930-c74f637c8a3c?auto=format&fit=crop&q=80&w=400",
        brand: "EcoLuxe",
        rating: 4.8,
      },
      {
        id: "wc2",
        title: "Denim Jeans",
        image:
          "https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&q=80&w=400",
        brand: "Indigo",
        rating: 4.7,
      },
      {
        id: "wc3",
        title: "Summer Dress",
        image:
          "https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&q=80&w=400",
        brand: "Soleil",
        rating: 4.9,
      },
      {
        id: "wc4",
        title: "Wool Coat",
        image:
          "https://images.unsplash.com/photo-1539533018447-63fcce2678e3?auto=format&fit=crop&q=80&w=400",
        brand: "Nordic",
        rating: 4.6,
      },
      {
        id: "wc5",
        title: "Silk Scarf",
        image:
          "https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&q=80&w=400",
        brand: "Hermes",
        rating: 4.8,
      },
    ],
  },
  w2: {
    id: "w2",
    name: "Shoes",
    parentCategory: "Women",
    image:
      "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?auto=format&fit=crop&q=80&w=800",
    items: [
      {
        id: "prod_boots",
        title: "Leather Boots",
        image:
          "https://images.unsplash.com/photo-1542291026-7eec264c274d?auto=format&fit=crop&q=80&w=400",
        brand: "SoleStyle",
        rating: 4.9,
      },
      {
        id: "ws2",
        title: "Canvas Sneakers",
        image:
          "https://images.unsplash.com/photo-1525966222134-fcfa99b8ae77?auto=format&fit=crop&q=80&w=400",
        brand: "UrbanStep",
        rating: 4.7,
      },
      {
        id: "ws3",
        title: "Suede Pumps",
        image:
          "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?auto=format&fit=crop&q=80&w=400",
        brand: "Velvet",
        rating: 4.8,
      },
      {
        id: "ws4",
        title: "Strappy Sandals",
        image:
          "https://images.unsplash.com/photo-1562273103-919740f4d1a9?auto=format&fit=crop&q=80&w=400",
        brand: "Azure",
        rating: 4.5,
      },
    ],
  },
};
