import type { Locale } from './translations';

/**
 * Strings for agent availability — the agent's Availability tab and the
 * desk's Planning → Agents. Kept out of translations.ts for the same reason
 * as messages.ts: one self-contained, typed module per feature.
 */
export interface AvailabilityStrings {
  // ── Agent ──
  navLabel: string;
  title: string;
  subtitle: string;
  summary: (days: number, hours: string) => string;
  thisWeek: string;
  nextWeek: string;
  later: string;
  today: string;
  notAvailable: string;
  addTime: string;
  addTimeOn: (day: string) => string;
  copyWeek: string;
  copied: (n: number) => string;
  nothingToCopy: string;
  sheetQuestion: string;
  editTitle: string;
  quickPick: string;
  morning: string;
  afternoon: string;
  evening: string;
  late: string;
  exact: string;
  from: string;
  till: string;
  earlier: (what: string) => string;
  later30: (what: string) => string;
  overnightHint: string;
  alsoOn: string;
  save: (range: string, days: number) => string;
  saveChange: string;
  remove: string;
  close: string;
  todayLocked: string;
  saveFailed: string;
  loading: string;
  // ── Desk ──
  tabLabel: string;
  deskTitle: string;
  deskSubtitle: string;
  day: string;
  week: string;
  prev: string;
  next: string;
  todayPrefix: string;
  agentsAvailable: (n: number) => string;
  arrivalsCount: (n: number) => string;
  gapNoAgent: (range: string) => string;
  strain: (range: string) => string;
  agent: string;
  arrivalsRow: string;
  assumedNote: string;
  onDuty: string;
  notAvailableToday: (n: number) => string;
  nothingDeclared: string;
  hoursToday: (h: string, blocks: number) => string;
  setAt: (when: string) => string;
  uncoveredTitle: (range: string, n: number) => string;
  openInCheckIn: string;
  legendTitle: string;
  legendBlock: string;
  legendGap: string;
  legendStrain: string;
  legendArrivals: string;
  legendAssumed: string;
  agentHours: string;
  hoursNoAgent: string;
  clickDay: string;
  noAgents: string;
  noGaps: string;
}

const en: AvailabilityStrings = {
  navLabel: 'Availability',
  title: 'Availability',
  subtitle: 'You are offered check-ins only in the hours you mark here. No hours = not available.',
  summary: (d, h) => `This week · ${d} ${d === 1 ? 'day' : 'days'} · ${h}`,
  thisWeek: 'This week',
  nextWeek: 'Next week',
  later: 'Later',
  today: 'Today',
  notAvailable: 'Not available',
  addTime: 'Add time',
  addTimeOn: (d) => `Add time on ${d}`,
  copyWeek: 'Copy this week',
  copied: (n) => `${n} ${n === 1 ? 'block' : 'blocks'} copied to next week`,
  nothingToCopy: 'Nothing to copy this week',
  sheetQuestion: 'When can you take check-ins?',
  editTitle: 'Change time',
  quickPick: 'Quick pick',
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  late: 'Late',
  exact: 'Or exactly · 30-min steps',
  from: 'From',
  till: 'Till',
  earlier: (w) => `${w} 30 minutes earlier`,
  later30: (w) => `${w} 30 minutes later`,
  overnightHint: 'Till earlier than From means past midnight — 21:00 → 01:00 is one evening.',
  alsoOn: 'Same hours also on',
  save: (r, n) => `Save ${r}${n > 1 ? ` · ${n} days` : ''}`,
  saveChange: 'Save change',
  remove: 'Remove',
  close: 'Close',
  todayLocked: "Today's hours are fixed. If something changes, call the front desk.",
  saveFailed: 'Could not save — try again',
  loading: 'Loading…',
  tabLabel: 'Agents',
  deskTitle: 'Agents',
  deskSubtitle: 'Who can meet guests, hour by hour — set by the agents themselves · Europe/Prague',
  day: 'Day',
  week: 'Week',
  prev: 'Previous',
  next: 'Next',
  todayPrefix: 'Today',
  agentsAvailable: (n) => `${n} ${n === 1 ? 'agent' : 'agents'} available`,
  arrivalsCount: (n) => `${n} ${n === 1 ? 'arrival' : 'arrivals'}`,
  gapNoAgent: (r) => `${r} · no agent`,
  strain: (r) => `${r} · >4 arrivals per agent`,
  agent: 'Agent',
  arrivalsRow: 'Arrivals',
  assumedNote: 'incl. assumed 15:00',
  onDuty: 'Agents on duty',
  notAvailableToday: (n) => `${n} ${n === 1 ? 'agent' : 'agents'} not available`,
  nothingDeclared: 'nothing declared',
  hoursToday: (h, b) => `${h}${b > 1 ? ` · ${b} blocks` : ''}`,
  setAt: (w) => `set ${w}`,
  uncoveredTitle: (r, n) => `${r} · ${n} ${n === 1 ? 'arrival' : 'arrivals'}, no agent`,
  openInCheckIn: 'Open Check-In planning →',
  legendTitle: 'How to read this',
  legendBlock: 'Declared by the agent in their app — the desk only reads it',
  legendGap: 'Guests arrive and no agent is available',
  legendStrain: 'More than 4 arrivals per available agent in that hour',
  legendArrivals: 'Arrivals from Check-In planning, by the hour they are expected',
  legendAssumed: 'Striped: arrival time not confirmed (our 15:00 default)',
  agentHours: 'Agent-hours',
  hoursNoAgent: 'Hours with arrivals, no agent',
  clickDay: 'Click a day to open it as a timeline',
  noAgents: 'No active users with the Agent role yet.',
  noGaps: 'Every hour with arrivals has an agent.',
};

