/**
 * Newsfeed rules: which recorded changes become news, and what they say.
 *
 * A news item is never stored. It is a dataset_field_changes row — written by
 * an app save or a sheet reload alike — that one of these rules turns into a
 * sentence when the feed is read. Adding a kind of news is adding an entry
 * here; nothing to migrate, and it applies to changes already recorded.
 *
 * Only the LATEST change of a field per record counts, and only while it holds
 * a value: a date moved twice is one item with the newest date; a date cleared
 * is no item.
 */

export interface NewsRule {
  /** Stable name, sent to the client. */
  key: string;
  dataset: string;
  /** The field whose change is the news. */
  field: string;
  /** Other columns of the record the sentence reads. */
  needs: string[];
  /** The sentence after the record's name. Null = not news after all. */
  text(value: string, row: Record<string, unknown>): string | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09-18" → "18 Sep 2026"; anything else as it is. */
export function day(value: string): string {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : value;
}

/** The channels a unit is listed on, as the sentences name them. */
function channels(row: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (row.otaAirbnb === true) out.push('Airbnb.com');
  if (row.otaBooking === true) out.push('Booking.com');
  return out;
}

export const NEWS_RULES: NewsRule[] = [
  {
    key: 'accommodation.offboard',
    dataset: 'accommodation',
    field: 'dateOffboard',
    needs: ['otaAirbnb', 'otaBooking'],
    text: (value, row) => {
      const on = channels(row);
      return on.length
        ? `is going to be delisted from ${on.join(', ')} on ${day(value)}.`
        : `is going to be delisted on ${day(value)}.`;
    },
  },
  {
    key: 'accommodation.airbnbOnline',
    dataset: 'accommodation',
    field: 'otaAirbnbSalesStarted',
    needs: [],
    text: (value) => `is online on Airbnb.com from ${day(value)}.`,
  },
  {
    key: 'accommodation.bookingOnline',
    dataset: 'accommodation',
    field: 'otaBookingSalesStarted',
    needs: [],
    text: (value) => `is online on Booking.com from ${day(value)}.`,
  },
];

/** How far back the feed looks. */
export const NEWSFEED_DAYS = 90;
