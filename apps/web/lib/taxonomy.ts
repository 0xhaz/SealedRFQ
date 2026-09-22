/**
 * The fixed vocabulary for category and region.
 *
 * Both are `bytes32` labels on-chain and neither drives any contract logic — they exist to be read
 * and filtered. Free text defeated exactly that: SOFTWARE, Software and SW are three categories to
 * a machine and one to a person, so a supplier watching for work in their field misses two thirds
 * of it. Anything past 31 characters was also silently truncated on the way in.
 *
 * Values are what goes on-chain and must never change once RFQs carry them; labels are what people
 * read and can. Older RFQs may hold text outside this list — the board decodes whatever the chain
 * holds rather than assuming it appears here.
 */
export type Option = { value: string; label: string };

export const CATEGORIES: Option[] = [
  { value: "SOFTWARE", label: "Software and licences" },
  { value: "HARDWARE", label: "Hardware and equipment" },
  { value: "IT_SERVICES", label: "IT services and support" },
  { value: "PROFESSIONAL_SERVICES", label: "Professional services and consulting" },
  { value: "LOGISTICS", label: "Logistics and freight" },
  { value: "MANUFACTURING", label: "Manufacturing and fabrication" },
  { value: "RAW_MATERIALS", label: "Raw materials and components" },
  { value: "CONSTRUCTION", label: "Construction and civil works" },
  { value: "FACILITIES", label: "Facilities and maintenance" },
  { value: "OFFICE_SUPPLIES", label: "Office supplies and consumables" },
  { value: "MARKETING", label: "Marketing and creative" },
  { value: "LEGAL", label: "Legal and compliance" },
  { value: "HR_RECRUITMENT", label: "People and recruitment" },
  { value: "ENERGY", label: "Energy and utilities" },
  { value: "SECURITY", label: "Security services" },
  { value: "TRAVEL", label: "Travel and accommodation" },
  { value: "OTHER", label: "Other" },
];

export const REGIONS: Option[] = [
  { value: "GLOBAL", label: "Global — no delivery restriction" },
  { value: "NORTH_AMERICA", label: "North America" },
  { value: "LATAM", label: "Latin America" },
  { value: "EU", label: "European Union" },
  { value: "UK", label: "United Kingdom" },
  { value: "MENA", label: "Middle East and North Africa" },
  { value: "AFRICA", label: "Africa" },
  { value: "APAC", label: "Asia Pacific" },
  { value: "SEA", label: "South East Asia" },
  { value: "ANZ", label: "Australia and New Zealand" },
];

/** The label for a stored value, falling back to the value for RFQs posted before this list. */
export function labelFor(options: Option[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}