const cs: AvailabilityStrings = {
  navLabel: 'Dostupnost',
  title: 'Dostupnost',
  subtitle: 'Check-iny vám nabídneme jen v hodinách, které tu označíte. Bez hodin = nedostupný/á.',
  summary: (d, h) => `Tento týden · ${d} ${d === 1 ? 'den' : d < 5 ? 'dny' : 'dní'} · ${h}`,
  thisWeek: 'Tento týden',
  nextWeek: 'Příští týden',
  later: 'Později',
  today: 'Dnes',
  notAvailable: 'Nedostupný/á',
  addTime: 'Přidat čas',
  addTimeOn: (d) => `Přidat čas: ${d}`,
  copyWeek: 'Kopírovat tento týden',
  copied: (n) => `Zkopírováno do příštího týdne: ${n}`,
  nothingToCopy: 'Tento týden není co kopírovat',
  sheetQuestion: 'Kdy můžete dělat check-iny?',
  editTitle: 'Změnit čas',
  quickPick: 'Rychlá volba',
  morning: 'Ráno',
  afternoon: 'Odpoledne',
  evening: 'Večer',
  late: 'Pozdě',
  exact: 'Nebo přesně · po 30 min',
  from: 'Od',
  till: 'Do',
  earlier: (w) => `${w} o 30 minut dříve`,
  later30: (w) => `${w} o 30 minut později`,
  overnightHint: '„Do" dříve než „Od" znamená přes půlnoc — 21:00 → 01:00 je jeden večer.',
  alsoOn: 'Stejné hodiny také',
  save: (r, n) => `Uložit ${r}${n > 1 ? ` · ${n} ${n < 5 ? 'dny' : 'dní'}` : ''}`,
  saveChange: 'Uložit změnu',
  remove: 'Odebrat',
  close: 'Zavřít',
  todayLocked: 'Dnešní hodiny už nejdou změnit. Když se něco změní, zavolejte na front desk.',
  saveFailed: 'Nepodařilo se uložit — zkuste to znovu',
  loading: 'Načítám…',
  tabLabel: 'Agenti',
  deskTitle: 'Agenti',
  deskSubtitle: 'Kdo může vítat hosty, hodinu po hodině — zadávají sami agenti · Europe/Prague',
  day: 'Den',
  week: 'Týden',
  prev: 'Předchozí',
  next: 'Další',
  todayPrefix: 'Dnes',
  agentsAvailable: (n) => `Dostupní agenti: ${n}`,
  arrivalsCount: (n) => `Příjezdy: ${n}`,
  gapNoAgent: (r) => `${r} · žádný agent`,
  strain: (r) => `${r} · >4 příjezdy na agenta`,
  agent: 'Agent',
  arrivalsRow: 'Příjezdy',
  assumedNote: 'vč. předpokládaných 15:00',
  onDuty: 'Agenti ve službě',
  notAvailableToday: (n) => `Nedostupní agenti: ${n}`,
  nothingDeclared: 'nic nezadáno',
  hoursToday: (h, b) => `${h}${b > 1 ? ` · ${b} bloky` : ''}`,
  setAt: (w) => `zadáno ${w}`,
  uncoveredTitle: (r, n) => `${r} · příjezdy: ${n}, žádný agent`,
  openInCheckIn: 'Otevřít plánování příjezdů →',
  legendTitle: 'Jak to číst',
  legendBlock: 'Zadal agent ve své aplikaci — front desk jen čte',
  legendGap: 'Hosté přijíždějí a žádný agent není k dispozici',
  legendStrain: 'Víc než 4 příjezdy na dostupného agenta v dané hodině',
  legendArrivals: 'Příjezdy z plánování, podle očekávané hodiny',
  legendAssumed: 'Šrafované: čas příjezdu nepotvrzen (náš výchozí 15:00)',
  agentHours: 'Hodiny agentů',
  hoursNoAgent: 'Hodiny s příjezdy bez agenta',
  clickDay: 'Kliknutím na den ho otevřete jako časovou osu',
  noAgents: 'Zatím žádní aktivní uživatelé s rolí Agent.',
  noGaps: 'Každá hodina s příjezdy má agenta.',
};

