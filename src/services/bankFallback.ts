import { PaystackBank } from "./paystackClient";

export const NIGERIA_BANK_FALLBACKS: PaystackBank[] = [
  { name: "Access Bank", code: "044", slug: "access-bank" },
  { name: "Citibank Nigeria", code: "023", slug: "citibank-nigeria" },
  { name: "Ecobank Nigeria", code: "050", slug: "ecobank-nigeria" },
  { name: "Fidelity Bank", code: "070", slug: "fidelity-bank" },
  { name: "First Bank of Nigeria", code: "011", slug: "first-bank-of-nigeria" },
  { name: "First City Monument Bank", code: "214", slug: "first-city-monument-bank" },
  { name: "Globus Bank", code: "00103", slug: "globus-bank" },
  { name: "Guaranty Trust Bank", code: "058", slug: "guaranty-trust-bank" },
  { name: "Keystone Bank", code: "082", slug: "keystone-bank" },
  { name: "Kuda Bank", code: "50211", slug: "kuda-bank" },
  { name: "Moniepoint MFB", code: "50515", slug: "moniepoint-mfb" },
  { name: "Opay", code: "999992", slug: "opay" },
  { name: "Palmpay", code: "999991", slug: "palmpay" },
  { name: "Polaris Bank", code: "076", slug: "polaris-bank" },
  { name: "Providus Bank", code: "101", slug: "providus-bank" },
  { name: "Stanbic IBTC Bank", code: "221", slug: "stanbic-ibtc-bank" },
  { name: "Standard Chartered Bank", code: "068", slug: "standard-chartered-bank" },
  { name: "Sterling Bank", code: "232", slug: "sterling-bank" },
  { name: "Suntrust Bank", code: "100", slug: "suntrust-bank" },
  { name: "Titan Trust Bank", code: "102", slug: "titan-trust-bank" },
  { name: "Union Bank of Nigeria", code: "032", slug: "union-bank-of-nigeria" },
  { name: "United Bank For Africa", code: "033", slug: "united-bank-for-africa" },
  { name: "Unity Bank", code: "215", slug: "unity-bank" },
  { name: "Wema Bank", code: "035", slug: "wema-bank" },
  { name: "Zenith Bank", code: "057", slug: "zenith-bank" },
];

export function filterBanks(banks: PaystackBank[], query: string, limit = 8) {
  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? banks.filter((bank) =>
        bank.name.toLowerCase().includes(normalized) ||
        bank.code.includes(normalized) ||
        (bank.slug || "").includes(normalized)
      )
    : banks;
  return filtered.slice(0, limit);
}
