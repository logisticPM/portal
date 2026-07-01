// Public reference profiles for the seeded companies (Wikipedia-style info box:
// HQ, founding year, industry, size, listing, website). Keyed by the exact
// orgName used in fixtures. Portal-submitted companies simply have no profile.
// All facts are public / widely documented; treat figures as approximate.
export interface OrgProfile {
  legalName?: string;
  headquarters: string;
  founded: string;
  industry: string;
  employees?: string;
  ticker?: string;
  website: string;
  about: string;
}

export const orgProfiles: Record<string, OrgProfile> = {
  "RBC (Royal Bank of Canada)": {
    legalName: "Royal Bank of Canada",
    headquarters: "Toronto, Ontario, Canada",
    founded: "1864 (Halifax, NS)",
    industry: "Banking & financial services",
    employees: "~98,000",
    ticker: "TSX / NYSE: RY",
    website: "https://www.rbc.com",
    about:
      "Canada's largest bank by market capitalization, offering personal & commercial banking, wealth management and capital markets across North America.",
  },
  "BMO (Bank of Montreal)": {
    legalName: "Bank of Montreal",
    headquarters: "Montreal, Quebec, Canada (operating HQ Toronto)",
    founded: "1817",
    industry: "Banking & financial services",
    employees: "~47,000",
    ticker: "TSX / NYSE: BMO",
    website: "https://www.bmo.com",
    about:
      "Canada's oldest incorporated bank (est. 1817) and one of its Big Five, with a substantial North American footprint after acquiring Bank of the West.",
  },
  Scotiabank: {
    legalName: "The Bank of Nova Scotia",
    headquarters: "Toronto, Ontario, Canada",
    founded: "1832 (Halifax, NS)",
    industry: "Banking & financial services",
    employees: "~88,000",
    ticker: "TSX / NYSE: BNS",
    website: "https://www.scotiabank.com",
    about:
      "Known as 'Canada's most international bank', with a strong retail and commercial presence across the Americas.",
  },
  "TD Bank Group": {
    legalName: "The Toronto-Dominion Bank",
    headquarters: "Toronto, Ontario, Canada",
    founded: "1955 (merger of Bank of Toronto 1855 & Dominion Bank 1869)",
    industry: "Banking & financial services",
    employees: "~100,000",
    ticker: "TSX / NYSE: TD",
    website: "https://www.td.com",
    about:
      "One of Canada's largest banks, with major retail operations in Canada and along the U.S. East Coast.",
  },
  "Cenovus Energy": {
    headquarters: "Calgary, Alberta, Canada",
    founded: "2009",
    industry: "Oil & gas (integrated)",
    employees: "~8,000",
    ticker: "TSX / NYSE: CVE",
    website: "https://www.cenovus.com",
    about:
      "Integrated oil-sands and natural-gas producer; grew substantially after its 2021 combination with Husky Energy.",
  },
  "Suncor Energy": {
    headquarters: "Calgary, Alberta, Canada",
    founded: "1919",
    industry: "Oil & gas (integrated)",
    employees: "~15,000",
    ticker: "TSX / NYSE: SU",
    website: "https://www.suncor.com",
    about:
      "Integrated energy company and oil-sands pioneer; operates the Petro-Canada retail network.",
  },
  "Hydro One": {
    headquarters: "Toronto, Ontario, Canada",
    founded: "1906 (reorganized 1999)",
    industry: "Electricity transmission & distribution",
    employees: "~9,100",
    ticker: "TSX: H",
    website: "https://www.hydroone.com",
    about:
      "Ontario's largest electricity transmission and distribution utility, serving most of the province.",
  },
  "Teck Resources": {
    headquarters: "Vancouver, British Columbia, Canada",
    founded: "1913 (current form 2001)",
    industry: "Mining & metals",
    employees: "~7,500",
    ticker: "TSX / NYSE: TECK",
    website: "https://www.teck.com",
    about:
      "One of Canada's largest diversified miners — copper and zinc — after divesting its steelmaking-coal business in 2024.",
  },
  "Vale Canada": {
    legalName: "Vale Canada Limited (formerly Inco)",
    headquarters: "Toronto, Ontario, Canada",
    founded: "1902 (as Inco)",
    industry: "Mining (nickel & base metals)",
    ticker: "part of Vale S.A. (NYSE: VALE)",
    website: "https://www.vale.com/canada",
    about:
      "Canadian nickel operations (Sudbury, Voisey's Bay, Long Harbour); a subsidiary of Brazil's Vale S.A. since 2006.",
  },
  "CN (Canadian National Railway)": {
    legalName: "Canadian National Railway Company",
    headquarters: "Montreal, Quebec, Canada",
    founded: "1919",
    industry: "Freight rail transport",
    employees: "~24,000",
    ticker: "TSX / NYSE: CNR / CNI",
    website: "https://www.cn.ca",
    about:
      "Canada's largest railway, spanning Canada and mid-America from the Atlantic and Pacific coasts to the Gulf of Mexico.",
  },
};

export function getOrgProfile(orgName: string): OrgProfile | undefined {
  return orgProfiles[orgName];
}