const ru: AvailabilityStrings = {
  navLabel: 'Доступность',
  title: 'Доступность',
  subtitle: 'Заезды предлагаются только в часы, которые вы отметите здесь. Нет часов — вы недоступны.',
  summary: (d, h) => `Эта неделя · дней: ${d} · ${h}`,
  thisWeek: 'Эта неделя',
  nextWeek: 'Следующая неделя',
  later: 'Позже',
  today: 'Сегодня',
  notAvailable: 'Недоступен(а)',
  addTime: 'Добавить время',
  addTimeOn: (d) => `Добавить время: ${d}`,
  copyWeek: 'Скопировать эту неделю',
  copied: (n) => `Скопировано на следующую неделю: ${n}`,
  nothingToCopy: 'На этой неделе нечего копировать',
  sheetQuestion: 'Когда вы можете принимать заезды?',
  editTitle: 'Изменить время',
  quickPick: 'Быстрый выбор',
  morning: 'Утро',
  afternoon: 'День',
  evening: 'Вечер',
  late: 'Поздно',
  exact: 'Или точно · шаг 30 мин',
  from: 'С',
  till: 'До',
  earlier: (w) => `${w} на 30 минут раньше`,
  later30: (w) => `${w} на 30 минут позже`,
  overnightHint: '«До» раньше, чем «С», — значит после полуночи: 21:00 → 01:00 — один вечер.',
  alsoOn: 'Те же часы также',
  save: (r, n) => `Сохранить ${r}${n > 1 ? ` · дней: ${n}` : ''}`,
  saveChange: 'Сохранить',
  remove: 'Удалить',
  close: 'Закрыть',
  todayLocked: 'Сегодняшние часы изменить нельзя. Если что-то изменилось, позвоните на ресепшн.',
  saveFailed: 'Не удалось сохранить — попробуйте ещё раз',
  loading: 'Загрузка…',
  tabLabel: 'Агенты',
  deskTitle: 'Агенты',
  deskSubtitle: 'Кто может встречать гостей, по часам — отмечают сами агенты · Europe/Prague',
  day: 'День',
  week: 'Неделя',
  prev: 'Назад',
  next: 'Вперёд',
  todayPrefix: 'Сегодня',
  agentsAvailable: (n) => `Доступно агентов: ${n}`,
  arrivalsCount: (n) => `Заездов: ${n}`,
  gapNoAgent: (r) => `${r} · нет агента`,
  strain: (r) => `${r} · >4 заездов на агента`,
  agent: 'Агент',
  arrivalsRow: 'Заезды',
  assumedNote: 'вкл. предполагаемые 15:00',
  onDuty: 'Агенты на смене',
  notAvailableToday: (n) => `Недоступно агентов: ${n}`,
  nothingDeclared: 'ничего не указано',
  hoursToday: (h, b) => `${h}${b > 1 ? ` · блоков: ${b}` : ''}`,
  setAt: (w) => `указано ${w}`,
  uncoveredTitle: (r, n) => `${r} · заездов: ${n}, нет агента`,
  openInCheckIn: 'Открыть планирование заездов →',
  legendTitle: 'Как читать',
  legendBlock: 'Отмечено агентом в приложении — ресепшн только читает',
  legendGap: 'Гости приезжают, а агента нет',
  legendStrain: 'Больше 4 заездов на доступного агента в этот час',
  legendArrivals: 'Заезды из планирования, по ожидаемому часу',
  legendAssumed: 'Штриховка: время заезда не подтверждено (наше 15:00 по умолчанию)',
  agentHours: 'Часы агентов',
  hoursNoAgent: 'Часы с заездами без агента',
  clickDay: 'Нажмите на день, чтобы открыть его шкалой времени',
  noAgents: 'Пока нет активных пользователей с ролью Агент.',
  noGaps: 'В каждый час с заездами есть агент.',
};

