// How money can be paid. Pure, so screens and services share it.
export const METHODS = ['CASH', 'ECOCASH', 'ONEMONEY', 'INNBUCKS', 'SWIPE', 'BANK_TRANSFER', 'ZIPIT', 'BANK_DEPOSIT', 'CHEQUE', 'PAYNOW'] as const;
export type Method = (typeof METHODS)[number] | 'CREDIT_TRANSFER';

export const METHOD_LABEL: Record<Method, string> = {
  CASH: 'Cash', ECOCASH: 'EcoCash', ONEMONEY: 'OneMoney', INNBUCKS: 'InnBucks', SWIPE: 'Swipe (POS)', BANK_TRANSFER: 'Bank transfer / RTGS', ZIPIT: 'ZIPIT',
  BANK_DEPOSIT: 'Bank deposit slip', CHEQUE: 'Cheque', PAYNOW: 'Paynow online', CREDIT_TRANSFER: 'Credit moved from a brother or sister',
};

/** Methods a clerk may pick (Paynow and credit transfers are made by the system). */
export const CLERK_METHODS: Method[] = ['CASH', 'ECOCASH', 'ONEMONEY', 'INNBUCKS', 'SWIPE', 'BANK_TRANSFER', 'ZIPIT', 'BANK_DEPOSIT', 'CHEQUE'];

/** Cash is counted in the drawer; its receipt is official at once and the bursar confirms it at the cash-up. */
export const isCash = (m: string) => m === 'CASH';
/** Bank and mobile-money payments above the school's limit need a photo or PDF of the proof. */
export const PROOF_METHODS = new Set<string>(['ECOCASH', 'ONEMONEY', 'INNBUCKS', 'BANK_TRANSFER', 'ZIPIT', 'BANK_DEPOSIT']);
export const needsReference = (m: string) => m !== 'CASH' && m !== 'CREDIT_TRANSFER';

/** Dashboard buckets: cash, EcoCash, bank, Paynow, others. */
export function methodBucket(m: string): 'Cash' | 'EcoCash' | 'Bank' | 'Paynow' | 'Others' {
  if (m === 'CASH') return 'Cash';
  if (m === 'ECOCASH') return 'EcoCash';
  if (m === 'BANK_TRANSFER' || m === 'ZIPIT' || m === 'BANK_DEPOSIT' || m === 'CHEQUE') return 'Bank';
  if (m === 'PAYNOW') return 'Paynow';
  return 'Others';
}
