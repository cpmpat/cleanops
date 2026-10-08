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
  | { t: 'strong'; v: string }
  | { t: 'date'; v: string }
  | { t: 'channel'; v: 'airbnb' | 'booking' }
  /** Where the record's name goes. Without one the name leads the sentence. */
  | { t: 'ref' }
  /** The UP / DOWN logo. */
  | { t: 'move'; v: 'up' | 'down' };

export interface NewsRule {
  /** Stable name, sent to the client (it also picks the item's icon). */
  key: string;
  dataset: string;
  /** The field whose change is the news. */
  field: string;
  /** Other columns of the record the sentence reads. */
  needs: string[];
  /**
   * The sentence after the record's name. Null = not news after all.
   * `value` is the record's current value; `ctx.oldValue` is what the latest
   * recorded change replaced (null when the field was empty); `ctx.rank`
   * places a value in a ranked pick list (1 = highest, null = not in it).
   */
  parts(value: string, row: Record<string, unknown>, ctx: NewsContext): NewsPart[] | null;
}

export interface NewsContext {
  oldValue: string | null;
  rank(list: string, value: string): number | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09-18" → "18 Sep 2026"; anything else as it is. */
export function day(value: string): string {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : value;
}

const CHANNEL_NAME = { airbnb: 'Airbnb.com', booking: 'Booking.com' } as const;

/** The parts as one plain sentence (for anything that cannot show logos). */
export function plain(parts: NewsPart[], title = ''): string {
  return parts
    .map((p) => (p.t === 'channel' ? CHANNEL_NAME[p.v] : p.t === 'ref' ? title : p.t === 'move' ? p.v.toUpperCase() : p.v))
    .join('');
}

/** The channels a unit is listed on, as sentence parts: "Airbnb, Booking". */
function channels(row: Record<string, unknown>): NewsPart[] {
  const on: Array<'airbnb' | 'booking'> = [];
  if (row.otaAirbnb === true) on.push('airbnb');
  if (row.otaBooking === true) on.push('booking');
  return on.flatMap((v, i) => (i === 0 ? [{ t: 'channel', v }] : [{ t: 'text', v: ', ' }, { t: 'channel', v }])) as NewsPart[];
}

/**
 * A move in a ranked pick list (dataset_picklist_values, sortOrder 1 = top):
 *   "Pricing Group of <unit> has moved to X."                  — was empty
 *   "Pricing Group of <unit> has moved [UP|DOWN] from X to Y." — ranked both ends
 *   "Pricing Group of <unit> has changed from X to Y."         — a value off the list
 * Same rank (or reverted since) → no news.
 */
function rankedMove(dataset: string, field: string, label: string, list: string): NewsRule {
  return {
    key: `${dataset}.move.${field}`,
    dataset,
    field,
    needs: [],
    parts: (value, _row, ctx) => {
      const lead: NewsPart[] = [{ t: 'text', v: `${label} of ` }, { t: 'ref' }];
      const before = ctx.oldValue?.trim() ?? '';
      if (!before) {
        return [...lead, { t: 'text', v: ' has moved to ' }, { t: 'strong', v: value }, { t: 'text', v: '.' }];
      }
      const from = ctx.rank(list, before);
      const to = ctx.rank(list, value);
      if (from !== null && to !== null) {
        if (from === to) return null;
        return [
          ...lead, { t: 'text', v: ' has moved ' }, { t: 'move', v: to < from ? 'up' : 'down' },
          { t: 'text', v: ' from ' }, { t: 'strong', v: before }, { t: 'text', v: ' to ' }, { t: 'strong', v: value }, { t: 'text', v: '.' },
        ];
      }
      if (before.toLowerCase() === value.toLowerCase()) return null;
      return [
        ...lead, { t: 'text', v: ' has changed from ' }, { t: 'strong', v: before },
        { t: 'text', v: ' to ' }, { t: 'strong', v: value }, { t: 'text', v: '.' },
      ];
    },
  };
}

export const NEWS_RULES: NewsRule[] = [
  rankedMove('accommodation', 'pricingGroup', 'Pricing Group', 'accommodation.pricingGroup'),
  {
    key: 'accommodation.offboard',
    dataset: 'accommodation',
    field: 'dateOffboard',
    needs: ['otaAirbnb', 'otaBooking'],
    parts: (value, row) => {
      const on = channels(row);
      return on.length
        ? [{ t: 'text', v: 'is going to be ' }, { t: 'strong', v: 'delisted' }, { t: 'text', v: ' from ' }, ...on, { t: 'text', v: ' on ' }, { t: 'date', v: day(value) }, { t: 'text', v: '.' }]
        : [{ t: 'text', v: 'is going to be ' }, { t: 'strong', v: 'delisted' }, { t: 'text', v: ' on ' }, { t: 'date', v: day(value) }, { t: 'text', v: '.' }];
    },
  },
  {
    key: 'accommodation.airbnbOnline',
    dataset: 'accommodation',
    field: 'otaAirbnbSalesStarted',
    needs: [],
    parts: (value) => [
      { t: 'text', v: 'is ' }, { t: 'strong', v: 'online' }, { t: 'text', v: ' on ' }, { t: 'channel', v: 'airbnb' },
      { t: 'text', v: ' from ' }, { t: 'date', v: day(value) }, { t: 'text', v: '.' },
    ],
  },
  {
    key: 'accommodation.bookingOnline',
    dataset: 'accommodation',
    field: 'otaBookingSalesStarted',
    needs: [],
    parts: (value) => [
      { t: 'text', v: 'is ' }, { t: 'strong', v: 'online' }, { t: 'text', v: ' on ' }, { t: 'channel', v: 'booking' },
      { t: 'text', v: ' from ' }, { t: 'date', v: day(value) }, { t: 'text', v: '.' },
    ],
  },
];

/** How far back the feed looks. */
export const NEWSFEED_DAYS = 90;
