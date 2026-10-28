export const DOCUMENT_KINDS = [
  'identity_front',
  'identity_back',
  'driver_license',
  'vehicle_registration',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export function validRequiredKinds(value: string) {
  const kinds = value.split(',').map((item) => item.trim());
  return (
    kinds.length > 0 &&
    kinds.length <= 4 &&
    new Set(kinds).size === kinds.length &&
    kinds.every((kind) => DOCUMENT_KINDS.includes(kind as DocumentKind))
  );
}
export function requiredKinds(value: string): DocumentKind[] {
  return value.split(',').map((item) => item.trim() as DocumentKind);
}
