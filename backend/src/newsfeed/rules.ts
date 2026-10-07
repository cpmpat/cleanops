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

/**
 * A sentence in pieces, so the client can style them: a date is shown bold, a
 * channel as its logo. `text` pieces are plain.
 */
export type NewsPart =
  | { t: 'text'; v: string }
  | { t: 'date'; v: string }
  | { t: 'channel'; v: 'airbnb' | 'booking' };

export interface NewsRule {
  /** Stable name, sent to the client (it also picks the item's icon). */
  key: string;
  dataset: string;
  /** The field whose change is the news. */
  field: string;
  /** Other columns of the record the sentence reads. */
  needs: string[];
  /** The sentence after the record's name. Null = not news after all. */
  parts(value: string, row: Record<string, unknown>): NewsPart[] | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09-18" → "18 Sep 2026"; anything else as it is. */
export function day(value: string): string {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : value;
}

const CHANNEL_NAME = { airbnb: 'Airbnb.com', booking: 'Booking.com' } as const;

/** The parts as one plain sentence (for anything that cannot show logos). */
export function plain(parts: NewsPart[]): string {
  return parts.map((p) => (p.t === 'channel' ? CHANNEL_NAME[p.v] : p.v)).join('');
}

/** The channels a unit is listed on, as sentence parts: "Airbnb, Booking". */
function channels(row: Record<string, unknown>): NewsPart[] {
  const on: Array<'airbnb' | 'booking'> = [];
  if (row.otaAirbnb === true) on.push('airbnb');
  if (row.otaBooking === true) on.push('booking');
  return on.flatMap((v, i) => (i === 0 ? [{ t: 'channel', v }] : [{ t: 'text', v: ', ' }, { t: 'channel', v }])) as NewsPart[];
}

export const NEWS_RULES: NewsRule[] = [
  {
    key: 'accommodation.offboard',
    dataset: 'accommodation',
    field: 'dateOffboard',
    needs: ['otaAirbnb', 'otaBooking'],
    parts: (value, row) => {
      const on = channels(row);
      return on.length
        ? [{ t: 'text', v: 'is going to be delisted from ' }, ...on, { t: 'text', v: ' on ' }, { t: 'date', v: day(value) }, { t: 'text', v: '.' }]
        : [{ t: 'text', v: 'is going to be delisted on ' }, { t: 'date', v: day(value) }, { t: 'text', v: '.' }];
    },
  },
  {
    key: 'accommodation.airbnbOnline',
    dataset: 'accommodation',
    field: 'otaAirbnbSalesStarted',
    needs: [],
    parts: (value) => [
      { t: 'text', v: 'is online on ' }, { t: 'channel', v: 'airbnb' },
      { t: 'text', v: ' from ' }, { t: 'date', v: day(value) }, { t: 'text', v: '.' },
    ],
  },
  {
    key: 'accommodation.bookingOnline',
    dataset: 'accommodation',
    field: 'otaBookingSalesStarted',
    needs: [],
    parts: (value) => [
      { t: 'text', v: 'is online on ' }, { t: 'channel', v: 'booking' },
      { t: 'text', v: ' from ' }, { t: 'date', v: day(value) }, { t: 'text', v: '.' },
    ],
  },
];

/** How far back the feed looks. */
export const NEWSFEED_DAYS = 90;
