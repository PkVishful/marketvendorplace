export const KYC_DOC_TYPES = [
  'GST_CERTIFICATE',
  'PAN_COMPANY',
  'NABL_CERTIFICATE',
  'NABL_SCOPE',
  'ADDRESS_PROOF',
  'ID_PROOF',
  'BANK_PROOF',
] as const;

export type KycDocType = (typeof KYC_DOC_TYPES)[number];
