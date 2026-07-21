export const IMAGE_FIT_OPTIONS = [
  "contain",
  "cover",
  "fill",
  "none",
  "scale-down",
] as const;

export type ImageFit = (typeof IMAGE_FIT_OPTIONS)[number];

export const DEFAULT_IMAGE_FIT: ImageFit = "contain";

export const isImageFit = (value: unknown): value is ImageFit => {
  return IMAGE_FIT_OPTIONS.includes(value as ImageFit);
};

export const normalizeImageFit = (value: unknown): ImageFit => {
  return isImageFit(value) ? value : DEFAULT_IMAGE_FIT;
};

export const normalizeOptionalImageFit = (value: unknown): ImageFit | undefined => {
  return isImageFit(value) ? value : undefined;
};

export const resolveImageFit = (itemFit: unknown, globalFit: unknown): ImageFit => {
  return isImageFit(itemFit) ? itemFit : normalizeImageFit(globalFit);
};
