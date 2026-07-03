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
      "One of Canada's largest diversified miners (copper and zinc) after divesting its steelmaking-coal business in 2024.",
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
  // ── Finance ──
  "Sun Life": {
    legalName: "Sun Life Financial Inc.", headquarters: "Toronto, Ontario, Canada", founded: "1865",
    industry: "Insurance & wealth management", employees: "~30,000", ticker: "TSX / NYSE: SLF",
    website: "https://www.sunlife.com",
    about: "A leading international financial services and insurance organization based in Canada.",
  },
  CIBC: {
    legalName: "Canadian Imperial Bank of Commerce", headquarters: "Toronto, Ontario, Canada",
    founded: "1961 (merger of Commerce 1867 & Imperial 1875)", industry: "Banking & financial services",
    employees: "~48,000", ticker: "TSX / NYSE: CM", website: "https://www.cibc.com",
    about: "One of Canada's Big Five banks, formed by the 1961 merger of the Canadian Bank of Commerce and Imperial Bank.",
  },
  "National Bank of Canada": {
    headquarters: "Montreal, Quebec, Canada", founded: "1859", industry: "Banking & financial services",
    employees: "~30,000", ticker: "TSX: NA", website: "https://www.nbc.ca",
    about: "Canada's sixth-largest bank, with its strongest presence in Quebec.",
  },
  "ATB Financial": {
    legalName: "Alberta Treasury Branches", headquarters: "Edmonton, Alberta, Canada", founded: "1938",
    industry: "Banking (provincial Crown)", employees: "~5,000", website: "https://www.atb.com",
    about: "Alberta's provincial Crown financial institution, serving Albertans since 1938.",
  },
  Vancity: {
    legalName: "Vancouver City Savings Credit Union", headquarters: "Vancouver, British Columbia, Canada",
    founded: "1946", industry: "Banking (credit union)", employees: "~2,700", website: "https://www.vancity.com",
    about: "Canada's largest community credit union by membership, focused on values-based banking.",
  },
  "Canada Life": {
    legalName: "The Canada Life Assurance Company", headquarters: "Winnipeg, Manitoba, Canada", founded: "1847",
    industry: "Insurance & wealth", employees: "~13,000", website: "https://www.canadalife.com",
    about: "Canada's first domestic life insurer (1847), now part of Great-West Lifeco.",
  },
  Manulife: {
    legalName: "Manulife Financial Corporation", headquarters: "Toronto, Ontario, Canada", founded: "1887",
    industry: "Insurance & wealth", employees: "~38,000", ticker: "TSX / NYSE: MFC", website: "https://www.manulife.com",
    about: "Canada's largest insurer and a global wealth and insurance provider (John Hancock in the U.S.).",
  },
  "Co-operators": {
    legalName: "The Co-operators Group Limited", headquarters: "Guelph, Ontario, Canada", founded: "1945",
    industry: "Insurance & financial services (co-operative)", employees: "~6,000", website: "https://www.cooperators.ca",
    about: "A leading Canadian co-operative providing insurance and financial services.",
  },

  // ── Energy / utilities ──
  Enbridge: {
    legalName: "Enbridge Inc.", headquarters: "Calgary, Alberta, Canada", founded: "1949",
    industry: "Energy infrastructure (pipelines & utilities)", employees: "~14,000", ticker: "TSX / NYSE: ENB",
    website: "https://www.enbridge.com",
    about: "A North American energy infrastructure company moving oil, natural gas and renewables.",
  },
  "Imperial Oil": {
    legalName: "Imperial Oil Limited", headquarters: "Calgary, Alberta, Canada", founded: "1880",
    industry: "Oil & gas (integrated)", employees: "~5,000", ticker: "TSX / NYSE: IMO", website: "https://www.imperialoil.ca",
    about: "One of Canada's largest integrated oil companies, majority-owned by ExxonMobil.",
  },
  "BC Hydro": {
    legalName: "British Columbia Hydro and Power Authority", headquarters: "Vancouver, British Columbia, Canada",
    founded: "1961", industry: "Electric utility (provincial Crown)", employees: "~7,000", website: "https://www.bchydro.com",
    about: "British Columbia's provincial Crown electric utility.",
  },
  "Hydro-Québec": {
    headquarters: "Montreal, Quebec, Canada", founded: "1944", industry: "Electric utility (provincial Crown)",
    employees: "~22,000", website: "https://www.hydroquebec.com",
    about: "Quebec's provincial Crown hydroelectric utility, one of the largest producers in North America.",
  },
  "Manitoba Hydro": {
    headquarters: "Winnipeg, Manitoba, Canada", founded: "1961", industry: "Electric & gas utility (provincial Crown)",
    employees: "~5,000", website: "https://www.hydro.mb.ca",
    about: "Manitoba's provincial Crown electricity and natural-gas utility.",
  },
  SaskPower: {
    legalName: "Saskatchewan Power Corporation", headquarters: "Regina, Saskatchewan, Canada", founded: "1929",
    industry: "Electric utility (provincial Crown)", employees: "~3,300", website: "https://www.saskpower.com",
    about: "Saskatchewan's principal provincial Crown electric utility.",
  },
  "Ontario Power Generation": {
    legalName: "Ontario Power Generation Inc.", headquarters: "Toronto, Ontario, Canada", founded: "1999",
    industry: "Electricity generation (provincial Crown)", employees: "~10,000", website: "https://www.opg.com",
    about: "Ontario's provincial Crown electricity generator (nuclear and hydroelectric).",
  },

  // ── Mining ──
  Nutrien: {
    legalName: "Nutrien Ltd.", headquarters: "Saskatoon, Saskatchewan, Canada", founded: "2018 (PotashCorp–Agrium merger)",
    industry: "Agriculture & mining (crop inputs, potash)", employees: "~24,000", ticker: "TSX / NYSE: NTR",
    website: "https://www.nutrien.com",
    about: "The world's largest provider of crop inputs and the largest potash producer.",
  },
  Cameco: {
    legalName: "Cameco Corporation", headquarters: "Saskatoon, Saskatchewan, Canada", founded: "1988",
    industry: "Mining (uranium)", employees: "~4,000", ticker: "TSX: CCO / NYSE: CCJ", website: "https://www.cameco.com",
    about: "One of the world's largest uranium producers, based in Saskatchewan.",
  },
  "Agnico Eagle": {
    legalName: "Agnico Eagle Mines Limited", headquarters: "Toronto, Ontario, Canada", founded: "1957",
    industry: "Mining (gold)", employees: "~20,000", ticker: "TSX / NYSE: AEM", website: "https://www.agnicoeagle.com",
    about: "One of the world's largest gold producers, with operations in Canada, Australia, Finland and Mexico.",
  },
  "Glencore Canada": {
    legalName: "Glencore Canada Corporation", headquarters: "Toronto, Ontario, Canada", founded: "1928 (as Falconbridge)",
    industry: "Mining & metals", employees: "~9,000 (Canada)", website: "https://www.glencore.ca",
    about: "The Canadian arm of global miner Glencore, operating nickel, copper and zinc assets.",
  },
  Newmont: {
    legalName: "Newmont Corporation", headquarters: "Denver, USA (Canadian operations)", founded: "1921",
    industry: "Mining (gold)", ticker: "NYSE: NEM / TSX: NGT", website: "https://www.newmont.com",
    about: "The world's largest gold producer, with Canadian operations including Éléonore and Porcupine.",
  },
  "Iron Ore Company of Canada": {
    legalName: "Iron Ore Company of Canada (IOC)", headquarters: "Montreal, Quebec, Canada", founded: "1949",
    industry: "Mining (iron ore)", employees: "~2,600", website: "https://www.ironore.ca",
    about: "A leading Canadian iron ore producer in Labrador, majority-owned by Rio Tinto.",
  },

  // ── Telecom ──
  TELUS: {
    legalName: "TELUS Corporation", headquarters: "Vancouver, British Columbia, Canada", founded: "1990",
    industry: "Telecommunications", employees: "~100,000 (incl. TELUS Digital)", ticker: "TSX: T / NYSE: TU",
    website: "https://www.telus.com",
    about: "One of Canada's largest telecommunications companies; first Canadian tech company to publish a reconciliation action plan.",
  },
  "Bell Canada": {
    legalName: "Bell Canada (BCE Inc.)", headquarters: "Montreal (Verdun), Quebec, Canada", founded: "1880",
    industry: "Telecommunications & media", employees: "~40,000", ticker: "TSX / NYSE: BCE", website: "https://www.bell.ca",
    about: "Canada's largest telecommunications company, part of BCE Inc.",
  },
  "Rogers Communications": {
    legalName: "Rogers Communications Inc.", headquarters: "Toronto, Ontario, Canada", founded: "1960",
    industry: "Telecommunications & media", employees: "~25,000", ticker: "TSX / NYSE: RCI", website: "https://www.rogers.com",
    about: "A major Canadian telecom and media company spanning wireless, cable, and sports & media.",
  },

  // ── Transport ──
  "CPKC (Canadian Pacific Kansas City)": {
    legalName: "Canadian Pacific Kansas City Limited", headquarters: "Calgary, Alberta, Canada",
    founded: "1881 (CPKC formed 2023)", industry: "Freight rail transport", employees: "~20,000",
    ticker: "TSX / NYSE: CP", website: "https://www.cpkcr.com",
    about: "The first single-line railway connecting Canada, the U.S. and Mexico, formed by the 2023 CP–KCS merger.",
  },
  WestJet: {
    legalName: "WestJet Airlines Ltd.", headquarters: "Calgary, Alberta, Canada", founded: "1996",
    industry: "Aviation (airline)", employees: "~14,000", website: "https://www.westjet.com",
    about: "Canada's second-largest airline, based in Calgary.",
  },
  "VIA Rail": {
    legalName: "VIA Rail Canada Inc.", headquarters: "Montreal, Quebec, Canada", founded: "1977",
    industry: "Passenger rail (federal Crown)", employees: "~3,000", website: "https://www.viarail.ca",
    about: "Canada's national passenger rail service, a federal Crown corporation.",
  },
  "Toronto Pearson (GTAA)": {
    legalName: "Greater Toronto Airports Authority", headquarters: "Mississauga, Ontario, Canada", founded: "1996",
    industry: "Airport operations", employees: "~1,800 (GTAA)", website: "https://www.torontopearson.com",
    about: "Operator of Toronto Pearson International Airport, Canada's largest airport.",
  },

  // ── Retail ──
  "Loblaw Companies": {
    legalName: "Loblaw Companies Limited", headquarters: "Brampton, Ontario, Canada", founded: "1919",
    industry: "Retail (grocery & pharmacy)", employees: "~220,000", ticker: "TSX: L", website: "https://www.loblaw.ca",
    about: "Canada's largest food and pharmacy retailer.",
  },
  "IKEA Canada": {
    legalName: "IKEA Canada Limited Partnership", headquarters: "Burlington, Ontario, Canada", founded: "1976 (Canada)",
    industry: "Retail (home furnishings)", employees: "~7,000", website: "https://www.ikea.com/ca/en/",
    about: "The Canadian arm of the global home-furnishings retailer.",
  },

  // ── Forestry ──
  Canfor: {
    legalName: "Canfor Corporation", headquarters: "Vancouver, British Columbia, Canada", founded: "1938",
    industry: "Forestry & forest products", employees: "~7,000", ticker: "TSX: CFP", website: "https://www.canfor.com",
    about: "One of the world's largest producers of sustainable lumber and pulp, based in BC.",
  },
  "West Fraser": {
    legalName: "West Fraser Timber Co. Ltd.", headquarters: "Vancouver, British Columbia, Canada", founded: "1955",
    industry: "Forestry & forest products", employees: "~11,000", ticker: "TSX / NYSE: WFG", website: "https://www.westfraser.com",
    about: "One of the world's largest lumber producers, based in Canada.",
  },

  // ── Construction ──
  Aecon: {
    legalName: "Aecon Group Inc.", headquarters: "Toronto, Ontario, Canada", founded: "1877",
    industry: "Construction & infrastructure", employees: "~12,000", ticker: "TSX: ARE", website: "https://www.aecon.com",
    about: "One of Canada's largest construction and infrastructure development companies.",
  },
  EllisDon: {
    legalName: "EllisDon Corporation", headquarters: "London, Ontario, Canada", founded: "1951",
    industry: "Construction & building services", employees: "~4,000", website: "https://www.ellisdon.com",
    about: "An employee-owned Canadian construction and building services company.",
  },
  "Graham Construction": {
    legalName: "Graham Group Ltd.", headquarters: "Calgary, Alberta, Canada", founded: "1926",
    industry: "Construction", employees: "~2,000", website: "https://www.grahambuilds.com",
    about: "An employee-owned Canadian construction solutions provider.",
  },
  "PCL Construction": {
    legalName: "PCL Constructors Inc.", headquarters: "Edmonton, Alberta, Canada", founded: "1906",
    industry: "Construction", employees: "~4,500", website: "https://www.pcl.com",
    about: "One of North America's largest, employee-owned construction companies.",
  },

  // ── Consulting / professional services ──
  "Deloitte Canada": {
    headquarters: "Toronto, Ontario, Canada", founded: "1858 (Deloitte global)",
    industry: "Professional services (audit & consulting)", employees: "~15,000 (Canada)", website: "https://www.deloitte.com/ca",
    about: "One of Canada's largest professional services firms; published corporate Canada's first Reconciliation Action Plan.",
  },
  "PwC Canada": {
    legalName: "PricewaterhouseCoopers LLP (Canada)", headquarters: "Toronto, Ontario, Canada", founded: "1907 (Canada)",
    industry: "Professional services (audit & advisory)", employees: "~9,000 (Canada)", website: "https://www.pwc.com/ca",
    about: "One of Canada's large professional services firms (assurance, tax, consulting).",
  },
  "KPMG Canada": {
    headquarters: "Toronto, Ontario, Canada", founded: "1869", industry: "Professional services (audit & advisory)",
    employees: "~10,000 (Canada)", website: "https://kpmg.com/ca",
    about: "One of Canada's large professional services firms (audit, tax, advisory).",
  },

  // ── Government / crown ──
  "Canada Post": {
    legalName: "Canada Post Corporation", headquarters: "Ottawa, Ontario, Canada", founded: "1867 (Crown corp 1981)",
    industry: "Postal & logistics (federal Crown)", employees: "~55,000", website: "https://www.canadapost.ca",
    about: "Canada's national postal service, a federal Crown corporation.",
  },
  "Business Development Bank of Canada": {
    legalName: "Business Development Bank of Canada (BDC)", headquarters: "Montreal, Quebec, Canada", founded: "1944",
    industry: "Banking (federal Crown, business financing)", employees: "~3,000", website: "https://www.bdc.ca",
    about: "Canada's bank for entrepreneurs, a federal Crown corporation financing and advising businesses.",
  },
  "Export Development Canada": {
    legalName: "Export Development Canada (EDC)", headquarters: "Ottawa, Ontario, Canada", founded: "1944",
    industry: "Trade finance (federal Crown)", employees: "~2,500", website: "https://www.edc.ca",
    about: "Canada's export credit agency, a federal Crown corporation supporting exporters.",
  },
  "Canada Infrastructure Bank": {
    headquarters: "Toronto, Ontario, Canada", founded: "2017", industry: "Infrastructure investment (federal Crown)",
    employees: "~150", website: "https://cib-bic.ca",
    about: "A federal Crown corporation investing in revenue-generating infrastructure, including Indigenous projects.",
  },

  // ── Education ──
  "University of British Columbia": {
    headquarters: "Vancouver, British Columbia, Canada", founded: "1908", industry: "Higher education",
    employees: "~17,000", website: "https://www.ubc.ca",
    about: "A leading global public research university with campuses in Vancouver and the Okanagan.",
  },
  "University of Alberta": {
    headquarters: "Edmonton, Alberta, Canada", founded: "1908", industry: "Higher education",
    employees: "~15,000", website: "https://www.ualberta.ca",
    about: "A leading Canadian public research university in Edmonton.",
  },
  "University of Toronto": {
    headquarters: "Toronto, Ontario, Canada", founded: "1827", industry: "Higher education",
    employees: "~25,000", website: "https://www.utoronto.ca",
    about: "Canada's largest university and a leading global research institution.",
  },

  // ── Health ──
  "Alberta Health Services": {
    headquarters: "Edmonton, Alberta, Canada", founded: "2008", industry: "Health care (provincial)",
    employees: "~100,000", website: "https://www.albertahealthservices.ca",
    about: "Canada's first and largest province-wide health system, delivering care across Alberta.",
  },
  "Vancouver Coastal Health": {
    headquarters: "Vancouver, British Columbia, Canada", founded: "2001", industry: "Health care (regional authority)",
    employees: "~25,000", website: "https://www.vch.ca",
    about: "A British Columbia regional health authority serving Vancouver and the coastal region.",
  },

  // ── Batch 5 ──
  CAE: {
    legalName: "CAE Inc.", headquarters: "Montreal, Quebec, Canada", founded: "1947",
    industry: "Aerospace (simulation & training)", employees: "~13,000", ticker: "TSX / NYSE: CAE",
    website: "https://www.cae.com",
    about: "A global leader in flight simulation and aviation/defence training, based in Montreal.",
  },
  "Maple Leaf Foods": {
    legalName: "Maple Leaf Foods Inc.", headquarters: "Mississauga, Ontario, Canada", founded: "1927",
    industry: "Food processing", employees: "~13,000", ticker: "TSX: MFI", website: "https://www.mapleleaffoods.com",
    about: "One of Canada's largest prepared-meats and plant-protein food companies.",
  },
  Sobeys: {
    legalName: "Sobeys Inc. (Empire Company)", headquarters: "Stellarton, Nova Scotia, Canada", founded: "1907",
    industry: "Retail (grocery)", employees: "~123,000", website: "https://www.sobeys.com",
    about: "One of Canada's two national grocery retailers, a subsidiary of Empire Company.",
  },
  "Federated Co-operatives": {
    legalName: "Federated Co-operatives Limited (FCL)", headquarters: "Saskatoon, Saskatchewan, Canada", founded: "1928",
    industry: "Retail & wholesale (co-operative)", employees: "~3,500", website: "https://www.fcl.crs",
    about: "The wholesaler and administrator for the Co-operative Retailing System across Western Canada.",
  },
  "Port of Vancouver (Vancouver Fraser Port Authority)": {
    legalName: "Vancouver Fraser Port Authority", headquarters: "Vancouver, British Columbia, Canada", founded: "2008",
    industry: "Port authority (federal)", employees: "~500", website: "https://www.portvancouver.com",
    about: "The federal authority for the Port of Vancouver, Canada's largest port.",
  },
  "CBC/Radio-Canada": {
    legalName: "Canadian Broadcasting Corporation", headquarters: "Ottawa, Ontario, Canada", founded: "1936",
    industry: "Media & broadcasting (federal Crown)", employees: "~7,000", website: "https://cbc.radio-canada.ca",
    about: "Canada's national public broadcaster, a federal Crown corporation.",
  },
  BCLC: {
    legalName: "British Columbia Lottery Corporation", headquarters: "Kamloops, British Columbia, Canada", founded: "1985",
    industry: "Gaming (provincial Crown)", employees: "~1,000", website: "https://www.bclc.com",
    about: "British Columbia's provincial Crown gaming corporation.",
  },
  TransLink: {
    legalName: "South Coast British Columbia Transportation Authority", headquarters: "New Westminster, British Columbia, Canada", founded: "1998",
    industry: "Public transit authority", employees: "~8,000 (enterprise)", website: "https://www.translink.ca",
    about: "Metro Vancouver's regional transportation authority, operating buses, SkyTrain, SeaBus and West Coast Express.",
  },
  Metrolinx: {
    headquarters: "Toronto, Ontario, Canada", founded: "2006",
    industry: "Public transit agency (provincial Crown)", employees: "~4,500", website: "https://www.metrolinx.com",
    about: "Ontario Crown agency managing and integrating road and transit networks across the Greater Toronto and Hamilton Area (GO Transit, UP Express, PRESTO).",
  },
  "McGill University": {
    headquarters: "Montreal, Quebec, Canada", founded: "1821",
    industry: "Public research university", employees: "~13,000 staff · ~40,000 students", website: "https://www.mcgill.ca",
    about: "One of Canada's oldest and most prominent research universities, consistently ranked among the country's top institutions.",
  },
  "Western University": {
    legalName: "University of Western Ontario", headquarters: "London, Ontario, Canada", founded: "1878",
    industry: "Public research university", employees: "~5,000 staff · ~40,000 students", website: "https://www.uwo.ca",
    about: "A major public research university in southwestern Ontario, known for its medical, business (Ivey) and health-sciences programs.",
  },
  "McMaster University": {
    headquarters: "Hamilton, Ontario, Canada", founded: "1887",
    industry: "Public research university", employees: "~6,000 staff · ~38,000 students", website: "https://www.mcmaster.ca",
    about: "A research-intensive university in Hamilton, Ontario, recognized for its health sciences, engineering and problem-based learning model.",
  },
  AltaLink: {
    legalName: "AltaLink, L.P.", headquarters: "Calgary, Alberta, Canada", founded: "2002",
    industry: "Electricity transmission", employees: "~900", website: "https://www.altalink.ca",
    about: "Alberta's largest regulated electricity transmission company, owned by Berkshire Hathaway Energy, serving most of the province's population.",
  },
  "AtkinsRéalis": {
    legalName: "AtkinsRéalis Group Inc. (formerly SNC-Lavalin)", headquarters: "Montreal, Quebec, Canada", founded: "1911",
    industry: "Engineering & project management", employees: "~37,000", ticker: "TSX: ATRL", website: "https://www.atkinsrealis.com",
    about: "A global engineering and project-management firm (rebranded from SNC-Lavalin in 2023) delivering infrastructure, nuclear and consulting services.",
  },
};

export function getOrgProfile(orgName: string): OrgProfile | undefined {
  return orgProfiles[orgName];
}
