/** Google Sheet used for draft trip arrival/departure (source of truth). */
export const DRAFT_TRAVEL_SPREADSHEET_ID = '1hLZaGc1CvFobjAnfZdr6OEMCjLubPrqbzpXKJdtSAbQ';

/** Trip year → sheet tab gid. Add entries as new draft years get tabs. */
export const DRAFT_TRAVEL_SHEET_GIDS: Record<string, string> = {
  '2026': '1187935552',
};

export function draftTravelSheetEditUrl(gid: string): string {
  return `https://docs.google.com/spreadsheets/d/${DRAFT_TRAVEL_SPREADSHEET_ID}/edit?gid=${gid}#gid=${gid}`;
}

export function draftTravelSheetGidForTrip(trip: string): string | null {
  return DRAFT_TRAVEL_SHEET_GIDS[trip] ?? null;
}
