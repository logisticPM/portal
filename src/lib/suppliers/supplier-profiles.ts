// Curated public reference profiles for the 10 real Indigenous suppliers (Wikipedia-
// style info box: HQ, founded, industry, employees, owner, website). Keyed by supplier
// id. All facts are real + source-cited (see per-entry comments); unpublished figures
// (employees for FCH, 3NE) are omitted rather than guessed.
export interface SupplierProfile {
  headquarters: string;
  founded: string;
  industry: string;
  employees?: string; // omit if not published
  website: string;
  owner: string;
  about: string;
}

export const supplierProfiles: Record<string, SupplierProfile> = {
  // peacehills.com/index/about-us/corporate-profile
  "s-peacehills": {
    headquarters: "Maskwacis, Alberta (corporate office Edmonton)",
    founded: "1980",
    industry: "Banking & financial services",
    employees: "~100+",
    website: "https://www.peacehills.com/",
    owner: "Samson Cree Nation (wholly owned)",
    about: "Canada's largest First Nation-owned financial institution, providing trust, credit and banking services to individuals, businesses and Indigenous communities.",
  },
  // firstcanadianhealth.biz/about-us ; tcig.biz/first-canadian-health (owner TCIG is MB-based; office Toronto)
  "s-fch": {
    headquarters: "Toronto, Ontario (owner TCIG is Manitoba-based)",
    founded: "1998",
    industry: "Indigenous health benefits & claims processing",
    website: "https://firstcanadianhealth.biz/",
    owner: "Tribal Councils Investment Group of Manitoba",
    about: "Indigenous-owned health-services company supporting nationwide extended-health, dental and pharmaceutical claims processing for Canada's Non-Insured Health Benefits program.",
  },
  // bouchier.ca/who-we-are ; ccab.com (Indigenous Business of the Year)
  "s-bouchier": {
    headquarters: "Fort McKay, Alberta (Edmonton office)",
    founded: "1998",
    industry: "Logistics & industrial services",
    employees: "~1,300",
    website: "https://bouchier.ca/",
    owner: "Bouchier family — Fort McKay First Nation & Mikisew Cree First Nation (CCIB-certified)",
    about: "100% Indigenous-owned provider of civil contracting, facility maintenance and logistics to Alberta's oil sands and industrial sectors.",
  },
  // desnedhe.com/about ; linkedin.com/company/des-nedhe
  "s-desnedhe": {
    headquarters: "Saskatoon, Saskatchewan",
    founded: "1991",
    industry: "Indigenous economic development (diversified)",
    employees: "~273",
    website: "https://desnedhe.com/",
    owner: "English River First Nation",
    about: "The economic development arm of English River First Nation, operating an integrated portfolio spanning construction, mining services, real estate and technology.",
  },
  // kitsaki.com/about ; linkedin.com/company/kitsaki-management-limited-partnership
  "s-kitsaki": {
    headquarters: "La Ronge, Saskatchewan (office in Saskatoon)",
    founded: "1981",
    industry: "Diversified investment / economic development",
    employees: "~1,800 (across all subsidiaries)",
    website: "https://kitsaki.com/",
    owner: "Lac La Ronge Indian Band",
    about: "Conducts the economic-development activities of the Lac La Ronge Indian Band through a diversified portfolio of 14+ businesses (forestry, transport, mining, engineering).",
  },
  // norsask.ca/about-us
  "s-norsask": {
    headquarters: "Meadow Lake, Saskatchewan",
    founded: "1971 (Meadow Lake Tribal Council acquired 100% in 1998)",
    industry: "Forestry / lumber manufacturing",
    employees: "~100",
    website: "https://norsask.ca/",
    owner: "Meadow Lake Tribal Council",
    about: "The largest First Nations-owned sawmill in Canada, producing over 140 million board feet of lumber annually for the nine Meadow Lake Tribal Council communities.",
  },
  // animikii.com/about ; ccib.ca (member)
  "s-animikii": {
    headquarters: "Victoria, British Columbia",
    founded: "2003",
    industry: "Indigenous technology / software",
    employees: "~30–50",
    website: "https://animikii.com/",
    owner: "Indigenous-owned (Jeff Ward, Ojibwe/Métis) — CCIB-certified, Certified B Corp",
    about: "A 100% Indigenous-owned technology company building custom software and web applications guided by Indigenous data-sovereignty principles.",
  },
  // nationstranslation.com/about ; ccib.ca (member)
  "s-ntg": {
    headquarters: "Ottawa, Ontario",
    founded: "2019 (Indigenous-owned; predecessor est. 1992)",
    industry: "Translation & language services",
    employees: "~51–200",
    website: "https://www.nationstranslation.com/",
    owner: "CCIB-certified, 100% First Nations-owned",
    about: "A 100% Indigenous-owned language-services provider offering enterprise translation in 100+ languages, including 30+ Indigenous languages.",
  },
  // 3ne.ca/about-3ne ; 3ne.ca/founding
  "s-3ne": {
    headquarters: "Fort Chipewyan, Alberta",
    founded: "2018",
    industry: "Clean energy / solar power",
    website: "https://www.3ne.ca/",
    owner: "Athabasca Chipewyan First Nation, Mikisew Cree First Nation & Fort Chipewyan Métis Nation (equal partners)",
    about: "Created in 2018 to bring clean electricity to remote Fort Chipewyan; owns and operates a 2.2 MW solar farm — Canada's largest remote-community solar installation.",
  },
  // membertou.ca ; linkedin.com/company/membertou-development-corporation
  "s-membertou": {
    headquarters: "Membertou (Sydney), Nova Scotia",
    founded: "1989",
    industry: "Economic & business development (diversified)",
    employees: "~500–1,000 (across all Membertou entities)",
    website: "https://membertou.ca/",
    owner: "Membertou First Nation (Mi'kmaq)",
    about: "The economic development arm of Membertou First Nation, managing a diverse portfolio including geomatics, trade & convention, fisheries, insurance and a data centre.",
  },
};

export function getSupplierProfile(supplierId: string): SupplierProfile | undefined {
  return supplierProfiles[supplierId];
}
