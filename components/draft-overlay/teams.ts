// Team data for the draft overlay - maps to website's team system
// Logo paths point to existing assets in public/assets/teams/East v West Logos/

export interface Team {
  id: number;
  name: string;
  abbrev: string;
  owner: string;
  logo: string;
  colors: [string, string, string | null];
}

export const teams: Team[] = [
  {
    id: 1,
    name: "Belltown Raptors",
    abbrev: "BTN",
    owner: "Jason",
    logo: "Belltown Raptors logo.png",
    colors: ["#753bbd", "#ba0c2f", "#8a8d8f"],
  },
  {
    id: 2,
    name: "Belleview Badgers",
    abbrev: "BEL",
    owner: "Patrick",
    logo: "Belleview Badgers Primary Logo.png",
    colors: ["#006747", "#1E3952", "#F2F7F9"],
  },
  {
    id: 3,
    name: "Mt. Lebanon Cake Eaters",
    abbrev: "MTL",
    owner: "Michael M",
    logo: "Cake Eaters Logo Final Version (1).png",
    colors: ["#023351", "#DCAC24", null],
  },
  {
    id: 4,
    name: "Double Trouble",
    abbrev: "DT",
    owner: "Noah / Shane",
    logo: "Double Trouble logo.png",
    colors: ["#120a11", "#351b4b", "#ca5517"],
  },
  {
    id: 5,
    name: "The Lone Ginger",
    abbrev: "GIN",
    owner: "Ginger",
    logo: "Lone Ginger Logo.png",
    colors: ["#d56920", "#13110d", "#4b775b"],
  },
  {
    id: 6,
    name: "Minshew's Maniacs",
    abbrev: "MM",
    owner: "Matt S",
    logo: "Minshew's Maniacs Logo.png",
    colors: ["#A60F2D", "#4D4D4D", null],
  },
  {
    id: 7,
    name: "Red Pandas",
    abbrev: "RDP",
    owner: "Matt M",
    logo: "Red Pandas Primary Logo (2).png",
    colors: ["#c90a00", "#797574", "#38c4f6"],
  },
  {
    id: 8,
    name: "Elemental Heroes",
    abbrev: "EH",
    owner: "Joseph",
    logo: "Elemental Heroes Logo.png",
    colors: ["#83e1a2", "#fd6e6e", "#7799c9"],
  },
  {
    id: 9,
    name: "bop pop",
    abbrev: "bop",
    owner: "Jack",
    logo: "bop pop logo.png",
    colors: ["#fedb35", "#f88618", null],
  },
  {
    id: 10,
    name: "BeerNeverBrokeMyHeart",
    abbrev: "BNB",
    owner: "Michael B",
    logo: "Beer Never Broke My Heart Logo.png",
    colors: ["#0E1A27", "#F4E3C3", "#B53329"],
  },
  {
    id: 11,
    name: "Bimg Bamg Boomg",
    abbrev: "BBB",
    owner: "Alex",
    logo: "Bimg Bamg Boomg Logo .png",
    colors: ["#712D7C", "#9BC46D", "#9E9E9E"],
  },
  {
    id: 12,
    name: "Detroit Dawgs",
    abbrev: "DET",
    owner: "Conor",
    logo: "Detroit Dawgs Logo.png",
    colors: ["#5a341f", "#da2127", "#f3bd37"],
  },
];

// Map team name to team object
export function getTeamByName(name: string): Team | undefined {
  return teams.find(t => t.name.toLowerCase() === name.toLowerCase());
}

// Map team ID to team object
export function getTeamById(id: number): Team | undefined {
  return teams.find(t => t.id === id);
}

// Get team logo path for use in img src
export function getTeamLogoPath(team: Team | undefined): string | null {
  if (!team?.logo) return null;
  return `/assets/teams/East v West Logos/${team.logo}`;
}