const uk: AvailabilityStrings = {
  navLabel: 'Доступність',
  title: 'Доступність',
  subtitle: 'Заїзди пропонуються лише в години, які ви позначите тут. Немає годин — ви недоступні.',
  summary: (d, h) => `Цей тиждень · днів: ${d} · ${h}`,
  thisWeek: 'Цей тиждень',
  nextWeek: 'Наступний тиждень',
  later: 'Пізніше',
  today: 'Сьогодні',
  notAvailable: 'Недоступний(а)',
  addTime: 'Додати час',
  addTimeOn: (d) => `Додати час: ${d}`,
  copyWeek: 'Скопіювати цей тиждень',
  copied: (n) => `Скопійовано на наступний тиждень: ${n}`,
  nothingToCopy: 'Цього тижня нічого копіювати',
  sheetQuestion: 'Коли ви можете приймати заїзди?',
  editTitle: 'Змінити час',
  quickPick: 'Швидкий вибір',
  morning: 'Ранок',
  afternoon: 'День',
  evening: 'Вечір',
  late: 'Пізно',
  exact: 'Або точно · крок 30 хв',
  from: 'З',
  till: 'До',
  earlier: (w) => `${w} на 30 хвилин раніше`,
  later30: (w) => `${w} на 30 хвилин пізніше`,
  overnightHint: '«До» раніше, ніж «З», — означає після опівночі: 21:00 → 01:00 — один вечір.',
  alsoOn: 'Ті самі години також',
  save: (r, n) => `Зберегти ${r}${n > 1 ? ` · днів: ${n}` : ''}`,
  saveChange: 'Зберегти',
  remove: 'Видалити',
  close: 'Закрити',
  todayLocked: 'Сьогоднішні години змінити не можна. Якщо щось змінилося, зателефонуйте на ресепшн.',
  saveFailed: 'Не вдалося зберегти — спробуйте ще раз',
  loading: 'Завантаження…',
  tabLabel: 'Агенти',
  deskTitle: 'Агенти',
  deskSubtitle: 'Хто може зустрічати гостей, по годинах — позначають самі агенти · Europe/Prague',
  day: 'День',
  week: 'Тиждень',
  prev: 'Назад',
  next: 'Далі',
  todayPrefix: 'Сьогодні',
  agentsAvailable: (n) => `Доступно агентів: ${n}`,
  arrivalsCount: (n) => `Заїздів: ${n}`,
  gapNoAgent: (r) => `${r} · немає агента`,
  strain: (r) => `${r} · >4 заїздів на агента`,
  agent: 'Агент',
  arrivalsRow: 'Заїзди',
  assumedNote: 'вкл. припущені 15:00',
  onDuty: 'Агенти на зміні',
  notAvailableToday: (n) => `Недоступно агентів: ${n}`,
  nothingDeclared: 'нічого не вказано',
  hoursToday: (h, b) => `${h}${b > 1 ? ` · блоків: ${b}` : ''}`,
  setAt: (w) => `вказано ${w}`,
  uncoveredTitle: (r, n) => `${r} · заїздів: ${n}, немає агента`,
  openInCheckIn: 'Відкрити планування заїздів →',
  legendTitle: 'Як читати',
  legendBlock: 'Позначено агентом у застосунку — ресепшн лише читає',
  legendGap: 'Гості приїжджають, а агента немає',
  legendStrain: 'Більше 4 заїздів на доступного агента в цю годину',
  legendArrivals: 'Заїзди з планування, за очікуваною годиною',
  legendAssumed: 'Штрихування: час заїзду не підтверджено (наше 15:00 за замовчуванням)',
  agentHours: 'Години агентів',
  hoursNoAgent: 'Години із заїздами без агента',
  clickDay: 'Натисніть на день, щоб відкрити його шкалою часу',
  noAgents: 'Поки немає активних користувачів з роллю Агент.',
  noGaps: 'У кожну годину із заїздами є агент.',
};

export const availabilityStrings: Record<Locale, AvailabilityStrings> = { en, cs, ru, uk };

export function useAvailabilityStrings(locale: Locale): AvailabilityStrings {
  return availabilityStrings[locale] ?? availabilityStrings.en;
}

/** Intl tags for the four UI languages. */
export const LOCALE_TAG: Record<Locale, string> = { en: 'en-GB', cs: 'cs-CZ', ru: 'ru-RU', uk: 'uk-UA' };

/** Minutes → "HH:mm", wrapping past midnight (1500 → "01:00"). */
export function hhmm(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "5 h", "14 h 30 min" — a duration in minutes. */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Calendar arithmetic on YYYY-MM-DD, no time zones involved. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Monday of the week `day` falls in. */
export function mondayOf(day: string): string {
  return addDays(day, -weekdayIndex(day));
}

/** Weekday / day-of-month / month labels for a YYYY-MM-DD, in the viewer's language. */
export function dayParts(day: string, locale: Locale) {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  const tag = LOCALE_TAG[locale] ?? 'en-GB';
  return {
    dow: date.toLocaleDateString(tag, { weekday: 'short', timeZone: 'UTC' }).replace('.', '').toUpperCase(),
    num: String(d),
    long: date.toLocaleDateString(tag, { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }),
    short: date.toLocaleDateString(tag, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }),
  };
}
