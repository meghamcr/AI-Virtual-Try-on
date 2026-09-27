import { z } from "zod";
// MV3 prohibits dynamic code evaluation, including optional validator JIT probes.
z.config({ jitless: true });
export const slots = [
  "full",
  "upper",
  "lower",
  "feet",
  "face",
  "extra",
] as const;
export const slotSchema = z.enum(slots);
export type Slot = z.infer<typeof slotSchema>;
export const categoryIds = [
  "tops",
  "shirts",
  "dresses",
  "jackets",
  "pants",
  "shoes",
  "jewellery",
  "necklaces",
  "accessories",
] as const;
export type CategoryId = (typeof categoryIds)[number];
export type Category = {
  id: CategoryId;
  label: string;
  photos: Slot[];
  modelCategory?: "tops" | "bottoms" | "one-pieces";
  guidance: string;
  imageTypes: readonly string[];
  providers: readonly string[];
  preprocessing: string;
  settings: { mode: "balanced" };
};
const category = (
  id: CategoryId,
  label: string,
  photos: Slot[],
  modelCategory: Category["modelCategory"],
  guidance: string,
): Category => ({
  id,
  label,
  photos,
  modelCategory,
  guidance,
  imageTypes: ["flat-lay", "model", "auto"],
  providers: modelCategory ? ["fashn/tryon-v1.6"] : [],
  preprocessing:
    "Orient, remove metadata, normalize JPEG, bound longest edge to 1600px",
  settings: { mode: "balanced" },
});
export const categories: Category[] = [
  category(
    "tops",
    "T-shirts & tops",
    ["upper", "full"],
    "tops",
    "Use a clear upper-body or full-body photo; keep arms away from the torso.",
  ),
  category(
    "shirts",
    "Shirts",
    ["upper", "full"],
    "tops",
    "Use an unobstructed upper body with good, even lighting.",
  ),
  category(
    "dresses",
    "Dresses",
    ["full"],
    "one-pieces",
    "Use a full-body standing photograph with legs and torso visible.",
  ),
  category(
    "jackets",
    "Jackets",
    ["upper", "full"],
    "tops",
    "Use a clear torso view; bulky layers may reduce fidelity.",
  ),
  category(
    "pants",
    "Pants & trousers",
    ["lower", "full"],
    "bottoms",
    "Include waist, legs and ankles, with minimal perspective distortion.",
  ),
  category(
    "shoes",
    "Shoes",
    ["feet"],
    undefined,
    "A footwear provider adapter is not enabled.",
  ),
  category(
    "jewellery",
    "Jewellery",
    ["face"],
    undefined,
    "A jewellery provider adapter is not enabled.",
  ),
  category(
    "necklaces",
    "Necklaces",
    ["upper"],
    undefined,
    "A necklace provider adapter is not enabled.",
  ),
  category(
    "accessories",
    "Other accessories",
    ["full"],
    undefined,
    "An accessories provider adapter is not enabled.",
  ),
];
export function readiness(id: CategoryId, available: readonly string[]) {
  const c = categories.find((c) => c.id === id)!;
  return {
    ready: !!c.modelCategory && c.photos.some((p) => available.includes(p)),
    slot: c.photos.find((p) => available.includes(p)),
    reason: !c.modelCategory
      ? c.guidance
      : `${c.photos.join(" or ")} photo required`,
  };
}
export function inferCategory(title: string): CategoryId {
  if (/dress|jumpsuit/i.test(title)) return "dresses";
  if (/trouser|pant|jean|shorts/i.test(title)) return "pants";
  if (/shoe|sneaker|sandal|boot/i.test(title)) return "shoes";
  if (/necklace/i.test(title)) return "necklaces";
  if (/jewel|earring|bracelet/i.test(title)) return "jewellery";
  if (/jacket|coat|blazer/i.test(title)) return "jackets";
  if (/\bshirt\b/i.test(title) && !/t.shirt/i.test(title)) return "shirts";
  return "tops";
}
export const httpUrl = z
  .string()
  .max(4096)
  .url()
  .refine((s) => /^https?:\/\//i.test(s), "HTTP(S) URL required");
export const imageSchema = z.object({
  url: httpUrl,
  width: z.number().optional(),
  height: z.number().optional(),
  score: z.number().default(0),
  variant: z.string().max(200).optional(),
});
export const variantSchema = z.object({
  label: z.string().max(200),
  image: httpUrl.optional(),
  selected: z.boolean().optional(),
});
export const productSchema = z.object({
  id: z.string().max(200),
  source: httpUrl,
  url: httpUrl,
  title: z.string().min(1).max(500),
  description: z.string().max(3000).optional(),
  brand: z.string().max(200).optional(),
  price: z.string().max(80).optional(),
  currency: z.string().max(12).optional(),
  category: z.enum(categoryIds),
  images: z.array(imageSchema).min(1).max(40),
  variants: z.array(variantSchema).max(80).default([]),
  method: z.enum(["jsonld", "microdata", "metadata", "card", "manual"]),
  confidence: z.number().min(0).max(1),
});
export type Product = z.infer<typeof productSchema>;
export const jobSchema = z
  .object({
    profileId: z.string().uuid(),
    product: productSchema,
    selectedImage: httpUrl,
    variant: z.string().max(200).optional(),
    category: z.enum(categoryIds),
    scene: z
      .enum(["original", "studio", "outdoors", "beach", "city"])
      .default("original"),
    consent: z.literal(true),
    idempotencyKey: z.string().uuid(),
  })
  .refine(
    (v) => v.product.images.some((i) => i.url === v.selectedImage),
    "Select an image belonging to the product",
  );
export const authSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z
    .string()
    .min(12)
    .max(72)
    .refine(
      (value) => new TextEncoder().encode(value).length <= 72,
      "Password exceeds the 72-byte limit",
    ),
});
export const profileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  isDefault: z.boolean().optional(),
});
export const terminal = ["completed", "failed", "cancelled"];
export const statuses = [
  "queued",
  "validating",
  "preparing",
  "submitted",
  "generating",
  "saving",
  "completed",
  "failed",
  "cancelled",
] as const;
export function canTransition(from: string, to: string) {
  return (
    !terminal.includes(from) &&
    (to === "cancelled" ||
      to === "failed" ||
      statuses.indexOf(to as (typeof statuses)[number]) >=
        statuses.indexOf(from as (typeof statuses)[number]))
  );
}
export const messageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("SCAN") }),
  z.object({ type: z.literal("PICK") }),
  z.object({
    type: z.literal("PRODUCTS"),
    url: httpUrl,
    products: z.array(productSchema).max(60),
  }),
  z.object({ type: z.literal("PICKED"), product: productSchema }),
]);
export type ExtensionMessage = z.infer<typeof messageSchema>;
